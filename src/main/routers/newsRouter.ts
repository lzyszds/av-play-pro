import { net } from "electron";
import { t } from "../trpc";

function endpoint(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) return "";
  return /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
}

export const newsRouter = t.router({
  list: t.procedure
    .input((input: unknown) => input as { endpoint: string; apiKey?: string; cursor?: string; source?: string; limit?: number })
    .query(async ({ input }) => {
      const base = endpoint(input.endpoint || "");
      if (!base) return { items: [], nextCursor: null, error: "请先在设置中填写资讯服务地址" };
      const params = new URLSearchParams({ limit: String(Math.min(Math.max(input.limit || 30, 1), 100)) });
      if (input.cursor) params.set("cursor", input.cursor);
      if (input.source) params.set("source", input.source);
      try {
        const response = await net.fetch(`${base}/api/news?${params}`, {
          headers: { "X-News-Key": input.apiKey?.trim() || "", "User-Agent": "AVPlayPro-Electron" },
          signal: AbortSignal.timeout(15_000),
        });
        const payload = await response.json() as { items?: unknown[]; nextCursor?: string | null; error?: string };
        if (!response.ok) return { items: [], nextCursor: null, error: payload.error || `服务返回 HTTP ${response.status}` };
        return { items: payload.items || [], nextCursor: payload.nextCursor || null, error: null };
      } catch (error) {
        return { items: [], nextCursor: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  health: t.procedure
    .input((input: unknown) => input as { endpoint: string })
    .query(async ({ input }) => {
      const base = endpoint(input.endpoint || "");
      if (!base) return { ok: false, error: "未配置服务地址" };
      try {
        const response = await net.fetch(`${base}/health`, { signal: AbortSignal.timeout(8_000) });
        return { ok: response.ok, error: response.ok ? null : `HTTP ${response.status}` };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),
});
