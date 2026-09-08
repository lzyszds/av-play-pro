import React, { useCallback, useEffect, useState } from "react";
import { ExternalLink, Library, Newspaper, RefreshCw, ServerCrash, Tag, Timeline, X } from "lucide-react";
import { PageLoader } from "../components/PageLoader";
import { trpc } from "../lib/trpc";

type NewsItem = {
  id: string;
  title: string;
  summary: string;
  image_url: string;
  canonical_url: string;
  published_at: string | null;
  fetched_at: string;
  source_name: string;
  code: string;
  keywords: string[];
};

type LibraryMatch = {
  id: string;
  actors: string[];
  total: number;
  videos: Array<{ id: string; name: string; title: string; code: string; actors: string[] }>;
};

export function NewsPage({ endpoint, apiKey, videoPath, onAddSystemLog }: { endpoint?: string; apiKey?: string; videoPath: string; onAddSystemLog: (text: string, level: "INFO" | "WARNING" | "SUCCESS" | "ERROR") => void }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [matches, setMatches] = useState<Record<string, LibraryMatch>>({});
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  const [timelineActor, setTimelineActor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true); else setLoading(true);
    try {
      const result = await trpc.news.list.query({ endpoint: endpoint || "", apiKey, limit: 48 }) as { items: NewsItem[]; error: string | null };
      if (result.error) { setError(result.error); setItems([]); if (manual) onAddSystemLog(`资讯更新失败：${result.error}`, "WARNING"); return; }
      setItems(result.items); setError(null);
      if (manual) onAddSystemLog(`资讯已更新：${result.items.length} 条`, "SUCCESS");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message); if (manual) onAddSystemLog(`资讯更新失败：${message}`, "ERROR");
    } finally { setLoading(false); setRefreshing(false); }
  }, [apiKey, endpoint, onAddSystemLog]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!videoPath || items.length === 0) { setMatches({}); return; }
    let cancelled = false;
    void trpc.library.newsMatches.query({ rootPath: videoPath, items: items.map(({ id, title, summary, code }) => ({ id, title, summary, code })) })
      .then((rows: LibraryMatch[]) => {
        if (!cancelled) setMatches(Object.fromEntries(rows.map((row) => [row.id, row])));
      })
      .catch(() => { if (!cancelled) setMatches({}); });
    return () => { cancelled = true; };
  }, [items, videoPath]);
  const formatDate = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "最近更新";
  const timeline = timelineActor ? items.filter((item) => `${item.title} ${item.summary}`.normalize("NFKC").toLocaleLowerCase().includes(timelineActor.normalize("NFKC").toLocaleLowerCase())) : [];

  return <div className="relative h-full overflow-y-auto bg-slate-50 dark:bg-slate-950">
    <PageLoader active={loading} label="加载影视资讯" />
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-6 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
      <div className="flex items-center gap-3"><div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2"><Newspaper className="h-5 w-5 text-amber-500" /></div><div><h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">影视资讯台</h2><p className="mt-0.5 text-[10px] text-slate-400">云端聚合 · {items.length} 条最新动态</p></div></div>
      <button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:border-amber-300 hover:text-amber-600 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />刷新</button>
    </div>
    {!loading && error && <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center"><ServerCrash className="h-9 w-9 text-amber-500" /><div className="text-sm font-bold text-slate-700 dark:text-slate-200">资讯服务尚未连接</div><p className="max-w-md text-xs leading-6 text-slate-500">{error}。部署 cloud/news-service 后，在设置 → 网络与插件中填写 Worker 地址和只读密钥。</p></div>}
    {!loading && !error && items.length === 0 && <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-6 py-24 text-center"><Newspaper className="h-10 w-10 text-amber-500" /><div className="text-sm font-bold text-slate-700 dark:text-slate-200">暂时没有可显示的资讯</div><p className="text-xs leading-6 text-slate-500">云端新闻源正在抓取，或尚未添加来源。点击右上角刷新，稍后会自动显示最新内容。</p></div>}
    {!loading && !error && items.length > 0 && <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => { const match = matches[item.id]; return <article key={item.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      {item.image_url && <img src={item.image_url} alt="" className="h-40 w-full bg-slate-100 object-cover dark:bg-slate-800" loading="lazy" />}
      <div className="space-y-3 p-4"><div className="flex items-center justify-between gap-2 text-[10px]"><span className="rounded bg-amber-500/10 px-2 py-1 font-bold text-amber-600 dark:text-amber-400">{item.source_name}</span><span className="text-slate-400">{formatDate(item.published_at || item.fetched_at)}</span></div><h3 className="line-clamp-2 text-sm font-bold leading-6 text-slate-800 dark:text-slate-100">{item.title}</h3>{item.summary && <p className="line-clamp-3 text-xs leading-5 text-slate-500">{item.summary}</p>}<div className="flex items-center justify-between gap-2">{item.code ? <span className="font-mono text-[10px] text-violet-600 dark:text-violet-300">{item.code}</span> : <span /> }<button type="button" onClick={() => window.open(item.canonical_url, "_blank")} className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 hover:text-amber-500"><ExternalLink className="h-3.5 w-3.5" />原文</button></div>{match?.total ? <div className="space-y-2 border-t border-emerald-100 pt-2 dark:border-emerald-950"><button type="button" onClick={() => setExpandedMatch(expandedMatch === item.id ? null : item.id)} className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 hover:text-emerald-500"><Library className="h-3.5 w-3.5" />片库命中 {match.total} 部</button>{expandedMatch === item.id && <div className="rounded-lg bg-emerald-50/70 p-2 text-[11px] text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">{match.videos.map((video) => <div key={video.id} className="truncate py-0.5">{video.code ? `${video.code} · ` : ""}{video.title}</div>)}</div>}<div className="flex flex-wrap gap-1">{match.actors.map((actor) => <button key={actor} type="button" onClick={() => setTimelineActor(actor)} className="inline-flex items-center gap-1 rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 hover:bg-violet-500/20 dark:text-violet-300"><Timeline className="h-3 w-3" />{actor} 履历</button>)}</div></div> : null}{item.keywords?.length > 0 && <div className="flex flex-wrap gap-1 border-t border-slate-100 pt-2 dark:border-slate-800"><Tag className="mt-0.5 h-3 w-3 text-slate-400" />{item.keywords.slice(0, 4).map((keyword) => <span key={keyword} className="text-[10px] text-slate-400">#{keyword}</span>)}</div>}</div>
    </article>; })}</div>}
    {timelineActor && <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30" onMouseDown={() => setTimelineActor(null)}><aside className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-2xl dark:bg-slate-900" onMouseDown={(event) => event.stopPropagation()}><div className="mb-5 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-widest text-violet-500">公开资讯履历</p><h3 className="mt-1 text-lg font-bold text-slate-800 dark:text-slate-100">{timelineActor}</h3></div><button type="button" onClick={() => setTimelineActor(null)} className="rounded-md p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button></div><div className="space-y-4 border-l border-violet-200 pl-4 dark:border-violet-900">{timeline.map((item) => <div key={item.id} className="relative"><span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-violet-500" /><p className="text-[10px] text-slate-400">{formatDate(item.published_at || item.fetched_at)} · {item.source_name}</p><button type="button" onClick={() => window.open(item.canonical_url, "_blank")} className="mt-1 text-left text-sm font-bold leading-5 text-slate-700 hover:text-amber-600 dark:text-slate-200">{item.title}</button></div>)}{timeline.length === 0 && <p className="text-xs text-slate-500">目前资讯源中还没有这位女优的公开动态。</p>}</div></aside></div>}
  </div>;
}
