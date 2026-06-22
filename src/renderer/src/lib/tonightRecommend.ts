// 今晚推荐：基于偏好画像 + 新鲜度 + 多样性
// - 偏好画像：从 stats 反推（最常看的演员/标签/片商权重）
// - 新鲜度：未播放 > 长期未看 > 近期看过
// - 多样性：同一演员最多出现 N 次
import type { VideoItem } from "../pages/player/types";

export interface UserProfile {
  /** 演员 → 权重（基于观看次数+时长） */
  actorWeight: Record<string, number>;
  /** 片商 → 权重 */
  studioWeight: Record<string, number>;
  /** 分类 → 权重 */
  genreWeight: Record<string, number>;
}

export function buildProfileFromStats(
  videos: Record<
    string,
    {
      playCount?: number;
      watchSec?: number;
      actors?: string[];
      series?: string | null;
    }
  >,
  videoMetaIndex: Map<string, { actors?: string[]; studio?: string; genres?: string[] }>,
): UserProfile {
  const actorWeight: Record<string, number> = {};
  const studioWeight: Record<string, number> = {};
  const genreWeight: Record<string, number> = {};
  for (const folder of Object.keys(videos)) {
    const v = videos[folder];
    const w = (v.playCount || 0) * 10 + (v.watchSec || 0) / 60;
    if (!w) continue;
    const meta = videoMetaIndex.get(folder);
    for (const a of v.actors || meta?.actors || []) {
      actorWeight[a] = (actorWeight[a] || 0) + w;
    }
    if (meta?.studio) studioWeight[meta.studio] = (studioWeight[meta.studio] || 0) + w / 3;
    for (const g of meta?.genres || []) {
      genreWeight[g] = (genreWeight[g] || 0) + w / 4;
    }
  }
  return { actorWeight, studioWeight, genreWeight };
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  // Mulberry32 PRNG
  let s = seed;
  const rand = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface TonightContext {
  profile: UserProfile;
  playCountByFolder: Record<string, number>;
  heatByFolder: Record<string, "hot" | "cold" | "normal">;
  favorites: Set<string>;
  folderResolver: (v: VideoItem) => string | null;
}

function score(v: VideoItem, ctx: TonightContext): number {
  let s = 0;
  // 偏好命中
  for (const a of v.actors || []) {
    s += Math.log1p((ctx.profile.actorWeight[a] || 0) / 50) * 4;
  }
  if (v.studio) s += Math.log1p((ctx.profile.studioWeight[v.studio] || 0) / 30) * 2;
  for (const g of v.genres || []) {
    s += Math.log1p((ctx.profile.genreWeight[g] || 0) / 30);
  }
  // 评分加成
  if (typeof v.rating === "number" && v.rating > 0) s += Math.min(v.rating, 5) / 2;
  // 心爱：略加分（但不要太多，避免老熟人霸榜）
  if (ctx.favorites.has(v.id)) s += 1.2;

  const folder = ctx.folderResolver(v);
  const playCount = folder ? ctx.playCountByFolder[folder] || 0 : 0;
  const heat = folder ? ctx.heatByFolder[folder] || "normal" : "normal";

  if (playCount === 0) s += 3.0; // 未看过：最大加成
  else if (heat === "cold") s += 1.6; // 冷藏老朋友
  else s -= playCount * 1.0; // 近期看过的减分

  return s;
}

export function generateTonightPicks(
  all: VideoItem[],
  ctx: TonightContext,
  limit = 10,
): VideoItem[] {
  // 计算分数 + 用日期 seed 做轻度随机化（同一天多次打开看到的一致）
  const seed = [...todayKey()].reduce((s, c) => s + c.charCodeAt(0), 0);
  const scored = all.map((v, i) => ({
    v,
    score: score(v, ctx),
    tieBreak: ((seed + i * 31) % 997) / 997,
  }));
  scored.sort((a, b) => b.score + b.tieBreak - (a.score + a.tieBreak));

  // 多样性约束：同一演员最多 2 部
  const actorCount = new Map<string, number>();
  const picks: VideoItem[] = [];
  for (const it of scored) {
    if (picks.length >= limit) break;
    const acts = it.v.actors || [];
    let allow = true;
    for (const a of acts) {
      if ((actorCount.get(a) || 0) >= 2) {
        allow = false;
        break;
      }
    }
    if (!allow) continue;
    picks.push(it.v);
    for (const a of acts) actorCount.set(a, (actorCount.get(a) || 0) + 1);
  }
  return seededShuffle(picks, seed); // 同一天内打乱顺序但稳定
}

const CACHE_KEY = "tonightPicks";
export function loadCachedPicks(): { date: string; ids: string[] } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || obj.date !== todayKey()) return null;
    return obj;
  } catch {
    return null;
  }
}
export function saveCachedPicks(ids: string[]) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ date: todayKey(), ids }),
    );
  } catch {}
}
export function clearCachedPicks() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
}
