import { t } from "../trpc";
import { loadModel, predict, train, TagModel } from "../intel/tagModel";

export const intelRouter = t.router({
  // 当前模型状态
  status: t.procedure.query(() => {
    const m = loadModel();
    return m
      ? {
          trained: true,
          trainedAt: m.trainedAt,
          samples: m.samples,
          mu: m.mu,
        }
      : { trained: false };
  }),

  // 训练：前端把已有的 videos（含 meta）+ stats + favorites 集合发上来
  // 服务端不再走 fs 扫描，避免重复 I/O
  train: t.procedure
    .input(
      (input: unknown) =>
        input as {
          videos: Array<{ folder: string; meta: Record<string, any> }>;
          stats: Record<string, { playCount?: number; watchSec?: number }>;
          favorites: string[];
        },
    )
    .mutation(({ input }) => {
      const m = train(
        input.videos,
        input.stats,
        new Set(input.favorites),
      );
      return {
        success: true,
        trainedAt: m.trainedAt,
        samples: m.samples,
        mu: m.mu,
      };
    }),

  // 批量预测：返回每个 folder 的 score / affinity / 解释
  predictBatch: t.procedure
    .input(
      (input: unknown) =>
        input as {
          items: Array<{ folder: string; meta: Record<string, any> }>;
        },
    )
    .query(({ input }) => {
      const m = loadModel();
      if (!m) return { trained: false, results: [] as any[] };
      const results = input.items.map((it) => ({
        folder: it.folder,
        ...predict(it.meta, m),
      }));
      return { trained: true, results };
    }),

  // 单条预测：用于详情页/卡片
  predictOne: t.procedure
    .input((input: unknown) => input as { meta: Record<string, any> })
    .query(({ input }) => {
      const m = loadModel();
      if (!m) return { trained: false as const };
      return { trained: true as const, ...predict(input.meta, m) };
    }),
});
