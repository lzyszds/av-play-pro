import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { t } from "../trpc";
import { log } from "../logger";

export interface ActivityBucket {
  plays: number;
  watchSec: number;
  downloads: number;
  downloadBytes: number;
}

export type DailyBucket = ActivityBucket;

export interface VideoEntry {
  folder: string;
  playCount: number;
  watchSec: number;
  lastPlayedAt: string | null;
  firstPlayedAt: string | null;
  series: string | null;
  actors?: string[];
}

export interface RankingItem {
  name: string;
  count: number;
  watchSec: number;
  score: number;
}

export interface DiskPrediction {
  daysRemaining: number | null;
  predictedFullAt: string | null;
  avgDailyGrowth: number;
}

export interface DiskSnapshot {
  at: string;
  totalBytes: number;
  videoCount: number;
  freeBytes?: number;
  totalDiskBytes?: number;
}

export interface ArousalSession {
  startedAt: string;
  endedAt: string;
  durationSec: number;
  videoFolder?: string | null;
}

export interface ArousalData {
  sessions: ArousalSession[];
  totals: { count: number; totalSec: number };
}

export interface StatsData {
  version: 2;
  daily: Record<string, ActivityBucket>;
  hourly: Record<string, ActivityBucket>;
  weekdays: Record<string, ActivityBucket>;
  monthly: Record<string, ActivityBucket>;
  videos: Record<string, VideoEntry>;
  diskSnapshots: DiskSnapshot[];
  totals: ActivityBucket;
  arousal: ArousalData;
}

function emptyBucket(): ActivityBucket {
  return { plays: 0, watchSec: 0, downloads: 0, downloadBytes: 0 };
}

function emptyArousal(): ArousalData {
  return { sessions: [], totals: { count: 0, totalSec: 0 } };
}

function emptyStats(): StatsData {
  return {
    version: 2,
    daily: {},
    hourly: {},
    weekdays: {},
    monthly: {},
    videos: {},
    diskSnapshots: [],
    totals: emptyBucket(),
    arousal: emptyArousal(),
  };
}

function statsPath(): string {
  return path.join(app.getPath("userData"), "stats.json");
}

function dateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function hourKey(d = new Date()): string {
  return String(d.getHours()).padStart(2, "0");
}

function weekdayKey(d = new Date()): string {
  return String(d.getDay());
}

function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeBucket(bucket?: Partial<ActivityBucket>): ActivityBucket {
  return {
    plays: Number(bucket?.plays || 0),
    watchSec: Number(bucket?.watchSec || 0),
    downloads: Number(bucket?.downloads || 0),
    downloadBytes: Number(bucket?.downloadBytes || 0),
  };
}

function normalizeBuckets(
  buckets?: Record<string, Partial<ActivityBucket>>,
): Record<string, ActivityBucket> {
  const out: Record<string, ActivityBucket> = {};
  for (const [key, value] of Object.entries(buckets || {})) {
    out[key] = normalizeBucket(value);
  }
  return out;
}

// =================== 核心优化：内存缓存与异步 IO ===================

let cachedStats: StatsData | null = null;
let saveTimeout: NodeJS.Timeout | null = null;

function loadStatsSync(): StatsData {
  if (cachedStats) return cachedStats;
  try {
    const file = statsPath();
    if (!fs.existsSync(file)) {
      cachedStats = emptyStats();
      return cachedStats;
    }
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<StatsData>;
    cachedStats = {
      version: 2,
      daily: normalizeBuckets(data.daily),
      hourly: normalizeBuckets(data.hourly),
      weekdays: normalizeBuckets(data.weekdays),
      monthly: normalizeBuckets(data.monthly),
      videos: data.videos || {},
      diskSnapshots: (data.diskSnapshots || []).map((snap) => ({
        at: snap.at,
        totalBytes: Number(snap.totalBytes || 0),
        videoCount: Number(snap.videoCount || 0),
        freeBytes: snap.freeBytes == null ? undefined : Number(snap.freeBytes || 0),
        totalDiskBytes: snap.totalDiskBytes == null ? undefined : Number(snap.totalDiskBytes || 0),
      })),
      totals: normalizeBucket(data.totals),
      arousal: {
        sessions: Array.isArray((data as any).arousal?.sessions)
          ? (data as any).arousal.sessions.map((s: any) => ({
              startedAt: String(s.startedAt || ""),
              endedAt: String(s.endedAt || ""),
              durationSec: Math.max(0, Math.floor(Number(s.durationSec) || 0)),
              videoFolder: s.videoFolder ?? null,
            }))
          : [],
        totals: {
          count: Math.max(0, Number((data as any).arousal?.totals?.count) || 0),
          totalSec: Math.max(0, Number((data as any).arousal?.totals?.totalSec) || 0),
        },
      },
    };
    return cachedStats;
  } catch (err: any) {
    log.error(`[stats] load failed: ${err?.message}`);
    cachedStats = emptyStats();
    return cachedStats;
  }
}

async function saveStatsAsync(s: StatsData, immediate = false): Promise<void> {
  cachedStats = s;
  if (saveTimeout && !immediate) return;

  const performSave = async () => {
    try {
      const file = statsPath();
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, JSON.stringify(cachedStats, null, 2), "utf8");
      saveTimeout = null;
    } catch (err: any) {
      log.error(`[stats] save failed: ${err?.message}`);
    }
  };

  if (immediate) {
    if (saveTimeout) clearTimeout(saveTimeout);
    await performSave();
  } else {
    saveTimeout = setTimeout(performSave, 30000); 
  }
}

// 退出前强制落盘
app.on("before-quit", () => {
  if (cachedStats) {
    const file = statsPath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cachedStats, null, 2), "utf8");
  }
});

function ensureBucket(buckets: Record<string, ActivityBucket>, key: string): ActivityBucket {
  if (!buckets[key]) buckets[key] = emptyBucket();
  return buckets[key];
}

function ensureVideo(s: StatsData, folder: string, series?: string | null, actors?: string[]): VideoEntry {
  if (!s.videos[folder]) {
    s.videos[folder] = {
      folder,
      playCount: 0,
      watchSec: 0,
      lastPlayedAt: null,
      firstPlayedAt: null,
      series: series ?? null,
      actors: actors ?? [],
    };
  } else {
    if (series && !s.videos[folder].series) s.videos[folder].series = series;
    if (actors && actors.length > 0) {
      const existing = new Set(s.videos[folder].actors || []);
      actors.forEach((a) => existing.add(a));
      s.videos[folder].actors = Array.from(existing);
    }
  }
  return s.videos[folder];
}

function addToAllBuckets(s: StatsData, patch: Partial<ActivityBucket>, at = new Date()): void {
  const targets = [
    ensureBucket(s.daily, dateKey(at)),
    ensureBucket(s.hourly, hourKey(at)),
    ensureBucket(s.weekdays, weekdayKey(at)),
    ensureBucket(s.monthly, monthKey(at)),
    s.totals,
  ];
  for (const bucket of targets) {
    bucket.plays += patch.plays || 0;
    bucket.watchSec += patch.watchSec || 0;
    bucket.downloads += patch.downloads || 0;
    bucket.downloadBytes += patch.downloadBytes || 0;
  }
}

async function walkVideoDirAsync(root: string): Promise<{ totalBytes: number; videoCount: number }> {
  let totalBytes = 0;
  let videoCount = 0;
  const videoExts = new Set([".mp4", ".mkv", ".ts", ".m4v", ".mov", ".webm", ".avi", ".flv"]);
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          const st = await fs.promises.stat(full);
          totalBytes += st.size;
          if (videoExts.has(path.extname(entry.name).toLowerCase())) {
            videoCount++;
          }
        } catch {}
      }
    }
    // 关键：每轮循环主动释放主线程，防止阻塞 UI
    if (videoCount % 50 === 0) await new Promise(r => setImmediate(r));
  }
  return { totalBytes, videoCount };
}

function readDiskSpace(root: string): Pick<DiskSnapshot, "freeBytes" | "totalDiskBytes"> {
  try {
    const stat = fs.statfsSync(root);
    return { freeBytes: stat.bavail * stat.bsize, totalDiskBytes: stat.blocks * stat.bsize };
  } catch {
    return {};
  }
}

// =================== Router ===================

export const statsRouter = t.router({
  get: t.procedure.query(() => loadStatsSync()),

  recordPlay: t.procedure
    .input((input: unknown) => input as { folder: string; series?: string | null; actors?: string[] })
    .mutation(async ({ input }) => {
      const folder = input.folder?.trim();
      if (!folder) return { success: false, error: "folder is required" };
      const s = loadStatsSync();
      const now = new Date();
      const v = ensureVideo(s, folder, input.series ?? null, input.actors);
      v.playCount += 1;
      v.lastPlayedAt = now.toISOString();
      if (!v.firstPlayedAt) v.firstPlayedAt = now.toISOString();
      addToAllBuckets(s, { plays: 1 }, now);
      await saveStatsAsync(s);
      return { success: true, playCount: v.playCount };
    }),

  recordWatch: t.procedure
    .input((input: unknown) => input as { folder: string; sec: number; series?: string | null; actors?: string[] })
    .mutation(async ({ input }) => {
      const folder = input.folder?.trim();
      const sec = Math.max(0, Math.floor(input.sec));
      if (!folder || sec === 0) return { success: true };
      const s = loadStatsSync();
      const now = new Date();
      const v = ensureVideo(s, folder, input.series ?? null, input.actors);
      v.watchSec += sec;
      v.lastPlayedAt = now.toISOString();
      addToAllBuckets(s, { watchSec: sec }, now);
      await saveStatsAsync(s);
      return { success: true, totalSec: v.watchSec };
    }),

  recordDownload: t.procedure
    .input((input: unknown) => input as { bytes?: number })
    .mutation(async ({ input }) => {
      const s = loadStatsSync();
      const bytes = Math.max(0, Math.floor(input.bytes || 0));
      addToAllBuckets(s, { downloads: 1, downloadBytes: bytes });
      await saveStatsAsync(s);
      return { success: true };
    }),

  snapshotDisk: t.procedure
    .input((input: unknown) => input as { rootPath: string; force?: boolean })
    .mutation(async ({ input }) => {
      const rootPath = input.rootPath?.trim();
      if (!rootPath || !fs.existsSync(rootPath)) return { success: false, error: "rootPath not found" };
      const s = loadStatsSync();
      const last = s.diskSnapshots[s.diskSnapshots.length - 1];
      if (!input.force && last?.at.slice(0, 10) === dateKey()) return { success: true, skipped: true };
      const usage = await walkVideoDirAsync(rootPath);
      const diskSpace = readDiskSpace(rootPath);
      s.diskSnapshots.push({ at: new Date().toISOString(), ...usage, ...diskSpace });
      if (s.diskSnapshots.length > 365) s.diskSnapshots = s.diskSnapshots.slice(-365);
      await saveStatsAsync(s, true);
      return { success: true, ...usage, ...diskSpace };
    }),

  getRankings: t.procedure.query(() => {
    const s = loadStatsSync();
    const seriesMap = new Map<string, RankingItem>();
    const actorsMap = new Map<string, RankingItem>();
    for (const v of Object.values(s.videos)) {
      if (v.series) {
        const item = seriesMap.get(v.series) || { name: v.series, count: 0, watchSec: 0, score: 0 };
        item.count += v.playCount; item.watchSec += v.watchSec;
        item.score = item.count * 10 + item.watchSec / 60;
        seriesMap.set(v.series, item);
      }
      if (v.actors) {
        for (const actor of v.actors) {
          const item = actorsMap.get(actor) || { name: actor, count: 0, watchSec: 0, score: 0 };
          item.count += v.playCount; item.watchSec += v.watchSec;
          item.score = item.count * 10 + item.watchSec / 60;
          actorsMap.set(actor, item);
        }
      }
    }
    const sortFn = (a: RankingItem, b: RankingItem) => b.score - a.score;
    return { series: Array.from(seriesMap.values()).sort(sortFn).slice(0, 20), actors: Array.from(actorsMap.values()).sort(sortFn).slice(0, 20) };
  }),

  getDiskPrediction: t.procedure.query((): DiskPrediction => {
    const s = loadStatsSync();
    if (s.diskSnapshots.length < 2) return { daysRemaining: null, predictedFullAt: null, avgDailyGrowth: 0 };
    const first = s.diskSnapshots[0];
    const last = s.diskSnapshots[s.diskSnapshots.length - 1];
    const daysDiff = (new Date(last.at).getTime() - new Date(first.at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff < 1) return { daysRemaining: null, predictedFullAt: null, avgDailyGrowth: 0 };
    const avgDailyGrowth = (last.totalBytes - first.totalBytes) / daysDiff;
    if (avgDailyGrowth <= 0 || !last.freeBytes) return { daysRemaining: null, predictedFullAt: null, avgDailyGrowth };
    const daysRemaining = Math.floor(last.freeBytes / avgDailyGrowth);
    return { daysRemaining, predictedFullAt: new Date(Date.now() + daysRemaining * 86400000).toISOString(), avgDailyGrowth };
  }),

  recordArousal: t.procedure
    .input((input: unknown) => input as { startedAt: string; endedAt: string; durationSec: number; videoFolder?: string | null })
    .mutation(async ({ input }) => {
      const durationSec = Math.max(0, Math.floor(input.durationSec || 0));
      if (durationSec < 1) return { success: false };
      const s = loadStatsSync();
      if (!s.arousal) s.arousal = emptyArousal();
      s.arousal.sessions.push({ startedAt: input.startedAt, endedAt: input.endedAt, durationSec, videoFolder: input.videoFolder ?? null });
      if (s.arousal.sessions.length > 2000) s.arousal.sessions = s.arousal.sessions.slice(-2000);
      s.arousal.totals.count += 1;
      s.arousal.totals.totalSec += durationSec;
      await saveStatsAsync(s);
      return { success: true, totals: s.arousal.totals };
    }),

  reset: t.procedure.mutation(async () => {
    cachedStats = emptyStats();
    await saveStatsAsync(cachedStats, true);
    return { success: true };
  }),
});
