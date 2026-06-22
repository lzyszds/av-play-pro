import { t } from "../trpc";
import {
  getActor,
  listActors,
  upsertActor,
  removeActor,
  ActorRecord,
} from "../actors/actorStore";
import { log } from "../logger";

// 简单的内存级并发去重，避免短时间对同一演员发起重复爬取
const inflight = new Map<string, Promise<ActorRecord>>();

async function ensureOne(name: string, proxyUrl?: string) {
  return;
}

export const actorRouter = t.router({
  get: t.procedure
    .input((input: unknown) => input as { name: string })
    .query(({ input }) => getActor(input.name) || null),

  list: t.procedure.query(() => listActors()),

  ensure: t.procedure
    .input((input: unknown) => input as { name: string; proxyUrl?: string })
    .mutation(({ input }) => ensureOne(input.name, input.proxyUrl)),

  // 批量补全：限制并发为 2，避免对 JavDB 压力过大
  ensureBatch: t.procedure
    .input(
      (input: unknown) =>
        input as { names: string[]; proxyUrl?: string; force?: boolean },
    )
    .mutation(async ({ input }) => {
      const queue = [...new Set(input.names)].filter((n) => n && n.trim());
      const results: ActorRecord[] = [];
      const CONC = 2;
      let i = 0;
      async function worker() {
        while (i < queue.length) {
          const name = queue[i++];
          if (!input.force) {
            const exist = getActor(name);
            if (exist?.avatarBase64) {
              results.push(exist);
              continue;
            }
          }
          try {
            const r = await ensureOne(name, input.proxyUrl);
            results.push(r);
            await new Promise((r) => setTimeout(r, 600));
          } catch {}
        }
      }
      await Promise.all(Array.from({ length: CONC }, () => worker()));
      return { count: results.length, results };
    }),

  remove: t.procedure
    .input((input: unknown) => input as { name: string })
    .mutation(({ input }) => {
      removeActor(input.name);
      return { success: true };
    }),
});
