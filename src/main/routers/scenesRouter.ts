import { observable } from "@trpc/server/observable";
import { t } from "../trpc";
import {
  detectScenes,
  readScenes,
  cancelDetect,
  sceneEvents,
  ScenesData,
} from "../scenes/sceneDetector";

export const scenesRouter = t.router({
  get: t.procedure
    .input((input: unknown) => input as { folder: string })
    .query(({ input }) => readScenes(input.folder)),

  generate: t.procedure
    .input(
      (input: unknown) =>
        input as { folder: string; threshold?: number; force?: boolean },
    )
    .mutation(async ({ input }) => {
      if (!input.force) {
        const exist = readScenes(input.folder);
        if (exist) return { success: true, data: exist, cached: true };
      }
      const data = await detectScenes(input.folder, input.threshold ?? 0.3);
      return { success: true, data, cached: false };
    }),

  cancel: t.procedure
    .input((input: unknown) => input as { folder: string })
    .mutation(({ input }) => {
      cancelDetect(input.folder);
      return { success: true };
    }),

  // 进度订阅
  progress: t.procedure.subscription(() => {
    return observable<{ folder: string; current: number; duration: number }>(
      (emit) => {
        const onP = (p: any) => emit.next(p);
        const onDone = (p: { folder: string; data: ScenesData }) =>
          emit.next({
            folder: p.folder,
            current: p.data.duration,
            duration: p.data.duration,
          });
        sceneEvents.on("progress", onP);
        sceneEvents.on("done", onDone);
        return () => {
          sceneEvents.off("progress", onP);
          sceneEvents.off("done", onDone);
        };
      },
    );
  }),
});
