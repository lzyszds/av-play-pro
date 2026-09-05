import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { t } from "../trpc";
import { invalidateVideoListCache } from "./videosRouter";

interface LibraryVideo {
  id: string;
  name: string;
  url: string;
  coverUrl?: string;
  previewUrl?: string;
  size?: string;
  createdAt?: number;
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

interface ActorRow {
  name: string;
  count: number;
  unseen: number;
  studios: string[];
  genres: string[];
  latest?: LibraryVideo;
}

const VIDEO_EXTS = new Set([".mp4", ".mkv", ".ts", ".mov", ".avi", ".webm", ".flv", ".m4v"]);
const COVER_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"]);
const PREVIEW_EXTS = new Set([".mp4", ".webm", ".gif", ".mov", ".m4v"]);

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

function parseSize(value?: string): number {
  if (!value) return 0;
  const match = value.match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
  if (!match) return 0;
  const n = Number(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === "TB") return n * 1024 ** 4;
  if (unit === "GB") return n * 1024 ** 3;
  if (unit === "MB") return n * 1024 ** 2;
  if (unit === "KB") return n * 1024;
  return n;
}

function normalizeCode(name: string): string | undefined {
  const fc2 = name.match(/FC2(?:-PPV)?[-_\s]*(\d{5,})/i);
  if (fc2) return `FC2-PPV-${fc2[1]}`;
  const code = name.match(/\b([A-Z]{2,8})[-_\s]?(\d{2,6})\b/i);
  if (!code) return undefined;
  return `${code[1].toUpperCase()}-${code[2]}`;
}

function readJson(file: string): any | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function findByExt(names: string[], exts: Set<string>, preferred: string[] = []): string | undefined {
  const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
  for (const item of preferred) {
    const hit = lower.get(item.toLowerCase());
    if (hit) return hit;
  }
  return names.find((name) => exts.has(path.extname(name).toLowerCase()));
}

function loadStats(): any {
  return readJson(path.join(app.getPath("userData"), "stats.json")) || {};
}

function loadTimelineStore(): any {
  return (
    readJson(path.join(app.getPath("userData"), "timeline.json")) || {
      bookmarks: [],
      directorCut: [],
    }
  );
}

async function scanLibrary(rootPath: string): Promise<LibraryVideo[]> {
  if (!rootPath || !fs.existsSync(rootPath)) return [];
  const folders = await fs.promises.readdir(rootPath).catch(() => []);
  const videos: LibraryVideo[] = [];

  for (const folder of folders) {
    if (folder.startsWith(".")) continue;
    const folderPath = path.join(rootPath, folder);
    const stat = await fs.promises.stat(folderPath).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const names = await fs.promises.readdir(folderPath).catch(() => []);
    const videoName = findByExt(names, VIDEO_EXTS, ["video.mp4", "video.mkv", "video.ts", "video.m4v"]);
    if (!videoName) continue;

    const videoPath = path.join(folderPath, videoName);
    const videoStat = await fs.promises.stat(videoPath).catch(() => null);
    const coverName = findByExt(names.filter((n) => /^cover\./i.test(n)), COVER_EXTS);
    const previewName = findByExt(names.filter((n) => /^preview\./i.test(n)), PREVIEW_EXTS);
    const meta = readJson(path.join(folderPath, "meta.json")) || {};

    videos.push({
      id: folder,
      name: folder,
      url: videoPath,
      coverUrl: coverName ? path.join(folderPath, coverName) : undefined,
      previewUrl: previewName ? path.join(folderPath, previewName) : undefined,
      size: formatBytes(videoStat?.size || 0),
      createdAt: videoStat?.mtimeMs || stat.birthtimeMs,
      code: meta.code || normalizeCode(folder),
      title: meta.title,
      actors: Array.isArray(meta.actors) ? meta.actors : [],
      releaseDate: meta.releaseDate,
      duration: meta.duration,
      studio: meta.studio,
      label: meta.label,
      studioSeries: meta.studioSeries,
      director: meta.director,
      genres: Array.isArray(meta.genres) ? meta.genres : [],
      rating: typeof meta.rating === "number" ? meta.rating : undefined,
      plot: meta.plot,
      sourceSite: meta.sourceSite,
    });
  }

  return videos.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function buildActors(videos: LibraryVideo[], played: Set<string>): ActorRow[] {
  const map = new Map<string, ActorRow>();
  for (const video of videos) {
    for (const actor of video.actors || []) {
      const row = map.get(actor) || {
        name: actor,
        count: 0,
        unseen: 0,
        studios: [],
        genres: [],
      };
      row.count += 1;
      if (!played.has(video.name)) row.unseen += 1;
      if (video.studio && !row.studios.includes(video.studio)) row.studios.push(video.studio);
      for (const genre of video.genres || []) {
        if (!row.genres.includes(genre)) row.genres.push(genre);
      }
      if (!row.latest || (video.createdAt || 0) > (row.latest.createdAt || 0)) row.latest = video;
      map.set(actor, row);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function dateKey(ts?: number): string {
  const d = ts ? new Date(ts) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayDiff(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}

type CleanupKind = "empty" | "no_video" | "tiny_video" | "temp" | "loose_file";

interface CleanupItem {
  id: string;
  path: string;
  name: string;
  kind: CleanupKind;
  reason: string;
  sizeBytes: number;
  sizeLabel: string;
  fileCount: number;
  selectedByDefault: boolean;
}

async function measurePath(target: string): Promise<{ bytes: number; files: number }> {
  const st = await fs.promises.stat(target).catch(() => null);
  if (!st) return { bytes: 0, files: 0 };
  if (st.isFile()) return { bytes: st.size, files: 1 };
  if (!st.isDirectory()) return { bytes: 0, files: 0 };

  let bytes = 0;
  let files = 0;
  const stack = [target];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const fileStat = await fs.promises.stat(full).catch(() => null);
      bytes += fileStat?.size || 0;
      files += 1;
    }
  }
  return { bytes, files };
}

export const libraryRouter = t.router({
  overview: t.procedure
    .input((input: unknown) => input as { rootPath: string })
    .query(async ({ input }) => {
      const videos = await scanLibrary(input.rootPath);
      const stats = loadStats();
      const played = new Set<string>(Object.keys(stats.videos || {}));
      const timeline = loadTimelineStore();
      const totalBytes = videos.reduce((sum, video) => sum + parseSize(video.size), 0);
      const missingCover = videos.filter((video) => !video.coverUrl);
      const missingMeta = videos.filter((video) => !video.title && !video.code);
      const noPreview = videos.filter((video) => !video.previewUrl);
      const unseen = videos.filter((video) => !played.has(video.name));
      const halfWatched = videos.filter((video) => {
        const entry = stats.videos?.[video.name];
        return entry && entry.watchSec > 0 && entry.playCount > 0;
      });

      const codeGroups = new Map<string, LibraryVideo[]>();
      for (const video of videos) {
        if (!video.code) continue;
        const list = codeGroups.get(video.code) || [];
        list.push(video);
        codeGroups.set(video.code, list);
      }
      const duplicates = [...codeGroups.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([code, list]) => ({ code, count: list.length, videos: list }));

      const actors = buildActors(videos, played);
      const recent = videos.slice(0, 24);
      const large = [...videos].sort((a, b) => parseSize(b.size) - parseSize(a.size)).slice(0, 16);
      const notifications = [
        missingCover.length ? { level: "warning", title: "缺封面", body: `${missingCover.length} 部作品缺少 cover 图片` } : null,
        missingMeta.length ? { level: "warning", title: "缺元数据", body: `${missingMeta.length} 部作品缺少番号或标题` } : null,
        duplicates.length ? { level: "info", title: "重复番号", body: `${duplicates.length} 个番号存在多个版本` } : null,
        noPreview.length ? { level: "info", title: "缺预览", body: `${noPreview.length} 部作品缺少 preview 文件` } : null,
      ].filter(Boolean);

      const achievements = [
        { id: "library-100", title: "百部片库", done: videos.length >= 100, progress: Math.min(videos.length, 100), target: 100 },
        { id: "cover-90", title: "封面洁癖", done: videos.length > 0 && missingCover.length / videos.length <= 0.1, progress: videos.length - missingCover.length, target: Math.max(1, videos.length) },
        { id: "meta-90", title: "资料管家", done: videos.length > 0 && missingMeta.length / videos.length <= 0.1, progress: videos.length - missingMeta.length, target: Math.max(1, videos.length) },
        { id: "actor-50", title: "演员图谱", done: actors.length >= 50, progress: Math.min(actors.length, 50), target: 50 },
        { id: "timeline-20", title: "时间轴收藏家", done: (timeline.bookmarks || []).length >= 20, progress: Math.min((timeline.bookmarks || []).length, 20), target: 20 },
      ];

      const addedByDay: Record<string, number> = {};
      for (const video of videos) {
        const key = dateKey(video.createdAt);
        addedByDay[key] = (addedByDay[key] || 0) + 1;
      }

      return {
        totals: {
          videos: videos.length,
          actors: actors.length,
          studios: new Set(videos.map((v) => v.studio).filter(Boolean)).size,
          totalSize: formatBytes(totalBytes),
          unseen: unseen.length,
          halfWatched: halfWatched.length,
          missingCover: missingCover.length,
          missingMeta: missingMeta.length,
          duplicates: duplicates.length,
          bookmarks: (timeline.bookmarks || []).length,
        },
        recent,
        large,
        unseen: unseen.slice(0, 24),
        issues: {
          missingCover: missingCover.slice(0, 30),
          missingMeta: missingMeta.slice(0, 30),
          noPreview: noPreview.slice(0, 30),
          duplicates: duplicates.slice(0, 30),
        },
        actors: actors.slice(0, 80),
        allActors: actors,
        notifications,
        achievements,
        addedByDay,
        timeline: (timeline.bookmarks || []).slice(-50).reverse(),
      };
    }),

  search: t.procedure
    .input((input: unknown) => input as { rootPath: string; query: string })
    .query(async ({ input }) => {
      const q = input.query.trim().toLowerCase();
      if (!q) return [];
      const videos = await scanLibrary(input.rootPath);
      return videos
        .filter((video) => {
          const hay = [
            video.name,
            video.code,
            video.title,
            video.studio,
            video.label,
            video.director,
            ...(video.actors || []),
            ...(video.genres || []),
          ].filter(Boolean).join(" ").toLowerCase();
          return hay.includes(q);
        })
        .slice(0, 80);
    }),

  slot: t.procedure
    .input((input: unknown) => input as { rootPath: string; actor?: string; genre?: string; maxMinutes?: number })
    .query(async ({ input }) => {
      let videos = await scanLibrary(input.rootPath);
      if (input.actor) videos = videos.filter((video) => video.actors?.includes(input.actor!));
      if (input.genre) videos = videos.filter((video) => video.genres?.includes(input.genre!));
      if (input.maxMinutes) {
        videos = videos.filter((video) => {
          const minutes = Number(String(video.duration || "").match(/\d+/)?.[0] || 0);
          return !minutes || minutes <= input.maxMinutes!;
        });
      }
      return videos.sort(() => Math.random() - 0.5).slice(0, 5);
    }),

  ingestPlan: t.procedure
    .input((input: unknown) => input as { rootPath: string })
    .query(async ({ input }) => {
      const videos = await scanLibrary(input.rootPath);
      return {
        total: videos.length,
        steps: [
          { key: "verify", label: "校验视频文件", count: videos.length, status: "ready" },
          { key: "meta", label: "识别番号/补 meta.json", count: videos.filter((v) => !v.code || !v.title).length, status: "ready" },
          { key: "cover", label: "生成或补齐封面", count: videos.filter((v) => !v.coverUrl).length, status: "ready" },
          { key: "preview", label: "生成预览短片", count: videos.filter((v) => !v.previewUrl).length, status: "ready" },
          { key: "index", label: "刷新片库索引", count: videos.length, status: "ready" },
        ],
      };
    }),

  runIngest: t.procedure
    .input((input: unknown) => input as { rootPath: string })
    .mutation(async ({ input }) => {
      const videos = await scanLibrary(input.rootPath);
      let writtenMeta = 0;
      for (const video of videos) {
        const folder = path.dirname(video.url);
        const metaPath = path.join(folder, "meta.json");
        if (fs.existsSync(metaPath)) continue;
        const code = video.code || normalizeCode(video.name);
        if (!code) continue;
        const meta = {
          code,
          title: video.title || video.name,
          actors: video.actors || [],
          genres: video.genres || [],
          savePath: folder,
          sourceSite: "Local",
          scrapedAt: new Date().toISOString(),
        };
        await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
        writtenMeta += 1;
      }
      return {
        success: true,
        writtenMeta,
        message: `基础入库完成：写入 ${writtenMeta} 个 meta.json。封面/预览仍可用播放器修复队列生成。`,
      };
    }),

  health: t.procedure
    .input((input: unknown) => input as { rootPath: string; tempPath?: string })
    .query(async ({ input }) => {
      const checks: Array<{ label: string; status: "ok" | "warn" | "error"; detail: string }> = [];
      const rootExists = !!input.rootPath && fs.existsSync(input.rootPath);
      checks.push({
        label: "视频目录",
        status: rootExists ? "ok" : "error",
        detail: rootExists ? input.rootPath : "目录不存在或未设置",
      });
      if (input.tempPath) {
        checks.push({
          label: "临时目录",
          status: fs.existsSync(input.tempPath) ? "ok" : "warn",
          detail: input.tempPath,
        });
      }
      const userData = app.getPath("userData");
      checks.push({
        label: "用户数据目录",
        status: fs.existsSync(userData) ? "ok" : "error",
        detail: userData,
      });
      checks.push({
        label: "统计文件",
        status: fs.existsSync(path.join(userData, "stats.json")) ? "ok" : "warn",
        detail: path.join(userData, "stats.json"),
      });

      let free = -1;
      let total = -1;
      try {
        if (rootExists) {
          const stat = await fs.promises.statfs(input.rootPath);
          free = stat.bavail * stat.bsize;
          total = stat.blocks * stat.bsize;
          checks.push({
            label: "磁盘空间",
            status: free / Math.max(1, total) < 0.08 ? "warn" : "ok",
            detail: `${formatBytes(free)} 可用 / ${formatBytes(total)} 总量`,
          });
        }
      } catch {
        checks.push({ label: "磁盘空间", status: "warn", detail: "无法读取磁盘空间" });
      }

      return {
        checks,
        freeBytes: free,
        totalBytes: total,
        appVersion: app.getVersion(),
        userData,
      };
    }),

  addTimelineBookmark: t.procedure
    .input((input: unknown) => input as { videoName: string; videoUrl: string; currentTime: number; duration?: number; note?: string })
    .mutation(async ({ input }) => {
      const file = path.join(app.getPath("userData"), "timeline.json");
      const store = loadTimelineStore();
      const bookmark = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        videoName: input.videoName,
        videoUrl: input.videoUrl,
        currentTime: Math.floor(input.currentTime || 0),
        duration: Math.floor(input.duration || 0),
        note: input.note || "",
        createdAt: new Date().toISOString(),
      };
      store.bookmarks = [...(store.bookmarks || []), bookmark].slice(-500);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, JSON.stringify(store, null, 2), "utf8");
      return { success: true, bookmark };
    }),

  deleteTimelineBookmark: t.procedure
    .input((input: unknown) => input as { id: string })
    .mutation(async ({ input }) => {
      const file = path.join(app.getPath("userData"), "timeline.json");
      const store = loadTimelineStore();
      const before = Array.isArray(store.bookmarks) ? store.bookmarks.length : 0;
      store.bookmarks = (store.bookmarks || []).filter((item: { id?: string }) => item.id !== input.id);
      const deleted = store.bookmarks.length !== before;
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, JSON.stringify(store, null, 2), "utf8");
      return { success: deleted, deleted };
    }),

  timeline: t.procedure
    .input((input: unknown) => input as { videoName?: string; videoUrl?: string })
    .query(({ input }) => {
      const store = loadTimelineStore();
      const bookmarks = (store.bookmarks || []) as Array<{
        id: string;
        videoName: string;
        videoUrl: string;
        currentTime: number;
        duration?: number;
        note?: string;
        createdAt: string;
      }>;
      return bookmarks
        .filter((item) => {
          if (input.videoUrl && item.videoUrl === input.videoUrl) return true;
          if (input.videoName && item.videoName === input.videoName) return true;
          return !input.videoName && !input.videoUrl;
        })
        .slice()
        .reverse();
    }),

  directorCut: t.procedure.query(() => {
    const store = loadTimelineStore();
    return Array.isArray(store.directorCut) ? store.directorCut : [];
  }),

  saveDirectorCut: t.procedure
    .input(
      (input: unknown) =>
        input as {
          clips: Array<{
            id: string;
            videoName: string;
            videoUrl: string;
            currentTime: number;
            note?: string;
            createdAt?: string;
            clipDuration?: number;
          }>;
        },
    )
    .mutation(async ({ input }) => {
      const file = path.join(app.getPath("userData"), "timeline.json");
      const store = loadTimelineStore();
      const seen = new Set<string>();
      store.directorCut = (Array.isArray(input.clips) ? input.clips : [])
        .filter((clip) => {
          if (!clip?.id || !clip.videoUrl || seen.has(clip.id)) return false;
          seen.add(clip.id);
          return true;
        })
        .slice(0, 100)
        .map((clip) => ({
          ...clip,
          currentTime: Math.max(0, Math.floor(Number(clip.currentTime) || 0)),
          clipDuration: Math.min(
            120,
            Math.max(5, Math.floor(Number(clip.clipDuration) || 20)),
          ),
        }));
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, JSON.stringify(store, null, 2), "utf8");
      return { success: true, clips: store.directorCut };
    }),

  /** 扫描删除失败残留 / 空目录 / 临时目录垃圾 */
  scanCleanupTargets: t.procedure
    .input((input: unknown) => input as { rootPath: string; tempPath?: string })
    .query(async ({ input }) => {
      const items: CleanupItem[] = [];
      const rootPath = input.rootPath?.trim();
      if (rootPath && fs.existsSync(rootPath)) {
        const names = await fs.promises.readdir(rootPath).catch(() => [] as string[]);
        for (const name of names) {
          if (name.startsWith(".") || name === ".avplay_index.json") continue;
          const folderPath = path.join(rootPath, name);
          const st = await fs.promises.stat(folderPath).catch(() => null);
          if (!st) continue;

          if (st.isFile()) {
            const { bytes, files } = await measurePath(folderPath);
            items.push({
              id: `root-file:${name}`,
              path: folderPath,
              name,
              kind: "loose_file",
              reason: "片库根目录散落文件（非标准文件夹结构）",
              sizeBytes: bytes,
              sizeLabel: formatBytes(bytes),
              fileCount: files,
              selectedByDefault: true,
            });
            continue;
          }

          if (!st.isDirectory()) continue;

          const entries = await fs.promises.readdir(folderPath).catch(() => [] as string[]);
          const videoName = findByExt(
            entries.filter((n) => !/^preview\./i.test(n)),
            VIDEO_EXTS,
            ["video.mp4", "video.mkv", "video.ts", "video.m4v"],
          );

          if (!videoName) {
            const { bytes, files } = await measurePath(folderPath);
            const kind: CleanupKind = files === 0 ? "empty" : "no_video";
            items.push({
              id: `orphan:${name}`,
              path: folderPath,
              name,
              kind,
              reason:
                kind === "empty"
                  ? "空文件夹"
                  : "无正片文件（多半是删除失败留下的 meta/封面/缩略图）",
              sizeBytes: bytes,
              sizeLabel: formatBytes(bytes),
              fileCount: files,
              selectedByDefault: true,
            });
            continue;
          }

          const videoPath = path.join(folderPath, videoName);
          const videoStat = await fs.promises.stat(videoPath).catch(() => null);
          const videoSize = videoStat?.size || 0;
          // 过小的正片通常是下载中断残留
          if (videoSize > 0 && videoSize < 5 * 1024 * 1024) {
            const { bytes, files } = await measurePath(folderPath);
            items.push({
              id: `tiny:${name}`,
              path: folderPath,
              name,
              kind: "tiny_video",
              reason: `正片过小（${formatBytes(videoSize)}），疑似下载不完整`,
              sizeBytes: bytes,
              sizeLabel: formatBytes(bytes),
              fileCount: files,
              selectedByDefault: false,
            });
          }
        }
      }

      const tempPath = input.tempPath?.trim();
      if (tempPath && fs.existsSync(tempPath)) {
        const names = await fs.promises.readdir(tempPath).catch(() => [] as string[]);
        for (const name of names) {
          if (name.startsWith(".")) continue;
          const target = path.join(tempPath, name);
          const { bytes, files } = await measurePath(target);
          if (files === 0 && bytes === 0) continue;
          items.push({
            id: `temp:${name}`,
            path: target,
            name,
            kind: "temp",
            reason: "临时目录残留（下载/转码缓存）",
            sizeBytes: bytes,
            sizeLabel: formatBytes(bytes),
            fileCount: files,
            selectedByDefault: true,
          });
        }
      }

      items.sort((a, b) => b.sizeBytes - a.sizeBytes);
      const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
      return {
        items,
        totalBytes,
        totalLabel: formatBytes(totalBytes),
        orphanCount: items.filter((i) => i.kind === "empty" || i.kind === "no_video").length,
        tempCount: items.filter((i) => i.kind === "temp").length,
        tinyCount: items.filter((i) => i.kind === "tiny_video").length,
      };
    }),

  /** 批量删除扫描出的残留路径 */
  cleanCleanupTargets: t.procedure
    .input(
      (input: unknown) =>
        input as { rootPath: string; tempPath?: string; paths: string[] },
    )
    .mutation(async ({ input }) => {
      const paths = Array.isArray(input.paths) ? input.paths : [];
      if (paths.length === 0) {
        return { success: false, deleted: 0, failed: [] as string[], freedBytes: 0, message: "未选择任何项" };
      }

      const allowedRoots = [input.rootPath, input.tempPath]
        .filter((p): p is string => !!p?.trim())
        .map((p) => path.resolve(p.trim()));

      const failed: string[] = [];
      let deleted = 0;
      let freedBytes = 0;

      for (const raw of paths) {
        const target = path.resolve(raw);
        const underAllowed = allowedRoots.some((root) => {
          const rel = path.relative(root, target);
          return (
            rel !== "" &&
            !rel.startsWith("..") &&
            !path.isAbsolute(rel)
          );
        });
        if (!underAllowed) {
          failed.push(`${target}（不在允许目录内）`);
          continue;
        }

        // 片库根下只允许删一级子项；临时目录允许更深
        const parent = path.dirname(target);
        const underRoot = allowedRoots.some((root) => {
          const same =
            process.platform === "win32"
              ? parent.toLowerCase() === root.toLowerCase()
              : parent === root;
          return same;
        });
        const underTempDeep =
          !!input.tempPath &&
          (() => {
            const tempRoot = path.resolve(input.tempPath!);
            const rel = path.relative(tempRoot, target);
            return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
          })();

        if (!underRoot && !underTempDeep) {
          failed.push(`${target}（仅允许删除根目录一级子项）`);
          continue;
        }

        try {
          const measured = await measurePath(target);
          if (!fs.existsSync(target)) {
            failed.push(`${target}（不存在）`);
            continue;
          }
          fs.rmSync(target, { recursive: true, force: true });
          deleted += 1;
          freedBytes += measured.bytes;
        } catch (err: any) {
          failed.push(`${target}（${err?.message || err}）`);
        }
      }

      // 清掉片库列表缓存，避免残留还显示
      if (input.rootPath) {
        invalidateVideoListCache(input.rootPath);
      }

      return {
        success: failed.length === 0,
        deleted,
        failed,
        freedBytes,
        freedLabel: formatBytes(freedBytes),
        message:
          failed.length === 0
            ? `已清理 ${deleted} 项，释放 ${formatBytes(freedBytes)}`
            : `已清理 ${deleted} 项，${failed.length} 项失败`,
      };
    }),
});
