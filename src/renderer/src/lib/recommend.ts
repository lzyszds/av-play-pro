import type { VideoItem } from "../pages/player/types";

export interface RecommendationContext {
  /** key: folder path（由 deriveFolderFromUrl 得到），value: 已播放次数 */
  playCountByFolder?: Record<string, number>;
  /** key: folder path，value: heat 信号 */
  heatByFolder?: Record<string, "hot" | "cold" | "normal">;
  /** 已加入心爱的 video.id 集合 */
  favorites?: Set<string>;
}

export function scoreSimilarity(
  current: VideoItem,
  other: VideoItem,
  ctx: RecommendationContext = {},
  folderResolver?: (v: VideoItem) => string | null,
): number {
  if (other.id === current.id) return -Infinity;
  let s = 0;

  // 同演员（最重要）
  if (current.actors && other.actors) {
    const cur = new Set(current.actors);
    let shared = 0;
    for (const a of other.actors) if (cur.has(a)) shared++;
    s += Math.min(shared * 5, 12);
  }

  // 同系列
  if (
    current.studioSeries &&
    other.studioSeries &&
    current.studioSeries === other.studioSeries
  ) {
    s += 3;
  }

  // 同片商
  if (current.studio && other.studio && current.studio === other.studio) {
    s += 2;
  }

  // 同 label
  if (current.label && other.label && current.label === other.label) {
    s += 1;
  }

  // 同分类标签（每个 +1，上限 5）
  if (current.genres && other.genres) {
    const cur = new Set(current.genres);
    let shared = 0;
    for (const g of other.genres) if (cur.has(g)) shared++;
    s += Math.min(shared, 5);
  }

  // 同导演
  if (
    current.director &&
    other.director &&
    current.director === other.director
  ) {
    s += 1;
  }

  // 评分加成
  if (typeof other.rating === "number" && other.rating > 0) {
    s += Math.min(other.rating / 2, 2.5);
  }

  // 心爱
  if (ctx.favorites?.has(other.id)) s += 1.5;

  // 热度信号
  if (folderResolver) {
    const folder = folderResolver(other);
    if (folder) {
      // 已看过的惩罚（鼓励看没看过的）
      const pc = ctx.playCountByFolder?.[folder] || 0;
      if (pc > 0) s -= Math.min(pc * 1.5, 4);
      // 冷数据小加成（"想起来还有这部"），hot 不再加分避免推荐同质
      const heat = ctx.heatByFolder?.[folder];
      if (heat === "cold") s += 0.8;
    }
  }

  return s;
}

export function recommendNextUp(
  current: VideoItem | null,
  all: VideoItem[],
  ctx: RecommendationContext,
  folderResolver: (v: VideoItem) => string | null,
  limit = 6,
): VideoItem[] {
  if (!current) return [];
  const scored = all
    .map((v) => ({ v, score: scoreSimilarity(current, v, ctx, folderResolver) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.v);
  return scored;
}
