import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { t } from "../trpc";
import {
  cancelJob,
  checkEnv,
  downloadModel,
  enqueueTranscribe,
  installFfmpegBin,
  installWhisperBin,
  listJobs,
  oneClickInstall,
  whisperPaths,
  WhisperModel,
} from "../whisper/whisperManager";

const MODELS: readonly WhisperModel[] = [
  "tiny",
  "base",
  "small",
  "medium",
  "large-v3",
] as const;

export const whisperRouter = t.router({
  checkEnv: t.procedure.query(() => checkEnv()),

  // 找到指定视频文件夹下是否已有 srt
  hasSubtitle: t.procedure
    .input(z.object({ folder: z.string() }))
    .query(({ input }) => {
      const srt = path.join(input.folder, "video.srt");
      const exists = fs.existsSync(srt);
      return { exists, srtPath: exists ? srt : null };
    }),

  downloadModel: t.procedure
    .input(z.object({ model: z.enum(MODELS as unknown as [WhisperModel, ...WhisperModel[]]) }))
    .mutation(async ({ input }) => {
      await downloadModel(input.model);
      return { success: true };
    }),

  installWhisperBin: t.procedure.mutation(async () => {
    await installWhisperBin();
    return { success: true };
  }),

  installFfmpegBin: t.procedure.mutation(async () => {
    await installFfmpegBin();
    return { success: true };
  }),

  oneClickInstall: t.procedure
    .input(
      z
        .object({
          model: z
            .enum(MODELS as unknown as [WhisperModel, ...WhisperModel[]])
            .optional(),
        })
        .optional(),
    )
    .mutation(async ({ input }) => {
      await oneClickInstall(input?.model ?? "base");
      return { success: true };
    }),

  transcribe: t.procedure
    .input(
      z.object({
        videoPath: z.string(),
        model: z.enum(MODELS as unknown as [WhisperModel, ...WhisperModel[]]),
        language: z.string().default("auto"),
      }),
    )
    .mutation(({ input }) => {
      const job = enqueueTranscribe(input.videoPath, input.model, input.language);
      return { jobId: job.id };
    }),

  listJobs: t.procedure.query(() => listJobs()),

  cancelJob: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => ({ canceled: cancelJob(input.id) })),

  paths: t.procedure.query(() => ({
    root: whisperPaths.root(),
    whisperBin: whisperPaths.whisperBin(),
    ffmpegBin: whisperPaths.ffmpegBin(),
  })),
});
