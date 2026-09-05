import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { t } from "../trpc";
import { log } from "../logger";
import { recordActivity } from "./activityRouter";

const VIDEO_EXTS = new Set([
  ".mp4",
  ".mkv",
  ".ts",
  ".mov",
  ".avi",
  ".webm",
  ".m4v",
]);
const COVER_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".avif",
]);

interface ParsedCode {
  code: string;
  series: string | null;
}

// 提取规范番号
function extractCode(name: string): ParsedCode | null {
  const cleaned = name.replace(/[-_]?(uncensored|leak|hd|4k|-c|-ch)\b/gi, " ");

  // FC2-PPV-1234567
  const fc2 = cleaned.match(/\bFC2[\s\-_]?PPV[\s\-_]?(\d{6,8})\b/i);
  if (fc2) return { code: `FC2-PPV-${fc2[1]}`, series: "FC2-PPV" };

  // HEYZO-1234
  const heyzo = cleaned.match(/\bHEYZO[\s\-_]?(\d{3,5})\b/i);
  if (heyzo) return { code: `HEYZO-${heyzo[1]}`, series: "HEYZO" };

  // 标准番号 ABC-123 或 ABC-0123
  const std = cleaned.match(/\b([a-zA-Z]{2,6})[\s\-_]?(\d{2,5})\b/);
  if (std) {
    return {
      code: `${std[1].toUpperCase()}-${std[2]}`,
      series: std[1].toUpperCase(),
    };
  }

  return null;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

function findPrimaryVideo(folderPath: string): string | null {
  try {
    const entries = fs.readdirSync(folderPath);
    let largestFile: string | null = null;
    let largestSize = 0;

    for (const file of entries) {
      const ext = path.extname(file).toLowerCase();
      if (VIDEO_EXTS.has(ext)) {
        const fullPath = path.join(folderPath, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > largestSize) {
            largestSize = stat.size;
            largestFile = fullPath;
          }
        } catch {}
      }
    }
    return largestFile;
  } catch {
    return null;
  }
}

function findPrimaryCover(folderPath: string): string | null {
  try {
    const entries = fs.readdirSync(folderPath);
    for (const name of ["cover", "poster", "fanart", "folder", "thumb"]) {
      for (const ext of COVER_EXTS) {
        const target = path.join(folderPath, `${name}${ext}`);
        if (fs.existsSync(target)) return target;
      }
    }
    for (const file of entries) {
      const ext = path.extname(file).toLowerCase();
      if (COVER_EXTS.has(ext)) {
        return path.join(folderPath, file);
      }
    }
    return null;
  } catch {
    return null;
  }
}

function readMetaJson(folderPath: string): Record<string, any> | null {
  try {
    const p = path.join(folderPath, "meta.json");
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// 构造 Kodi / Emby / Jellyfin 规范 XML
export function buildNfoXml(meta: Record<string, any>, defaultTitle: string): string {
  const code = meta.code || "";
  const title = meta.title || defaultTitle || code;
  const originalTitle = meta.originalTitle || title;
  const releaseDate = meta.releaseDate || "";
  const year = releaseDate ? releaseDate.slice(0, 4) : "";
  const studio = meta.studio || meta.series || "";
  const plot = meta.plot || "";
  const rating = meta.rating ? String(meta.rating) : "";
  const actors: string[] = Array.isArray(meta.actors) ? meta.actors : [];
  const genres: string[] = Array.isArray(meta.genres) ? meta.genres : [];

  const actorXml = actors
    .map(
      (a) => `  <actor>
    <name>${escapeXml(a)}</name>
    <type>Actor</type>
  </actor>`,
    )
    .join("\n");

  const genreXml = genres
    .map((g) => `  <genre>${escapeXml(g)}</genre>`)
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<movie>
  <title>${escapeXml(code ? `[${code}] ${title}` : title)}</title>
  <originaltitle>${escapeXml(originalTitle)}</originaltitle>
  <sorttitle>${escapeXml(code || title)}</sorttitle>
  <num>${escapeXml(code)}</num>
  <year>${escapeXml(year)}</year>
  <premiered>${escapeXml(releaseDate)}</premiered>
  <releasedate>${escapeXml(releaseDate)}</releasedate>
  <studio>${escapeXml(studio)}</studio>
  <plot>${escapeXml(plot)}</plot>
  <rating>${escapeXml(rating)}</rating>
${genreXml}
${actorXml}
</movie>
`;
}

function escapeXml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const organizerRouter = t.router({
  // 扫描源媒体目录，分析待整理的影片
  scanLibrary: t.procedure
    .input(z.object({ sourcePath: z.string() }))
    .query(async ({ input }) => {
      const source = input.sourcePath;
      if (!source || !fs.existsSync(source)) {
        return { items: [], total: 0 };
      }

      const entries = fs.readdirSync(source, { withFileTypes: true });
      const items = [];

      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const folderPath = path.join(source, ent.name);
        const videoFile = findPrimaryVideo(folderPath);
        if (!videoFile) continue;

        const meta = readMetaJson(folderPath) || {};
        const codeInfo = meta.code
          ? { code: meta.code, series: meta.series }
          : extractCode(ent.name);
        const code = codeInfo?.code || "";
        const title = meta.title || "";
        const actors: string[] = meta.actors || [];
        const hasCover = !!findPrimaryCover(folderPath);

        // 规范化命名预览: [番号] 演员 - 标题
        let suggestedName = code;
        if (actors.length > 0) {
          suggestedName += ` [${actors.slice(0, 3).join(", ")}]`;
        }
        if (title) {
          suggestedName += ` ${title}`;
        }
        if (!suggestedName) {
          suggestedName = ent.name;
        }
        suggestedName = sanitizeFileName(suggestedName);

        items.push({
          folderName: ent.name,
          folderPath,
          videoFile,
          code,
          title,
          actors,
          hasMeta: !!meta.title || !!meta.code,
          hasCover,
          suggestedName,
        });
      }

      return {
        items,
        total: items.length,
      };
    }),

  // 执行整理：创建 Emby/Plex 标准目录、软链接和 NFO
  createSymlinkLibrary: t.procedure
    .input(
      z.object({
        sourcePath: z.string(),
        targetPath: z.string(),
        mode: z.enum(["symlink", "hardlink", "copy"]).default("symlink"),
        items: z
          .array(
            z.object({
              folderPath: z.string(),
              suggestedName: z.string(),
              code: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { sourcePath, targetPath, mode } = input;
      if (!targetPath) {
        return { success: false, error: "请选择目标输出目录" };
      }

      fs.mkdirSync(targetPath, { recursive: true });

      // 如果未指定具体项，全量扫描
      let targetItems = input.items;
      if (!targetItems || targetItems.length === 0) {
        const scanRes = await organizerRouter.createCaller({} as any).scanLibrary({
          sourcePath,
        });
        targetItems = scanRes.items.map((i) => ({
          folderPath: i.folderPath,
          suggestedName: i.suggestedName,
          code: i.code,
        }));
      }

      let successCount = 0;
      const errors: Array<{ name: string; reason: string }> = [];

      for (const item of targetItems) {
        const srcFolder = item.folderPath;
        const videoFile = findPrimaryVideo(srcFolder);
        if (!videoFile) continue;

        const safeName = sanitizeFileName(item.suggestedName || path.basename(srcFolder));
        const destFolder = path.join(targetPath, safeName);
        fs.mkdirSync(destFolder, { recursive: true });

        const videoExt = path.extname(videoFile);
        const destVideo = path.join(destFolder, `${safeName}${videoExt}`);

        // 1. 创建视频文件软链接 / 硬链接 / 复制
        try {
          if (fs.existsSync(destVideo)) {
            fs.unlinkSync(destVideo);
          }

          if (mode === "symlink") {
            try {
              fs.symlinkSync(videoFile, destVideo, "file");
            } catch (symlinkErr: any) {
              // Windows 若权限受限，尝试硬链接
              log.warn(`[organizer] symlink failed for ${videoFile}, trying hardlink:`, symlinkErr);
              fs.linkSync(videoFile, destVideo);
            }
          } else if (mode === "hardlink") {
            fs.linkSync(videoFile, destVideo);
          } else {
            fs.copyFileSync(videoFile, destVideo);
          }
        } catch (linkErr: any) {
          log.error(`[organizer] failed to link video:`, linkErr);
          errors.push({ name: safeName, reason: `视频链接失败: ${linkErr.message}` });
          continue;
        }

        // 2. 生成标准 NFO 文件
        try {
          const meta = readMetaJson(srcFolder) || {};
          const nfoContent = buildNfoXml(meta, safeName);
          fs.writeFileSync(path.join(destFolder, "movie.nfo"), nfoContent, "utf8");
          fs.writeFileSync(path.join(destFolder, `${safeName}.nfo`), nfoContent, "utf8");
        } catch (nfoErr: any) {
          log.warn(`[organizer] NFO generation error:`, nfoErr);
        }

        // 3. 复制封面至 poster.jpg & fanart.jpg
        try {
          const cover = findPrimaryCover(srcFolder);
          if (cover) {
            fs.copyFileSync(cover, path.join(destFolder, "poster.jpg"));
            fs.copyFileSync(cover, path.join(destFolder, "fanart.jpg"));
          }
        } catch (coverErr) {
          log.warn(`[organizer] cover copy error:`, coverErr);
        }

        successCount++;
      }

      // 记录到操作历史
      recordActivity(
        "ORGANIZE",
        "Emby/Plex 媒体库归档",
        `成功将 ${successCount} 部影片以 ${mode === "symlink" ? "软链接(0磁盘占用)" : mode} 方式整理至 ${path.basename(targetPath)}`,
        { targetPath, count: successCount, mode },
      );

      return {
        success: true,
        count: successCount,
        errors,
        message: `整理完成！成功归档 ${successCount} 部作品到目标目录。`,
      };
    }),
});
