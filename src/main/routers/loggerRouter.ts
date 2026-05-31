import { t } from "../trpc";
import { log } from "../logger";

type Level = "info" | "warn" | "error" | "debug";

export const loggerRouter = t.router({
  write: t.procedure
    .input(
      (input: unknown) =>
        input as { level: Level; scope?: string; message: string },
    )
    .mutation(({ input }) => {
      const tag = input.scope ? `[renderer:${input.scope}]` : "[renderer]";
      const fn = log[input.level] || log.info;
      fn(tag, input.message);
      return { success: true };
    }),
});
