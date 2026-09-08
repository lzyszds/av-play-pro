import { t } from "../trpc";
import { detectIntensity, exportIntensityCut, readIntensity } from "../intensity/intensityDetector";

export const intensityRouter = t.router({
  get: t.procedure.input((input: unknown) => input as { folder: string }).query(({ input }) => readIntensity(input.folder)),
  analyze: t.procedure.input((input: unknown) => input as { folder: string; force?: boolean }).mutation(async ({ input }) => {
    const cached = !input.force ? readIntensity(input.folder) : null;
    return { data: cached || await detectIntensity(input.folder), cached: !!cached };
  }),
  exportCut: t.procedure.input((input: unknown) => input as { folder: string; points: number[]; clipSeconds?: number }).mutation(({ input }) => exportIntensityCut({ folder: input.folder, points: input.points, clipSeconds: input.clipSeconds || 18 })),
});
