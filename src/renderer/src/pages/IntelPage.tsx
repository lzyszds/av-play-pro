import React, { useEffect, useMemo, useState } from "react";
import { trpc } from "../lib/trpc";
import { PageLoader } from "../components/PageLoader";
import {
  Newspaper,
  Search,
  Star,
  Users,
  Building2,
  Tag,
  Film,
  Calendar,
  Clock,
  ExternalLink,
  ChevronDown,
} from "lucide-react";

interface Props {
  videoPath: string;
  onAddSystemLog: (text: string, level: "INFO" | "WARNING" | "SUCCESS" | "ERROR") => void;
}

interface VideoMeta {
  id: string;
  name: string;
  code?: string;
  title?: string;
  actors?: string[];
  releaseDate?: string;
  duration?: string;
  studio?: string;
  label?: string;
  studioSeries?: string;
  director?: string;
  genres?: string[];
  rating?: number;
  plot?: string;
  sourceSite?: string;
  size?: string;
  resolution?: string;
  coverUrl?: string;
}

interface ActorInfo {
  name: string;
  count: number;
  totalWatchSec: number;
  videos: string[];
  studios: string[];
  genres: string[];
}

interface StudioInfo {
  name: string;
  count: number;
  actors: string[];
  series: string[];
}

export function IntelPage({ videoPath, onAddSystemLog }: Props) {
  const [videos, setVideos] = useState<VideoMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVideo, setSelectedVideo] = useState<VideoMeta | null>(null);
  const [tab, setTab] = useState<"videos" | "actors" | "studios">("videos");
  const [expandedVideo, setExpandedVideo] = useState<string | null>(null);

  useEffect(() => {
    if (!videoPath) return;
    setLoading(true);
    (async () => {
      try {
        const raw: any[] = await trpc.videos.list.query({ path: videoPath });
        setVideos(raw);
        onAddSystemLog(`情报加载完成：${raw.length} 部影片`, "SUCCESS");
      } catch (err: any) {
        onAddSystemLog(`情报加载失败: ${err?.message}`, "ERROR");
      } finally {
        setLoading(false);
      }
    })();
  }, [videoPath]);

  const filteredVideos = useMemo(() => {
    if (!searchQuery.trim()) return videos;
    const q = searchQuery.toLowerCase();
    return videos.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.title?.toLowerCase().includes(q) ||
        v.code?.toLowerCase().includes(q) ||
        v.actors?.some((a) => a.toLowerCase().includes(q)) ||
        v.studio?.toLowerCase().includes(q),
    );
  }, [videos, searchQuery]);

  const actorStats = useMemo(() => {
    const map = new Map<string, ActorInfo>();
    for (const v of videos) {
      if (!v.actors) continue;
      for (const a of v.actors) {
        const info = map.get(a) || {
          name: a,
          count: 0,
          totalWatchSec: 0,
          videos: [] as string[],
          studios: [] as string[],
          genres: [] as string[],
        };
        info.count++;
        info.videos.push(v.name);
        if (v.studio && !info.studios.includes(v.studio)) info.studios.push(v.studio);
        if (v.genres) {
          for (const g of v.genres) {
            if (!info.genres.includes(g)) info.genres.push(g);
          }
        }
        map.set(a, info);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [videos]);

  const studioStats = useMemo(() => {
    const map = new Map<string, StudioInfo>();
    for (const v of videos) {
      if (!v.studio) continue;
      const info = map.get(v.studio) || {
        name: v.studio,
        count: 0,
        actors: [] as string[],
        series: [] as string[],
      };
      info.count++;
      if (v.actors) {
        for (const a of v.actors) {
          if (!info.actors.includes(a)) info.actors.push(a);
        }
      }
      if (v.studioSeries && !info.series.includes(v.studioSeries)) {
        info.series.push(v.studioSeries);
      }
      map.set(v.studio, info);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [videos]);

  const totalSize = useMemo(() => {
    let bytes = 0;
    for (const v of videos) {
      if (v.size) {
        const match = v.size.match(/([\d.]+)\s*(GB|MB|TB)/i);
        if (match) {
          const num = parseFloat(match[1]);
          const unit = match[2].toUpperCase();
          if (unit === "TB") bytes += num * 1024 * 1024 * 1024 * 1024;
          else if (unit === "GB") bytes += num * 1024 * 1024 * 1024;
          else if (unit === "MB") bytes += num * 1024 * 1024;
        }
      }
    }
    if (bytes >= 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }, [videos]);

  const allGenres = useMemo(() => {
    const set = new Set<string>();
    for (const v of videos) {
      if (v.genres) for (const g of v.genres) set.add(g);
    }
    return [...set].sort();
  }, [videos]);

  return (
    <div className="h-full flex flex-col bg-[#f8fafc] dark:bg-slate-950 select-none">
      <PageLoader active={loading} label="加载情报" />

      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <Newspaper className="w-5 h-5 text-amber-500" />
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">资源情报</h2>
          <span className="text-[10px] text-slate-400">
            {videos.length} 部 · {actorStats.length} 演员 · {studioStats.length} 厂商 · {totalSize}
          </span>
        </div>
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="搜索影片/演员/厂商..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 w-56 pl-8 pr-3 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:border-amber-400"
          />
        </div>
      </div>

      <div className="flex items-center gap-1 px-6 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
        {(["videos", "actors", "studios"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-[11px] font-semibold transition cursor-pointer ${
              tab === t
                ? "bg-amber-500 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            {t === "videos" ? "影片" : t === "actors" ? "演员" : "厂商"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "videos" && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredVideos.map((v) => (
              <div
                key={v.id}
                className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">
                        {v.title || v.name}
                      </h3>
                      {v.code && (
                        <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400">
                          {v.code}
                        </span>
                      )}
                    </div>
                    {v.rating && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-amber-500 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-full shrink-0">
                        <Star className="w-2.5 h-2.5 fill-current" />
                        {v.rating.toFixed(1)}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {v.actors?.slice(0, 4).map((a) => (
                      <span
                        key={a}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400"
                      >
                        {a}
                      </span>
                    ))}
                    {v.actors && v.actors.length > 4 && (
                      <span className="text-[9px] text-slate-400">+{v.actors.length - 4}</span>
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500">
                    {v.studio && (
                      <span className="flex items-center gap-1">
                        <Building2 className="w-2.5 h-2.5" />
                        {v.studio}
                      </span>
                    )}
                    {v.duration && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {v.duration}
                      </span>
                    )}
                    {v.releaseDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-2.5 h-2.5" />
                        {v.releaseDate}
                      </span>
                    )}
                  </div>

                  {v.genres && v.genres.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {v.genres.slice(0, 5).map((g) => (
                        <span
                          key={g}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => setExpandedVideo(expandedVideo === v.id ? null : v.id)}
                    className="mt-2 flex items-center gap-1 text-[10px] text-slate-400 hover:text-amber-500 transition cursor-pointer"
                  >
                    <ChevronDown
                      className={`w-3 h-3 transition-transform ${expandedVideo === v.id ? "rotate-180" : ""}`}
                    />
                    {expandedVideo === v.id ? "收起" : "详情"}
                  </button>

                  {expandedVideo === v.id && (
                    <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-[10px] text-slate-500">
                      {v.plot && <p className="leading-relaxed">{v.plot}</p>}
                      {v.director && <p>导演: {v.director}</p>}
                      {v.label && <p>厂牌: {v.label}</p>}
                      {v.studioSeries && <p>系列: {v.studioSeries}</p>}
                      {v.sourceSite && <p>来源: {v.sourceSite}</p>}
                      {v.size && <p>大小: {v.size}</p>}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {filteredVideos.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-16 text-slate-300 gap-3">
                <Film className="w-12 h-12 opacity-30" />
                <p className="text-xs">未找到匹配影片</p>
              </div>
            )}
          </div>
        )}

        {tab === "actors" && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {actorStats
              .filter((a) => !searchQuery || a.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((a) => (
                <div
                  key={a.name}
                  className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                      <Users className="w-5 h-5 text-rose-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">{a.name}</h3>
                      <span className="text-[10px] text-slate-500">{a.count} 部作品</span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {a.studios.slice(0, 3).map((s) => (
                      <span key={s} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
                        {s}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {a.genres.slice(0, 5).map((g) => (
                      <span key={g} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {tab === "studios" && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {studioStats
              .filter((s) => !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((s) => (
                <div
                  key={s.name}
                  className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">{s.name}</h3>
                      <span className="text-[10px] text-slate-500">{s.count} 部作品 · {s.actors.length} 演员</span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {s.actors.slice(0, 6).map((a) => (
                      <span key={a} className="text-[9px] px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400">
                        {a}
                      </span>
                    ))}
                    {s.actors.length > 6 && (
                      <span className="text-[9px] text-slate-400">+{s.actors.length - 6}</span>
                    )}
                  </div>
                  {s.series.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.series.map((se) => (
                        <span key={se} className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                          {se}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
