import { observable } from "@trpc/server/observable";
import { t } from "../trpc";
import {
  list,
  cancel,
  retry,
  clearCompleted,
  enqueue,
  events,
  PostProcessTask,
} from "../postprocess/queue";

export const postprocessRouter = t.router({
  list: t.procedure.query(() => list()),

  enqueue: t.procedure
    .input(
      (input: unknown) =>
        input as { saveDir: string; saveName: string; videoPath?: string },
    )
    .mutation(({ input }) => enqueue(input)),

  retry: t.procedure
    .input((input: unknown) => input as { id: string })
    .mutation(({ input }) => {
      retry(input.id);
      return { success: true };
    }),

  cancel: t.procedure
    .input((input: unknown) => input as { id: string })
    .mutation(({ input }) => {
      cancel(input.id);
      return { success: true };
    }),

  clearCompleted: t.procedure.mutation(() => {
    clearCompleted();
    return { success: true };
  }),

  // 订阅队列变化
  subscribe: t.procedure.subscription(() => {
    return observable<PostProcessTask[]>((emit) => {
      emit.next(list());
      const handler = (tasks: PostProcessTask[]) => emit.next(tasks);
      events.on("change", handler);
      return () => {
        events.off("change", handler);
      };
    });
  }),
});
