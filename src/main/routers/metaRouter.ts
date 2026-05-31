import * as fs from "fs";
import * as path from "path";
import { t } from "../trpc";
import { log } from "../logger";

// =================== 番号正则提取 ===================

interface CodeInfo {
  code: string; // 规范化番号，如 SSIS-001
  series: string | null;
  number: string | null;
  kind:
    | "standard" // XXX-001
    | "compact" // XXXNNN（无横线，重写为 XXX-NNN）
    | "fc2"
    | "heyzo"
    | "1pondo"
    | "caribbean"
    | "unknown";
}

const STRIP_SUFFIXES = [
  /-uncensored-leak$/i,
  /-uncensored$/i,
  /-leak$/i,
  /-hd$/i,
  /-c$/i,
  /-ch$/i,
];

function stripCommonSuffix(name: string): string {
  let s = name;
  for (const r of STRIP_SUFFIXES) s = s.replace(r, "");
  return s;
}

const RULES: Array<{ kind: CodeInfo["kind"]; re: RegExp; normalize: (m: RegExpMatchArray) => CodeInfo }> = [
  // FC2-PPV-1234567 / FC2PPV-1234567 / FC2PPV1234567
  {
    kind: "fc2",
    re: /\bFC2[\s\-_]?PPV[\s\-_]?(\d{6,8})\b/i,
    normalize: (m) => ({
      code: `FC2-PPV-${m[1]}`,
      series: "FC2-PPV",
      number: m[1],
      kind: "fc2",
    }),
  },
  // HEYZO-1234 / HEYZO 1234
  {
    kind: "heyzo",
    re: /\bHEYZO[\s\-_]?(\d{3,5})\b/i,
    normalize: (m) => ({
      code: `HEYZO-${m[1]}`,
      series: "HEYZO",
      number: m[1],
      kind: "heyzo",
    }),
  },
  // 1pondo-010122_001 / 1pondo_010122_001
  {
    kind: "1pondo",
    re: /\b1pondo[\s\-_]?(\d{6}[_-]\d{3})\b/i,
    normalize: (m) => ({
      code: `1pondo-${m[1].replace("-", "_")}`,
      series: "1pondo",
      number: m[1],
      kind: "1pondo",
    }),
  },
  // caribbean-012422-001 / caribbeancom 同款
  {
    kind: "caribbean",
    re: /\bcaribbean(?:com)?[\s\-_]?(\d{6}[\-_]\d{3})\b/i,
    normalize: (m) => ({
      code: `caribbean-${m[1].replace("_", "-")}`,
      series: "caribbean",
      number: m[1],
      kind: "caribbean",
    }),
  },
  // 标准 XXX-NNN(NN)
  {
    kind: "standard",
    re: /\b([A-Z]{2,6})-(\d{3,5})\b/i,
    normalize: (m) => ({
      code: `${m[1].toUpperCase()}-${m[2]}`,
      series: m[1].toUpperCase(),
      number: m[2],
      kind: "standard",
    }),
  },
  // 紧凑 XXXNNN(NN)（无横线），如 ABP123 → ABP-123
  {
    kind: "compact",
    re: /\b([A-Z]{2,6})(\d{3,5})\b/i,
    normalize: (m) => ({
      code: `${m[1].toUpperCase()}-${m[2]}`,
      series: m[1].toUpperCase(),
      number: m[2],
      kind: "compact",
    }),
  },
];

export function parseCode(rawName: string): CodeInfo | null {
  const cleaned = stripCommonSuffix(rawName.trim());
  for (const rule of RULES) {
    const m = cleaned.match(rule.re);
    if (m) return rule.normalize(m);
  }
  return null;
}

// =================== meta.json 读写 ===================

export interface VideoMeta {
  // 离线层
  code: string | null;
  series: string | null;
  number: string | null;
  kind: CodeInfo["kind"];
  rawName: string;
  format: string | null;
  fileSize: number | null;
  fileMtime: string | null;
  downloadedAt: string;
  savePath: string;
  sourceUrl?: string;
  referer?: string;
  refererSource?: string;
  resolution?: string;
  encryptionType?: string;
  // 版本号便于未来迁移
  schemaVersion: 1;
}

function metaPath(folder: string): string {
  return path.join(folder, "meta.json");
}

function statVideoFile(folder: string): {
  fileName: string | null;
  size: number | null;
  mtime: string | null;
  format: string | null;
} {
  try {
    const files = fs.readdirSync(folder);
    const videoExt = [".mp4", ".mkv", ".ts", ".m4v"];
    const video = files.find((f) => videoExt.includes(path.extname(f).toLowerCase()));
    if (!video) return { fileName: null, size: null, mtime: null, format: null };
    const full = path.join(folder, video);
    const s = fs.statSync(full);
    return {
      fileName: video,
      size: s.size,
      mtime: s.mtime.toISOString(),
      format: path.extname(video).slice(1).toUpperCase(),
    };
  } catch {
    return { fileName: null, size: null, mtime: null, format: null };
  }
}

function buildMeta(input: {
  saveDir: string;
  rawName: string;
  sourceUrl?: string;
  referer?: string;
  refererSource?: string;
  resolution?: string;
  encryptionType?: string;
  format?: string;
}): VideoMeta {
  const parsed = parseCode(input.rawName) || parseCode(path.basename(input.saveDir)) || null;
  const stat = statVideoFile(input.saveDir);
  return {
    code: parsed?.code ?? null,
    series: parsed?.series ?? null,
    number: parsed?.number ?? null,
    kind: parsed?.kind ?? "unknown",
    rawName: input.rawName,
    format: input.format || stat.format,
    fileSize: stat.size,
    fileMtime: stat.mtime,
    downloadedAt: new Date().toISOString(),
    savePath: input.saveDir,
    sourceUrl: input.sourceUrl,
    referer: input.referer,
    refererSource: input.refererSource,
    resolution: input.resolution,
    encryptionType: input.encryptionType,
    schemaVersion: 1,
  };
}

function writeMetaFile(folder: string, meta: VideoMeta): void {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(metaPath(folder), JSON.stringify(meta, null, 2), "utf8");
}

// =================== Router ===================

export const metaRouter = t.router({
  parseCode: t.procedure
    .input((input: unknown) => input as { name: string })
    .query(({ input }) => parseCode(input.name)),

  // 单个写入（下载完成时由前端调用）
  writeForTask: t.procedure
    .input(
      (input: unknown) =>
        input as {
          saveDir: string;
          rawName: string;
          sourceUrl?: string;
          referer?: string;
          refererSource?: string;
          resolution?: string;
          encryptionType?: string;
          format?: string;
        },
    )
    .mutation(({ input }) => {
      try {
        const meta = buildMeta(input);
        writeMetaFile(input.saveDir, meta);
        log.info(`[meta] write ${input.saveDir} code=${meta.code}`);
        return { success: true, meta };
      } catch (err: any) {
        log.error(`[meta] write failed: ${err?.message}`);
        return { success: false, error: err?.message || String(err) };
      }
    }),

  // 批量回填：扫描 rootPath 下所有子文件夹，缺 meta.json 的写入
  backfill: t.procedure
    .input(
      (input: unknown) =>
        input as { rootPath: string; overwrite?: boolean },
    )
    .mutation(({ input }) => {
      const result = {
        scanned: 0,
        skipped: 0, // 已存在 meta.json 且 overwrite=false
        written: 0,
        failed: 0,
        unmatched: 0, // 没识别到番号
        details: [] as Array<{
          folder: string;
          status: "written" | "skipped" | "failed" | "unmatched";
          code?: string | null;
          error?: string;
        }>,
      };
      try {
        if (!fs.existsSync(input.rootPath)) {
          return { ...result, error: "rootPath not found" };
        }
        const entries = fs.readdirSync(input.rootPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const folder = path.join(input.rootPath, entry.name);
          result.scanned++;
          const meta = metaPath(folder);
          if (fs.existsSync(meta) && !input.overwrite) {
            result.skipped++;
            result.details.push({ folder: entry.name, status: "skipped" });
            continue;
          }
          try {
            const built = buildMeta({ saveDir: folder, rawName: entry.name });
            writeMetaFile(folder, built);
            if (built.code) {
              result.written++;
              result.details.push({
                folder: entry.name,
                status: "written",
                code: built.code,
              });
            } else {
              result.unmatched++;
              result.details.push({
                folder: entry.name,
                status: "unmatched",
                code: null,
              });
            }
          } catch (err: any) {
            result.failed++;
            result.details.push({
              folder: entry.name,
              status: "failed",
              error: err?.message,
            });
          }
        }
        log.info(
          `[meta] backfill done: scanned=${result.scanned} written=${result.written} skipped=${result.skipped} unmatched=${result.unmatched} failed=${result.failed}`,
        );
        return result;
      } catch (err: any) {
        log.error(`[meta] backfill failed: ${err?.message}`);
        return { ...result, error: err?.message };
      }
    }),
});
