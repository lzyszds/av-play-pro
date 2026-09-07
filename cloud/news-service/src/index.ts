export interface Env {
  DB: D1Database;
  ADMIN_TOKEN: string;
  CLIENT_TOKEN?: string;
  CORS_ORIGIN?: string;
}

type Source = { id: string; name: string; url: string; type: "rss" | "html"; enabled: number; refresh_minutes: number; last_fetched_at: string | null };
type Draft = { title: string; url: string; summary: string; imageUrl: string; publishedAt: string | null };

// 用户明确要求保留可恢复的项目内默认密钥；Cloudflare Secret 存在时优先使用它。
const DEFAULT_ADMIN_TOKEN = "a395878870";
const DEFAULT_CLIENT_TOKEN = "Aa395878870";

const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), {
  ...init,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers || {}) },
});
const now = () => new Date().toISOString();
const clean = (value = "") => value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const decode = (value = "") => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").trim();
const tag = (block: string, name: string) => decode(block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "");
const attr = (block: string, name: string, attribute: string) => block.match(new RegExp(`<${name}[^>]*${attribute}=["']([^"']+)["'][^>]*>`, "i"))?.[1] || "";

function canonicalUrl(value: string): string {
  try { const url = new URL(value); url.hash = ""; for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|fbclid$)/i.test(key)) url.searchParams.delete(key); return url.toString(); } catch { return value.trim(); }
}
function extractCode(value: string): string { return value.match(/\b([A-Z]{2,10}[-_ ]?\d{2,7})\b/i)?.[1]?.replace(/[ _]/g, "-").toUpperCase() || ""; }
function unique(values: string[]): string[] { return [...new Set(values.map(clean).filter((value) => value.length > 1))].slice(0, 12); }
async function hash(value: string): Promise<string> { const bytes = new TextEncoder().encode(value); const digest = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

function parseRss(text: string): Draft[] {
  const blocks = text.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return blocks.map((block) => {
    const title = clean(tag(block, "title"));
    const rawLink = tag(block, "link") || attr(block, "link", "href") || tag(block, "guid");
    const summary = clean(tag(block, "description") || tag(block, "summary") || tag(block, "content")).slice(0, 700);
    const imageUrl = attr(block, "media:thumbnail", "url") || attr(block, "media:content", "url") || attr(block, "enclosure", "url");
    const date = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated");
    return { title, url: canonicalUrl(rawLink), summary, imageUrl, publishedAt: Number.isNaN(Date.parse(date)) ? null : new Date(date).toISOString() };
  }).filter((item) => item.title && item.url);
}

function parseHtml(text: string, baseUrl: string): Draft[] {
  const blocks = text.match(/<article\b[\s\S]*?<\/article>/gi) || [];
  return blocks.slice(0, 60).map((block) => {
    const href = block.match(/<a[^>]+href=["']([^"']+)["']/i)?.[1] || "";
    const title = clean(block.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] || block.match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || "");
    const summary = clean(block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "").slice(0, 700);
    const imageUrl = block.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i)?.[1] || "";
    try { return { title, url: canonicalUrl(new URL(href, baseUrl).toString()), summary, imageUrl: imageUrl ? new URL(imageUrl, baseUrl).toString() : "", publishedAt: null }; } catch { return { title: "", url: "", summary: "", imageUrl: "", publishedAt: null }; }
  }).filter((item) => item.title && item.url);
}

function isAdmin(request: Request, env: Env): boolean { return request.headers.get("x-news-admin-key") === (env.ADMIN_TOKEN || DEFAULT_ADMIN_TOKEN); }
function isClient(request: Request, env: Env): boolean { return request.headers.get("x-news-key") === (env.CLIENT_TOKEN || DEFAULT_CLIENT_TOKEN); }
function cors(request: Request, env: Env): HeadersInit { const origin = request.headers.get("origin") || ""; const allowed = env.CORS_ORIGIN || ""; return allowed && origin === allowed ? { "access-control-allow-origin": origin, "vary": "origin" } : {}; }

async function refreshSource(source: Source, env: Env): Promise<{ added: number; error?: string }> {
  try {
    const response = await fetch(source.url, { headers: { "user-agent": "AVPlayPro News Aggregator/1.0", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9,*/*;q=0.5" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const drafts = /<(rss|feed)\b|<\?xml/i.test(text) ? parseRss(text) : parseHtml(text, source.url);
    let added = 0;
    for (const draft of drafts) {
      const canonical = canonicalUrl(draft.url);
      const contentHash = await hash(`${draft.title}|${draft.summary}|${draft.publishedAt || ""}`);
      const id = await hash(canonical);
      const code = extractCode(`${draft.title} ${draft.summary}`);
      const keywords = unique((draft.title.match(/[\p{L}\p{N}]{2,}/gu) || []).slice(0, 16));
      const result = await env.DB.prepare(`INSERT INTO articles (id, source_id, canonical_url, title, summary, image_url, published_at, fetched_at, code, actors_json, keywords_json, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?) ON CONFLICT(canonical_url) DO UPDATE SET title=excluded.title, summary=excluded.summary, image_url=excluded.image_url, published_at=COALESCE(excluded.published_at, articles.published_at), fetched_at=excluded.fetched_at, content_hash=excluded.content_hash`)
        .bind(id, source.id, canonical, draft.title, draft.summary, draft.imageUrl, draft.publishedAt, now(), code, JSON.stringify(keywords), contentHash).run();
      if ((result.meta.changes || 0) > 0) added++;
    }
    await env.DB.prepare("UPDATE sources SET last_fetched_at=?, last_error=NULL, updated_at=? WHERE id=?").bind(now(), now(), source.id).run();
    return { added };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE sources SET last_error=?, updated_at=? WHERE id=?").bind(message.slice(0, 500), now(), source.id).run();
    return { added: 0, error: message };
  }
}
async function refreshDue(env: Env): Promise<unknown[]> { const { results = [] } = await env.DB.prepare("SELECT * FROM sources WHERE enabled=1").all<Source>(); return Promise.all(results.filter((source) => !source.last_fetched_at || Date.now() - Date.parse(source.last_fetched_at) >= source.refresh_minutes * 60_000).map(async (source) => ({ source: source.name, ...(await refreshSource(source, env)) }))); }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = cors(request, env);
    if (request.method === "OPTIONS") return new Response(null, { headers: { ...headers, "access-control-allow-headers": "content-type,x-news-key,x-news-admin-key", "access-control-allow-methods": "GET,POST,PUT,OPTIONS" } });
    if (url.pathname === "/health") return json({ ok: true, service: "avplay-news", time: now() }, { headers });
    if (url.pathname === "/api/news" && request.method === "GET") {
      if (!isClient(request, env)) return json({ error: "unauthorized" }, { status: 401, headers });
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 30), 1), 100);
      const cursor = url.searchParams.get("cursor") || "9999-12-31T23:59:59.999Z";
      const source = url.searchParams.get("source") || "";
      const query = source ? "SELECT a.*, s.name AS source_name FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.fetched_at < ? AND a.source_id=? ORDER BY COALESCE(a.published_at,a.fetched_at) DESC LIMIT ?" : "SELECT a.*, s.name AS source_name FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.fetched_at < ? ORDER BY COALESCE(a.published_at,a.fetched_at) DESC LIMIT ?";
      const statement = source ? env.DB.prepare(query).bind(cursor, source, limit + 1) : env.DB.prepare(query).bind(cursor, limit + 1);
      const { results = [] } = await statement.all<Record<string, unknown>>();
      const page = results.slice(0, limit);
      return json({ items: page.map((item) => ({ ...item, actors: JSON.parse(String(item.actors_json || "[]")), keywords: JSON.parse(String(item.keywords_json || "[]")) })), nextCursor: results.length > limit ? String(page.at(-1)?.fetched_at || "") : null }, { headers });
    }
    if (url.pathname === "/api/admin/sources" && request.method === "GET") { if (!isAdmin(request, env)) return json({ error: "unauthorized" }, { status: 401, headers }); const rows = await env.DB.prepare("SELECT * FROM sources ORDER BY name").all(); return json(rows, { headers }); }
    if (url.pathname === "/api/admin/sources" && request.method === "PUT") {
      if (!isAdmin(request, env)) return json({ error: "unauthorized" }, { status: 401, headers });
      const source = await request.json<Partial<Source>>();
      if (!source.name?.trim() || !source.url?.trim()) return json({ error: "name and url are required" }, { status: 400, headers });
      const id = source.id || crypto.randomUUID(); const type = source.type === "html" ? "html" : "rss";
      await env.DB.prepare("INSERT INTO sources (id,name,url,type,enabled,refresh_minutes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,type=excluded.type,enabled=excluded.enabled,refresh_minutes=excluded.refresh_minutes,updated_at=excluded.updated_at").bind(id, source.name.trim(), source.url.trim(), type, source.enabled === 0 ? 0 : 1, Math.max(15, Number(source.refresh_minutes || 120)), now(), now()).run();
      return json({ id }, { headers });
    }
    if (url.pathname === "/api/admin/refresh" && request.method === "POST") { if (!isAdmin(request, env)) return json({ error: "unauthorized" }, { status: 401, headers }); return json({ results: await refreshDue(env) }, { headers }); }
    return json({ error: "not found" }, { status: 404, headers });
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) { ctx.waitUntil(refreshDue(env)); },
};
