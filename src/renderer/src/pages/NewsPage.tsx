import React, { useCallback, useEffect, useState } from "react";
import { ExternalLink, Newspaper, RefreshCw, ServerCrash, Tag } from "lucide-react";
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

export function NewsPage({ endpoint, apiKey, onAddSystemLog }: { endpoint?: string; apiKey?: string; onAddSystemLog: (text: string, level: "INFO" | "WARNING" | "SUCCESS" | "ERROR") => void }) {
  const [items, setItems] = useState<NewsItem[]>([]);
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
  const formatDate = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "最近更新";

  return <div className="relative h-full overflow-y-auto bg-slate-50 dark:bg-slate-950">
    <PageLoader active={loading} label="加载影视资讯" />
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-6 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
      <div className="flex items-center gap-3"><div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2"><Newspaper className="h-5 w-5 text-amber-500" /></div><div><h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">影视资讯台</h2><p className="mt-0.5 text-[10px] text-slate-400">云端聚合 · {items.length} 条最新动态</p></div></div>
      <button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:border-amber-300 hover:text-amber-600 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />刷新</button>
    </div>
    {!loading && error && <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center"><ServerCrash className="h-9 w-9 text-amber-500" /><div className="text-sm font-bold text-slate-700 dark:text-slate-200">资讯服务尚未连接</div><p className="max-w-md text-xs leading-6 text-slate-500">{error}。部署 cloud/news-service 后，在设置 → 网络与插件中填写 Worker 地址和只读密钥。</p></div>}
    {!loading && !error && items.length === 0 && <div className="mx-auto flex max-w-xl flex-col items-center gap-3 px-6 py-24 text-center"><Newspaper className="h-10 w-10 text-amber-500" /><div className="text-sm font-bold text-slate-700 dark:text-slate-200">暂时没有可显示的资讯</div><p className="text-xs leading-6 text-slate-500">云端新闻源正在抓取，或尚未添加来源。点击右上角刷新，稍后会自动显示最新内容。</p></div>}
    {!loading && !error && items.length > 0 && <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <article key={item.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      {item.image_url && <img src={item.image_url} alt="" className="h-40 w-full bg-slate-100 object-cover dark:bg-slate-800" loading="lazy" />}
      <div className="space-y-3 p-4"><div className="flex items-center justify-between gap-2 text-[10px]"><span className="rounded bg-amber-500/10 px-2 py-1 font-bold text-amber-600 dark:text-amber-400">{item.source_name}</span><span className="text-slate-400">{formatDate(item.published_at || item.fetched_at)}</span></div><h3 className="line-clamp-2 text-sm font-bold leading-6 text-slate-800 dark:text-slate-100">{item.title}</h3>{item.summary && <p className="line-clamp-3 text-xs leading-5 text-slate-500">{item.summary}</p>}<div className="flex items-center justify-between gap-2">{item.code ? <span className="font-mono text-[10px] text-violet-600 dark:text-violet-300">{item.code}</span> : <span /> }<button type="button" onClick={() => window.open(item.canonical_url, "_blank")} className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 hover:text-amber-500"><ExternalLink className="h-3.5 w-3.5" />原文</button></div>{item.keywords?.length > 0 && <div className="flex flex-wrap gap-1 border-t border-slate-100 pt-2 dark:border-slate-800"><Tag className="mt-0.5 h-3 w-3 text-slate-400" />{item.keywords.slice(0, 4).map((keyword) => <span key={keyword} className="text-[10px] text-slate-400">#{keyword}</span>)}</div>}</div>
    </article>)}</div>}
  </div>;
}
