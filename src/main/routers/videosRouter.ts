import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import { t } from "../trpc";
import { smartMatch } from "../lib/searchMatch";

export interface VideoItem {
  id: string;
  name: string;
  url: string;
  resolution: string;
  encryptionType: string;
  coverUrl?: string;
  previewUrl?: string;
  size?: string;
  createdAt?: number;
  // 从 meta.json 拼上的丰富字段
  code?: string;
  title?: string;
  actors?: string[];
  releaseDate?: string;
  duration?: string;
  studio?: string;
  label?: string;
  studioSeries?: string;
  director?: string;
  genres?: string[];
  rating?: number;
  plot?: string;
  sourceSite?: string;
}

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

const VIDEO_EXTS = [
  "mp4",
  "mkv",
  "ts",
  "mov",
  "avi",
  "webm",
  "flv",
  "m4v",
];
const VIDEO_EXTS_SET = new Set(VIDEO_EXTS.map((e) => `.${e}`));
const COVER_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"];
const PREVIEW_EXTS = ["mp4", "webm", "gif", "mov", "m4v"];
const CACHE_NAME = ".avplay_index.json";
const CACHE_TTL_MS = 10 * 1000; // 10 秒内的重复请求直接返回内存缓存

interface CacheEntry {
  folderMtime: number;
  videoMtime: number;
  metaMtime: number;
  coverMtime: number;
  video: VideoItem;
}

interface CacheFile {
  rootMtime: number;
  entries: Record<string, CacheEntry>;
  sortedIds: string[];
  createdAt: number;
}

const memoryCache: Record<string, { data: VideoItem[]; loadedAt: number }> = {};
const diskCacheLock: Record<string, Promise<CacheFile> | undefined> = {};

async function safeStat(p: string): Promise<fs.Stats | null> {
  try {
    return await fsPromises.stat(p);
  } catch {
    return null;
  }
}

function pickCaseInsensitive(
  names: string[],
  targetLower: string,
): string | undefined {
  for (const n of names) if (n.toLowerCase() === targetLower) return n;
  return undefined;
}

function findCoverByNames(names: string[]): string | undefined {
  const lowerToName = new Map<string, string>();
  for (const n of names) lowerToName.set(n.toLowerCase(), n);
  for (const ext of COVER_EXTS) {
    const n = lowerToName.get(`cover.${ext}`);
    if (n) return n;
  }
  return undefined;
}

function findPreviewByNames(names: string[]): string | undefined {
  const lowerToName = new Map<string, string>();
  for (const n of names) lowerToName.set(n.toLowerCase(), n);
  for (const ext of PREVIEW_EXTS) {
    const n = lowerToName.get(`preview.${ext}`);
    if (n) return n;
  }
  return undefined;
}

function findVideoByNames(names: string[]): string | undefined {
  const lowerToName = new Map<string, string>();
  for (const n of names) lowerToName.set(n.toLowerCase(), n);
  const preferred = [
    "video.mp4",
    "video.mkv",
    "video.ts",
    "video.m4v",
  ];
  for (const p of preferred) {
    const n = lowerToName.get(p);
    if (n) return n;
  }
  for (const n of names) {
    const lname = n.toLowerCase();
    const ext = path.extname(lname);
    if (VIDEO_EXTS_SET.has(ext) && lname !== "preview.mp4") return n;
  }
  return undefined;
}

async function loadMeta(
  folderPath: string,
  names: string[],
): Promise<Partial<VideoItem> & { _metaMtime: number }> {
  const metaName = pickCaseInsensitive(names, "meta.json");
  if (!metaName) return { _metaMtime: 0 };
  const mPath = path.join(folderPath, metaName);
  try {
    const [data, st] = await Promise.all([
      fsPromises.readFile(mPath, "utf8"),
      fsPromises.stat(mPath),
    ]);
    const m = JSON.parse(data);
    return {
      _metaMtime: st.mtimeMs,
      code: m.code,
      title: m.title,
      actors: Array.isArray(m.actors) ? m.actors : undefined,
      releaseDate: m.releaseDate,
      duration: m.duration,
      studio: m.studio,
      label: m.label,
      studioSeries: m.studioSeries,
      director: m.director,
      genres: Array.isArray(m.genres) ? m.genres : undefined,
      rating: typeof m.rating === "number" ? m.rating : undefined,
      plot: m.plot,
      sourceSite: m.sourceSite,
    };
  } catch {
    return { _metaMtime: 0 };
  }
}

async function buildEntry(
  videoDir: string,
  folderName: string,
): Promise<CacheEntry | null> {
  const folderPath = path.join(videoDir, folderName);
  let folderStat: fs.Stats | null = null;
  try {
    folderStat = await fsPromises.stat(folderPath);
    if (!folderStat.isDirectory()) return null;
  } catch {
    return null;
  }

  let names: string[];
  try {
    names = await fsPromises.readdir(folderPath);
  } catch {
    names = [];
  }

  const videoName = findVideoByNames(names);
  if (!videoName) return null;

  const videoFile = path.join(folderPath, videoName);
  const videoStat = await safeStat(videoFile);
  const videoSize = videoStat?.size ?? 0;
  const videoMtime = videoStat?.mtimeMs ?? 0;

  const coverName = findCoverByNames(names);
  const coverFile = coverName ? path.join(folderPath, coverName) : undefined;
  const coverStat = coverFile ? await safeStat(coverFile) : null;

  const previewName = findPreviewByNames(names);
  const previewFile = previewName
    ? path.join(folderPath, previewName)
    : undefined;

  const metaExtras = await loadMeta(folderPath, names);

  return {
    folderMtime: folderStat.mtimeMs,
    videoMtime,
    metaMtime: metaExtras._metaMtime,
    coverMtime: coverStat?.mtimeMs ?? 0,
    video: {
      id: folderName,
      name: folderName,
      url: videoFile,
      resolution: "local",
      encryptionType: "decrypted",
      coverUrl: coverFile,
      previewUrl: previewFile,
      size: formatSize(videoSize),
      createdAt: videoMtime || folderStat.birthtime.getTime(),
      ...metaExtras,
    },
  };
}

async function loadDiskCache(videoDir: string): Promise<CacheFile | null> {
  const cachePath = path.join(videoDir, CACHE_NAME);
  try {
    const [data, st] = await Promise.all([
      fsPromises.readFile(cachePath, "utf8"),
      fsPromises.stat(cachePath),
    ]);
    const parsed = JSON.parse(data) as CacheFile;
    if (parsed && parsed.entries && Array.isArray(parsed.sortedIds)) {
      return { ...parsed, createdAt: st.mtimeMs };
    }
    return null;
  } catch {
    return null;
  }
}

async function saveDiskCache(
  videoDir: string,
  cache: CacheFile,
): Promise<void> {
  const cachePath = path.join(videoDir, CACHE_NAME);
  try {
    await fsPromises.writeFile(cachePath, JSON.stringify(cache), "utf8");
  } catch {
    /* ignore */
  }
}

async function buildCacheFromScratch(videoDir: string): Promise<CacheFile> {
  let topNames: string[] = [];
  try {
    topNames = await fsPromises.readdir(videoDir);
  } catch {
    return {
      rootMtime: 0,
      entries: {},
      sortedIds: [],
      createdAt: Date.now(),
    };
  }

  // 过滤目录（懒检查 isDirectory）—— 避免先跑一遍 stat 全量
  const folderCandidates: string[] = [];
  for (const n of topNames) {
    if (n === CACHE_NAME) continue;
    if (n.startsWith(".")) continue;
    folderCandidates.push(n);
  }

  // 并发分批（每批 64 个），避免同时开几千个文件句柄
  const CONCURRENCY = 64;
  const entries: Record<string, CacheEntry> = {};
  for (let i = 0; i < folderCandidates.length; i += CONCURRENCY) {
    const slice = folderCandidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map((f) =>
        buildEntry(videoDir, f).catch(() => null as CacheEntry | null),
      ),
    );
    for (const r of results) if (r) entries[r.video.id] = r;
    // 让出事件循环，避免 Node 主线程被完全占满导致 UI 假死
    await new Promise((r) => setTimeout(r, 0));
  }

  const sortedIds = Object.values(entries)
    .sort((a, b) => (b.video.createdAt ?? 0) - (a.video.createdAt ?? 0))
    .map((e) => e.video.id);

  const rootStat = await safeStat(videoDir);
  return {
    rootMtime: rootStat?.mtimeMs ?? Date.now(),
    entries,
    sortedIds,
    createdAt: Date.now(),
  };
}

async function buildCacheIncremental(
  videoDir: string,
  prev: CacheFile,
): Promise<CacheFile> {
  // 只重新 build 目录结构发生变化的项（文件夹的 mtime/视频 mtime/meta/cover 与缓存不一致）
  let topNames: string[] = [];
  try {
    topNames = await fsPromises.readdir(videoDir);
  } catch {
    return prev;
  }

  const currentSet = new Set<string>();
  for (const n of topNames) {
    if (n === CACHE_NAME) continue;
    if (n.startsWith(".")) continue;
    currentSet.add(n);
  }

  const entries: Record<string, CacheEntry> = { ...prev.entries };
  const toRefresh: string[] = [];
  const toRemove: string[] = [];

  for (const id of currentSet) {
    const prevEntry = entries[id];
    if (!prevEntry) {
      toRefresh.push(id);
      continue;
    }
    const folderPath = path.join(videoDir, id);
    const folderStat = await safeStat(folderPath);
    if (!folderStat || !folderStat.isDirectory()) {
      toRemove.push(id);
      continue;
    }
    // 粗粒度：文件夹 mtime 未变 → 复用
    if (Math.abs(folderStat.mtimeMs - prevEntry.folderMtime) < 1) continue;
    toRefresh.push(id);
  }
  for (const id of Object.keys(entries)) {
    if (!currentSet.has(id)) toRemove.push(id);
  }

  for (const id of toRemove) delete entries[id];

  const CONCURRENCY = 64;
  for (let i = 0; i < toRefresh.length; i += CONCURRENCY) {
    const slice = toRefresh.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map((f) =>
        buildEntry(videoDir, f).catch(() => null as CacheEntry | null),
      ),
    );
    for (const r of results) if (r) entries[r.video.id] = r;
    await new Promise((r) => setTimeout(r, 0));
  }

  const sortedIds = Object.values(entries)
    .sort((a, b) => (b.video.createdAt ?? 0) - (a.video.createdAt ?? 0))
    .map((e) => e.video.id);

  const rootStat = await safeStat(videoDir);
  return {
    rootMtime: rootStat?.mtimeMs ?? Date.now(),
    entries,
    sortedIds,
    createdAt: Date.now(),
  };
}

async function getCacheFile(videoDir: string): Promise<CacheFile> {
  if (!diskCacheLock[videoDir]) {
    diskCacheLock[videoDir] = (async () => {
      const cached = await loadDiskCache(videoDir);
      const rootStat = await safeStat(videoDir);
      const rootMtime = rootStat?.mtimeMs ?? 0;
      if (cached && Math.abs(rootMtime - cached.rootMtime) < 1) {
        const inc = await buildCacheIncremental(videoDir, cached);
        void saveDiskCache(videoDir, inc);
        return inc;
      }
      const fresh = await buildCacheFromScratch(videoDir);
      void saveDiskCache(videoDir, fresh);
      return fresh;
    })();
  }
  try {
    return await diskCacheLock[videoDir]!;
  } finally {
    diskCacheLock[videoDir] = undefined;
  }
}

async function listVideos(videoDir: string): Promise<VideoItem[]> {
  try {
    if (!fs.existsSync(videoDir)) return [];
  } catch {
    return [];
  }
  const memKey = videoDir;
  const mem = memoryCache[memKey];
  if (mem && Date.now() - mem.loadedAt < CACHE_TTL_MS) return mem.data;

  const cache = await getCacheFile(videoDir);
  const data = cache.sortedIds.map((id) => cache.entries[id].video);
  memoryCache[memKey] = { data, loadedAt: Date.now() };
  return data;
}

export const videosRouter = t.router({
    list: t.procedure
      .input((input: unknown) => (input as { path?: string }) || {})
      .query(async ({ input }) => {
        const videoDir = input.path || "M:\\video\\videos\\";
        return listVideos(videoDir);
      }),

    // 轻量首屏：只做 readdir + stat，无 meta.json / cover / preview 扫描，毫秒级返回
    lightweightList: t.procedure
      .input((input: unknown) => (input as { path?: string }) || {})
      .query(async ({ input }) => {
        const videoDir = input.path || "M:\\video\\videos\\";
        try {
          if (!fs.existsSync(videoDir)) return [] as VideoItem[];
        } catch {
          return [] as VideoItem[];
        }

        let topNames: string[];
        try {
          topNames = await fsPromises.readdir(videoDir);
        } catch {
          return [] as VideoItem[];
        }

        const candidates = topNames.filter(
          (n) => n !== CACHE_NAME && !n.startsWith("."),
        );

        // 批量 stat（并发但不等待 meta/preview/cover）
        const CONCURRENCY = 100;
        const result: VideoItem[] = [];

        for (let i = 0; i < candidates.length; i += CONCURRENCY) {
          const slice = candidates.slice(i, i + CONCURRENCY);
          const entries = await Promise.all(
            slice.map(async (name) => {
              const folderPath = path.join(videoDir, name);
              try {
                const folderStat = await fsPromises.stat(folderPath);
                if (!folderStat.isDirectory()) return null;

                // 找视频文件（只用 readdir，不需要额外 existsSync）
                let names: string[];
                try {
                  names = await fsPromises.readdir(folderPath);
                } catch {
                  return null;
                }

                const videoName = findVideoByNames(names);
                if (!videoName) return null;
                const videoFile = path.join(folderPath, videoName);

                let videoStat: fs.Stats | null = null;
                let videoSize = 0;
                let videoMtime = 0;
                try {
                  videoStat = await fsPromises.stat(videoFile);
                  videoSize = videoStat.size;
                  videoMtime = videoStat.mtimeMs;
                } catch {
                  return null;
                }

                return {
                  id: name,
                  name,
                  url: videoFile,
                  resolution: "local",
                  encryptionType: "decrypted",
                  size: formatSize(videoSize),
                  createdAt: videoMtime || folderStat.birthtime.getTime(),
                } as VideoItem;
              } catch {
                return null;
              }
            }),
          );
          for (const e of entries) if (e) result.push(e);
          // 让出事件循环，保持 UI 响应
          await new Promise((r) => setTimeout(r, 0));
        }

        result.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        return result;
      }),

    // 渐进 enrich 单个条目（封面、预告、meta），供前端按需调用
    enrichItem: t.procedure
      .input((input: unknown) => (input as { id: string; folderPath: string }) || {})
      .mutation(async ({ input }) => {
        const { folderPath } = input;
        try {
          const names = await fsPromises.readdir(folderPath);

          const coverName = findCoverByNames(names);
          const coverFile = coverName
            ? path.join(folderPath, coverName)
            : undefined;

          const previewName = findPreviewByNames(names);
          const previewFile = previewName
            ? path.join(folderPath, previewName)
            : undefined;

          const metaExtras = await loadMeta(folderPath, names);

          return {
            coverUrl: coverFile,
            previewUrl: previewFile,
            ...metaExtras,
          };
        } catch {
          return {};
        }
      }),

    // 检查视频文件夹是否已有 thumbs 雪碧图 + VTT
    hasThumbs: t.procedure
      .input((input: unknown) => input as { folder: string })
      .query(({ input }) => {
        const webp = path.join(input.folder, "thumbs.webp");
        const jpg = path.join(input.folder, "thumbs.jpg");
        const vtt = path.join(input.folder, "thumbs.vtt");
        const webpExists = fs.existsSync(webp);
        const jpgExists = fs.existsSync(jpg);
        const sprite = webpExists ? webp : jpg;
        return {
          exists: (webpExists || jpgExists) && fs.existsSync(vtt),
          spritePath: sprite,
          vttPath: vtt,
        };
      }),

    // 写入由渲染端生成的雪碧图 + VTT
    findVideoFile: t.procedure
      .input((input: unknown) => input as { folder: string })
      .query(({ input }) => {
        try {
          if (!fs.existsSync(input.folder)) {
            return { success: false, error: "folder not found" };
          }
          const preferred = ["video.mp4", "video.mkv", "video.ts", "video.m4v"];
          for (const name of preferred) {
            const full = path.join(input.folder, name);
            if (fs.existsSync(full)) return { success: true, path: full };
          }

          const exts = new Set([
            ".mp4",
            ".mkv",
            ".ts",
            ".mov",
            ".avi",
            ".webm",
            ".flv",
            ".m4v",
          ]);
          const files = fs.readdirSync(input.folder, { withFileTypes: true });
          for (const file of files) {
            if (!file.isFile()) continue;
            if (file.name.toLowerCase().startsWith("preview.")) continue;
            if (exts.has(path.extname(file.name).toLowerCase())) {
              return { success: true, path: path.join(input.folder, file.name) };
            }
          }
          return { success: false, error: "video file not found" };
        } catch (err: any) {
          return { success: false, error: err?.message || String(err) };
        }
      }),

    // 删除已存在的刻度雪碧图（强制重新生成场景）
    deleteThumbs: t.procedure
      .input((input: unknown) => input as { folder: string })
      .mutation(({ input }) => {
        try {
          const files = [
            path.join(input.folder, "thumbs.webp"),
            path.join(input.folder, "thumbs.jpg"),
            path.join(input.folder, "thumbs.vtt"),
          ];
          let removed = 0;
          for (const f of files) {
            if (fs.existsSync(f)) {
              fs.unlinkSync(f);
              removed++;
            }
          }
          return { success: true, removed };
        } catch (err: any) {
          return { success: false, error: err?.message || String(err) };
        }
      }),

    writeThumbs: t.procedure
      .input(
        (input: unknown) =>
          input as {
            folder: string;
            // 优先 webp；兼容旧 jpegBase64
            webpBase64?: string;
            jpegBase64?: string;
            vttText: string;
          },
      )
      .mutation(({ input }) => {
        try {
          if (!fs.existsSync(input.folder)) {
            return { success: false, error: "folder not found" };
          }
          if (input.webpBase64) {
            const buf = Buffer.from(input.webpBase64, "base64");
            fs.writeFileSync(path.join(input.folder, "thumbs.webp"), buf);
            // 清理旧 jpg 避免双副本
            const oldJpg = path.join(input.folder, "thumbs.jpg");
            if (fs.existsSync(oldJpg)) fs.unlinkSync(oldJpg);
          } else if (input.jpegBase64) {
            const buf = Buffer.from(input.jpegBase64, "base64");
            fs.writeFileSync(path.join(input.folder, "thumbs.jpg"), buf);
          } else {
            return { success: false, error: "missing image data" };
          }
          fs.writeFileSync(
            path.join(input.folder, "thumbs.vtt"),
            input.vttText,
            "utf8",
          );
          return { success: true };
        } catch (err: any) {
          return { success: false, error: err?.message || String(err) };
        }
      }),

    // Delete local video folder
    delete: t.procedure
      .input(
        (input: unknown) => input as { folderPath: string; rootPath?: string },
      )
      .mutation(({ input }) => {
        const { folderPath, rootPath } = input;
        try {
          if (!fs.existsSync(folderPath)) {
            return { success: false, error: "文件夹不存在" };
          }
          const resolvedFolderPath = path.resolve(folderPath);
          const resolvedRoot = path.resolve(rootPath || "M:\\video\\videos\\");
          const relative = path.relative(resolvedRoot, resolvedFolderPath);
          const isUnderRoot =
            relative !== "" &&
            !relative.startsWith("..") &&
            !path.isAbsolute(relative);

          if (!isUnderRoot) {
            return {
              success: false,
              error: "Delete path is outside video root directory",
            };
          }

          if (path.dirname(resolvedFolderPath) !== resolvedRoot) {
            return {
              success: false,
              error: "Only first-level child folders can be deleted",
            };
          }

          fs.rmSync(resolvedFolderPath, { recursive: true, force: true });
          console.log(`[videos.delete] deleted ${resolvedFolderPath}`);
          return { success: true, error: undefined as string | undefined };
        } catch (err: any) {
          console.error(`[删除视频] 失败: ${err.message}`);
          return { success: false, error: err.message };
        }
      }),

    search: t.procedure
      .input(
        (input: unknown) =>
          (input as { query: string; rootPath?: string }) || {
            query: "",
            rootPath: "",
          },
      )
      .query(async ({ input }) => {
        const query = (input.query || "").trim();
        const rootPath = input.rootPath || "M:\\video\\videos\\";
        if (!query) return [] as VideoItem[];

        const all = await listVideos(rootPath);
        return all.filter((v) => {
          const fields: (string | undefined | null)[] = [
            v.name,
            v.code as any,
            v.title as any,
            v.studio as any,
            v.director as any,
            ...(Array.isArray(v.actors) ? v.actors : []),
            ...(Array.isArray(v.genres) ? v.genres : []),
          ];
          return smartMatch(fields, query);
        });
      }),
  });
