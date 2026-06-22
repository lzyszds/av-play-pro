import React, { useCallback, useEffect, useState } from "react";
import { PageLoader } from "../components/PageLoader";
import { trpc } from "../lib/trpc";
import { Rss, Plus, Trash2, RefreshCw, ExternalLink } from "lucide-react";

interface Props {
  videoPath: string;
  onAddSystemLog: (text: string, level: "INFO" | "WARNING" | "SUCCESS" | "ERROR") => void;
}

interface RssFeed {
  id: string;
  name: string;
  url: string;
  lastFetched?: string;
  itemCount?: number;
  sourceType?: "xml" | "html" | "blocked" | "unknown";
}

interface RssItem {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  description: string;
  coverUrl?: string;
  feedId: string;
  feedName: string;
}

const RSS_FEEDS_KEY = "av-play-pro:rss-feeds";

function loadFeeds(): RssFeed[] {
  try {
    const raw = localStorage.getItem(RSS_FEEDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFeeds(feeds: RssFeed[]): void {
  try {
    localStorage.setItem(RSS_FEEDS_KEY, JSON.stringify(feeds));
  } catch {}
}

function makeItemId(feedId: string, link: string): string {
  let hash = 0;
  for (let i = 0; i < link.length; i += 1) {
    hash = (hash * 31 + link.charCodeAt(i)) | 0;
  }
  return `${feedId}-${Math.abs(hash).toString(36)}`;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

const PRESET_FEEDS: RssFeed[] = [
  { id: "preset-sukebei-all", name: "Sukebei 全部", url: "https://sukebei.nyaa.si/?page=rss" },
  { id: "preset-sukebei-fc2", name: "Sukebei FC2", url: "https://sukebei.nyaa.si/?page=rss&q=fc2" },
  { id: "preset-sukebei-uncensored", name: "Sukebei 无码", url: "https://sukebei.nyaa.si/?page=rss&q=uncensored" },
  { id: "preset-nyaa-all", name: "Nyaa 全部", url: "https://nyaa.si/?page=rss" },
];

export function RssPage({ onAddSystemLog }: Props) {
  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [items, setItems] = useState<RssItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [newFeedUrl, setNewFeedUrl] = useState("");
  const [newFeedName, setNewFeedName] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    setFeeds(loadFeeds());
    setLoading(false);
  }, []);

  const fetchFeed = useCallback(async (feed: RssFeed) => {
    setFetching(true);
    try {
      const res = await trpc.rss.fetch.query({ url: feed.url });
      const newItems: RssItem[] = res.items.map((item) => ({
        id: makeItemId(feed.id, item.link),
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        description: stripHtml(item.description).slice(0, 220),
        coverUrl: item.coverUrl,
        feedId: feed.id,
        feedName: feed.name,
      }));

      setItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        return [...newItems.filter((i) => !existingIds.has(i.id)), ...prev].slice(0, 500);
      });

      setFeeds((prev) => {
        const updated = prev.map((f) =>
          f.id === feed.id
            ? {
                ...f,
                lastFetched: new Date().toISOString(),
                itemCount: newItems.length,
                sourceType: res.sourceType,
              }
            : f,
        );
        saveFeeds(updated);
        return updated;
      });

      if (res.error) {
        onAddSystemLog(`RSS 抓取异常: ${feed.name} - ${res.error}`, "WARNING");
      } else {
        const typeLabel = res.sourceType === "html" ? "网页列表" : "RSS/XML";
        onAddSystemLog(`RSS 抓取完成: ${feed.name} (${newItems.length} 条, ${typeLabel})`, "SUCCESS");
      }
    } catch (err: any) {
      onAddSystemLog(`RSS 抓取失败: ${feed.name} - ${err?.message || "未知错误"}`, "ERROR");
    } finally {
      setFetching(false);
    }
  }, [onAddSystemLog]);

  const addFeed = () => {
    const name = newFeedName.trim();
    const url = newFeedUrl.trim();
    if (!url || !name) return;

    const feed: RssFeed = { id: `feed-${Date.now()}`, name, url };
    const updated = [...feeds, feed];
    setFeeds(updated);
    saveFeeds(updated);
    setNewFeedUrl("");
    setNewFeedName("");
    setShowAdd(false);
    onAddSystemLog(`RSS 源已添加: ${feed.name}`, "SUCCESS");
  };

  const removeFeed = (id: string) => {
    const updated = feeds.filter((f) => f.id !== id);
    setFeeds(updated);
    saveFeeds(updated);
    setItems((prev) => prev.filter((i) => i.feedId !== id));
  };

  const fetchAll = async () => {
    for (const feed of feeds) {
      await fetchFeed(feed);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#f8fafc] dark:bg-slate-950 select-none">
      <PageLoader active={loading} label="加载 RSS" />
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <Rss className="w-5 h-5 text-orange-500" />
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">订阅 / RSS 抓取</h2>
          <span className="text-[10px] text-slate-400">{feeds.length} 源 · {items.length} 条目</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchAll}
            disabled={fetching || feeds.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-orange-500 text-white text-[11px] font-bold hover:bg-orange-600 transition disabled:opacity-40 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${fetching ? "animate-spin" : ""}`} />
            {fetching ? "抓取中..." : "全部抓取"}
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-[11px] font-bold hover:border-orange-300 transition cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            添加源
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="源名称"
              value={newFeedName}
              onChange={(e) => setNewFeedName(e.target.value)}
              className="w-36 h-7 px-2.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:border-orange-400"
            />
            <input
              type="text"
              placeholder="RSS/XML URL，可带关键词，例如 https://sukebei.nyaa.si/?page=rss&q=fc2"
              value={newFeedUrl}
              onChange={(e) => setNewFeedUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addFeed()}
              className="flex-1 h-7 px-2.5 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:border-orange-400"
            />
            <button
              type="button"
              onClick={addFeed}
              className="h-7 px-4 rounded-md bg-orange-500 text-white text-[11px] font-bold hover:bg-orange-600 transition cursor-pointer"
            >
              添加
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[9px] text-slate-400">预设源:</span>
            {PRESET_FEEDS.map((pf) => (
              <button
                key={pf.id}
                type="button"
                onClick={() => {
                  setNewFeedName(pf.name);
                  setNewFeedUrl(pf.url);
                }}
                className="text-[9px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition cursor-pointer"
              >
                {pf.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-64 border-r border-slate-200 dark:border-slate-800 overflow-y-auto p-2 space-y-1">
          {feeds.map((f) => (
            <div key={f.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 group">
              <div className="min-w-0">
                <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 block truncate">{f.name}</span>
                <span className="text-[9px] text-slate-400">
                  {f.itemCount != null ? `${f.itemCount} 条` : "未抓取"}
                  {f.sourceType ? ` · ${f.sourceType === "html" ? "网页" : f.sourceType.toUpperCase()}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <button type="button" onClick={() => fetchFeed(f)} className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-orange-500 cursor-pointer" title="抓取">
                  <RefreshCw className="w-3 h-3" />
                </button>
                <button type="button" onClick={() => removeFeed(f.id)} className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-rose-500 cursor-pointer" title="删除">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
          {feeds.length === 0 && <div className="text-center py-8 text-slate-300 text-[10px]">暂无 RSS 源，点击上方添加</div>}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {items.map((item) => (
            <div key={item.id} className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3 hover:shadow-sm transition">
              <div className="flex items-start gap-3">
                {item.coverUrl && (
                  <img
                    src={item.coverUrl}
                    alt=""
                    className="w-24 aspect-video object-cover rounded bg-slate-100 dark:bg-slate-800 shrink-0"
                    loading="lazy"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-relaxed">{item.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400">{item.feedName}</span>
                    {item.pubDate && <span className="text-[9px] text-slate-400">{item.pubDate}</span>}
                  </div>
                  {item.description && <p className="text-[10px] text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">{item.description}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => window.open(item.link, "_blank")}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition cursor-pointer shrink-0"
                  title="打开链接"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-300 gap-3">
              <Rss className="w-12 h-12 opacity-20" />
              <p className="text-xs">添加并抓取 RSS/XML 源后，条目将显示在此处</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
