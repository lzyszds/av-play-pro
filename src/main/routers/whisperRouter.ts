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

  // 找到指定视频文件夹下是否已有 srt/vtt 字幕
  hasSubtitle: t.procedure
    .input(z.object({ folder: z.string() }))
    .query(({ input }) => {
      const candidates: Array<[string, string]> = [
        ["srt", path.join(input.folder, "video.srt")],
        ["vtt", path.join(input.folder, "video.vtt")],
        ["srt", path.join(input.folder, "video.ja.srt")],
        ["srt", path.join(input.folder, "video.zh.srt")],
      ];
      for (const [_ext, p] of candidates) {
        if (fs.existsSync(p)) {
          return { exists: true as const, srtPath: p };
        }
      }
      return { exists: false as const, srtPath: null };
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
        force: z.boolean().optional().default(false),
      }),
    )
    .mutation(({ input }) => {
      // 缺少相应文件才入队；已存在字幕时直接跳过（除非 force=true）
      const folder = path.dirname(input.videoPath);
      if (!input.force) {
        const candidates = [
          path.join(folder, "video.srt"),
          path.join(folder, "video.vtt"),
          path.join(folder, "video.ja.srt"),
          path.join(folder, "video.zh.srt"),
        ];
        for (const p of candidates) {
          if (fs.existsSync(p)) {
            return { jobId: null, skipped: true, srtPath: p, message: "subtitle already exists" };
          }
        }
      }
      const job = enqueueTranscribe(input.videoPath, input.model, input.language);
      return { jobId: job.id, skipped: false, srtPath: null };
    }),

  listJobs: t.procedure.query(() => listJobs()),

  cancelJob: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => ({ canceled: cancelJob(input.id) })),

  paths: t.procedure.query(() => ({
    root: whisperPaths.root(),
    whisperBin: whisperPaths.whisperBin(),
    ffmpegBin: whisperPaths.localFfmpeg(),
  })),
});
