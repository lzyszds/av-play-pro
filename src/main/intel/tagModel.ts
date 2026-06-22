// 私人 Tag 模型（纯本地、零依赖）
// 思路：每个特征值（演员/分类/片商/系列/导演/label）单独算"喜欢度均值"
// - 训练：affinity(f) = (Σ love * 出现 + α·μ) / (Σ 出现 + α)   [拉普拉斯平滑]
// - 预测：score(v) = base_μ + Σ_f present(f) * (affinity(f) − μ) × decay
//   分数映射到 0–10
// - 建议标签：把贡献度从大到小排序，取前 K 个
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { log } from "../logger";

const FEATURE_FIELDS = [
  "actors",
  "genres",
  "studio",
  "studioSeries",
  "label",
  "director",
] as const;
type FeatureField = (typeof FEATURE_FIELDS)[number];

interface TrainSample {
  folder: string;
  love: number; // 喜欢度（已归一化到 0..1）
  features: Partial<Record<FeatureField, string[]>>;
}

export interface TagModel {
  /** 平均喜欢度（拉普拉斯平滑的先验） */
  mu: number;
  /** 平滑参数 */
  alpha: number;
  /** 每个特征字段 → {value → {sumLove, count}} */
  stats: Record<FeatureField, Record<string, { sumLove: number; count: number }>>;
  /** 训练时间 */
  trainedAt: string;
  /** 样本数（有 love > 0 的） */
  samples: number;
}

const FILE = () => path.join(app.getPath("userData"), "tag-model.json");

export function loadModel(): TagModel | null {
  try {
    if (!fs.existsSync(FILE())) return null;
    return JSON.parse(fs.readFileSync(FILE(), "utf8"));
  } catch (e: any) {
    log.warn(`[tagModel] load failed: ${e?.message}`);
    return null;
  }
}

export function saveModel(m: TagModel) {
  try {
    fs.writeFileSync(FILE(), JSON.stringify(m, null, 2), "utf8");
  } catch (e: any) {
    log.warn(`[tagModel] save failed: ${e?.message}`);
  }
}

function normalize(s: any): string {
  return String(s || "").trim();
}

function extractFeatures(meta: any): Partial<Record<FeatureField, string[]>> {
  const out: Partial<Record<FeatureField, string[]>> = {};
  if (Array.isArray(meta.actors)) {
    out.actors = meta.actors.map(normalize).filter(Boolean);
  }
  if (Array.isArray(meta.genres)) {
    out.genres = meta.genres.map(normalize).filter(Boolean);
  }
  if (meta.studio) out.studio = [normalize(meta.studio)];
  if (meta.studioSeries) out.studioSeries = [normalize(meta.studioSeries)];
  if (meta.label) out.label = [normalize(meta.label)];
  if (meta.director) out.director = [normalize(meta.director)];
  return out;
}

/** 训练：扫库 + stats，构建特征喜欢度统计 */
export function train(
  videos: Array<{ folder: string; meta: any }>,
  stats: Record<
    string,
    {
      playCount?: number;
      watchSec?: number;
    }
  >,
  favorites: Set<string>,
  alpha = 4,
): TagModel {
  const samples: TrainSample[] = [];
  let sumLove = 0;
  let nLove = 0;

  for (const v of videos) {
    const st = stats[v.folder] || {};
    const playCount = st.playCount || 0;
    const watchSec = st.watchSec || 0;
    const fav = favorites.has(v.folder) ? 1 : 0;
    // 朴素喜欢度：playCount + watchSec/600 + fav*5
    const raw = playCount + watchSec / 600 + fav * 5;
    if (raw <= 0) continue;
    // 归一化到 0..1（用 log 收敛长尾）
    const love = Math.tanh(Math.log1p(raw) / 3);
    sumLove += love;
    nLove += 1;
    samples.push({
      folder: v.folder,
      love,
      features: extractFeatures(v.meta),
    });
  }

  const mu = nLove > 0 ? sumLove / nLove : 0.3;

  const statsMap: TagModel["stats"] = {
    actors: {},
    genres: {},
    studio: {},
    studioSeries: {},
    label: {},
    director: {},
  };

  for (const s of samples) {
    for (const field of FEATURE_FIELDS) {
      const vals = s.features[field] || [];
      for (const val of vals) {
        const bucket = statsMap[field][val] || { sumLove: 0, count: 0 };
        bucket.sumLove += s.love;
        bucket.count += 1;
        statsMap[field][val] = bucket;
      }
    }
  }

  const model: TagModel = {
    mu,
    alpha,
    stats: statsMap,
    trainedAt: new Date().toISOString(),
    samples: samples.length,
  };
  saveModel(model);
  log.info(
    `[tagModel] trained from ${samples.length} samples, mu=${mu.toFixed(3)}`,
  );
  return model;
}

/** 给一段 meta 打分（0..10）+ 解释（top 贡献特征） */
export function predict(
  meta: any,
  model: TagModel,
): {
  score: number;
  /** 0..1 原始喜欢度 */
  affinity: number;
  contributions: Array<{ field: FeatureField; value: string; delta: number }>;
} {
  const feats = extractFeatures(meta);
  const contributions: Array<{
    field: FeatureField;
    value: string;
    delta: number;
  }> = [];

  // 各字段权重（演员最重要）
  const fieldWeight: Record<FeatureField, number> = {
    actors: 1.0,
    genres: 0.5,
    studio: 0.7,
    studioSeries: 0.8,
    label: 0.4,
    director: 0.5,
  };

  let delta = 0;
  for (const field of FEATURE_FIELDS) {
    const vals = feats[field] || [];
    for (const val of vals) {
      const bucket = model.stats[field][val];
      if (!bucket) continue;
      // Laplace 平滑
      const smoothed =
        (bucket.sumLove + model.alpha * model.mu) /
        (bucket.count + model.alpha);
      const d = (smoothed - model.mu) * fieldWeight[field];
      delta += d;
      contributions.push({ field, value: val, delta: d });
    }
  }

  // 把 delta 收敛到 [-mu, 1-mu]
  const affinity = Math.max(0, Math.min(1, model.mu + delta));
  const score = Math.round(affinity * 100) / 10; // 0..10，保留 1 位
  contributions.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { score, affinity, contributions: contributions.slice(0, 8) };
}
