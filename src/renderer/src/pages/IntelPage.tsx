import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { trpc } from "../lib/trpc";
import { PageLoader } from "../components/PageLoader";
import { ActorAvatar } from "../components/player/ActorAvatar";
import { CoverImage } from "../components/CoverImage";
import {
  Newspaper, Search, Star, Users, Building2, Film, Calendar,
  Tag,
} from "lucide-react";

interface Props {
  videoPath: string;
  onAddSystemLog: (text: string, level: "INFO" | "WARNING" | "SUCCESS" | "ERROR") => void;
}
interface VideoMeta {
  id: string; name: string; code?: string; title?: string;
  actors?: string[]; releaseDate?: string; duration?: string;
  studio?: string; label?: string; studioSeries?: string;
  director?: string; genres?: string[]; rating?: number;
  plot?: string; sourceSite?: string; size?: string;
  resolution?: string; coverUrl?: string; url?: string;
}
interface ActorInfo {
  name: string; count: number; videos: string[];
  studios: string[]; genres: string[];
}
interface StudioInfo {
  name: string; count: number; actors: string[]; series: string[];
}

function encodeMediaUrl(filePath: string): string {
  if (!filePath || filePath.includes("://")) return filePath;
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const encoded = segments.map((s, i) =>
    i === 0 && /^[a-zA-Z]:$/.test(s) ? s : encodeURIComponent(s),
  );
  return `local-media:///${encoded.join("/")}`;
}
function convertVideos(raw: any[]): VideoMeta[] {
  return raw.map((v) => ({ ...v, coverUrl: v.coverUrl ? encodeMediaUrl(v.coverUrl) : undefined }));
}

// ---- 视频卡片（横向布局：小封面 + 完整信息）----
const VideoCard = React.memo<{
  video: VideoMeta;
}>(({ video: v }) => (
  <div className="group bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
    <div className="flex gap-3 p-3">
      {/* 小封面 */}
      <div className="w-28 h-[72px] rounded-lg overflow-hidden bg-slate-900 shrink-0 relative">
        {v.coverUrl ? (
          <CoverImage src={v.coverUrl} alt={v.name} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-5 h-5 text-slate-600" />
          </div>
        )}
        {v.rating && (
          <div className="absolute top-1 right-1 flex items-center gap-0.5 text-[8px] bg-black/70 text-amber-400 px-1.5 py-0.5 rounded font-bold">
            <Star className="w-2.5 h-2.5 fill-current" />{v.rating.toFixed(1)}
          </div>
        )}
        {v.duration && (
          <div className="absolute bottom-1 right-1 text-[7px] bg-black/70 text-white/80 px-1.5 py-0.5 rounded font-mono">
            {v.duration}
          </div>
        )}
      </div>

      {/* 信息区 */}
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* 标题 + 番号 */}
        <div>
          <h3 className="text-[11px] font-bold text-slate-800 dark:text-slate-200 leading-snug">
            {v.title || v.name}
          </h3>
          {v.code && (
            <span className="text-[9px] font-mono text-amber-600 dark:text-amber-400">{v.code}</span>
          )}
        </div>

        {/* 元信息行 */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-slate-500">
          {v.studio && (
            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
              <Building2 className="w-2.5 h-2.5" />{v.studio}
            </span>
          )}
          {v.releaseDate && (
            <span className="inline-flex items-center gap-0.5">
              <Calendar className="w-2.5 h-2.5" />{v.releaseDate}
            </span>
          )}
          {v.size && <span className="font-mono">{v.size}</span>}
          {v.director && <span>导演: {v.director}</span>}
          {v.label && <span>{v.label}</span>}
          {v.studioSeries && <span>系列: {v.studioSeries}</span>}
        </div>

        {/* 演员（全部） */}
        {v.actors && v.actors.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {v.actors.map((a) => (
              <span key={a} className="text-[8px] px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-900/20 text-rose-500">{a}</span>
            ))}
          </div>
        )}

        {/* 分类（全部） */}
        {v.genres && v.genres.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {v.genres.map((g) => (
              <span key={g} className="text-[7px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-400">{g}</span>
            ))}
          </div>
        )}

        {/* 剧情简介 */}
        {v.plot && (
          <p className="text-[9px] text-slate-400 leading-relaxed line-clamp-2">{v.plot}</p>
        )}

        {/* 来源 */}
        {v.sourceSite && (
          <span className="text-[8px] text-slate-400">来源: {v.sourceSite}</span>
        )}
      </div>
    </div>
  </div>
));
VideoCard.displayName = "VideoCard";

// ---- 演员卡片 ----
const ActorCard = React.memo<{
  actor: ActorInfo;
}>(({ actor: a }) => (
  <div className="group bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
    <div className="flex items-center gap-3">
      <ActorAvatar name={a.name} size={42} />
      <div className="min-w-0 flex-1">
        <h3 className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">{a.name}</h3>
        <span className="text-[9px] text-slate-400">{a.count} 部</span>
      </div>
    </div>
    <div className="flex flex-wrap gap-1 mt-2">
      {a.studios.slice(0, 4).map((s) => (
        <span key={s} className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500">
          {s}
        </span>
      ))}
      {a.studios.length > 4 && <span className="text-[8px] text-slate-400">+{a.studios.length - 4}</span>}
    </div>
    <div className="flex flex-wrap gap-1 mt-1">
      {a.genres.slice(0, 5).map((g) => (
        <span key={g} className="text-[7px] px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-400">{g}</span>
      ))}
    </div>
  </div>
));
ActorCard.displayName = "ActorCard";

// ---- 厂商卡片 ----
const StudioCard = React.memo<{
  studio: StudioInfo;
}>(({ studio: s }) => (
  <div className="group bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
        <Building2 className="w-5 h-5 text-emerald-500" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">{s.name}</h3>
        <span className="text-[9px] text-slate-400">{s.count} 部 · {s.actors.length} 演员</span>
      </div>
    </div>
    <div className="flex flex-wrap gap-1 mt-2">
      {s.actors.slice(0, 6).map((a) => (
        <span key={a} className="text-[8px] px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-900/20 text-rose-500">{a}</span>
      ))}
      {s.actors.length > 6 && <span className="text-[8px] text-slate-400">+{s.actors.length - 6}</span>}
    </div>
    {s.series.length > 0 && (
      <div className="flex flex-wrap gap-1 mt-1">
        {s.series.map((se) => (
          <span key={se} className="text-[8px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-400">{se}</span>
        ))}
      </div>
    )}
  </div>
));
StudioCard.displayName = "StudioCard";

// ==================== 主页面 ====================
const CD = 4; // 列数
const VIDEO_CD = 2; // 视频卡片列数（横向布局更宽）

export function IntelPage({ videoPath, onAddSystemLog }: Props) {
  const [videos, setVideos] = useState<VideoMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<"videos" | "actors" | "studios">("videos");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!videoPath) return;
    setLoading(true);
    (async () => {
      try {
        const raw: any[] = await trpc.videos.list.query({ path: videoPath });
        setVideos(convertVideos(raw));
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
    return videos.filter((v) =>
      v.name.toLowerCase().includes(q) || v.title?.toLowerCase().includes(q) ||
      v.code?.toLowerCase().includes(q) || v.actors?.some((a) => a.toLowerCase().includes(q)) ||
      v.studio?.toLowerCase().includes(q),
    );
  }, [videos, searchQuery]);

  const actorStats = useMemo(() => {
    const map = new Map<string, ActorInfo>();
    for (const v of videos) {
      if (!v.actors) continue;
      for (const a of v.actors) {
        const info = map.get(a) || { name: a, count: 0, videos: [] as string[], studios: [] as string[], genres: [] as string[] };
        info.count++;
        info.videos.push(v.title || v.name);
        if (v.studio && !info.studios.includes(v.studio)) info.studios.push(v.studio);
        if (v.genres) for (const g of v.genres) { if (!info.genres.includes(g)) info.genres.push(g); }
        map.set(a, info);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [videos]);

  const filteredActors = useMemo(() => {
    if (!searchQuery.trim()) return actorStats;
    const q = searchQuery.toLowerCase();
    return actorStats.filter((a) => a.name.toLowerCase().includes(q));
  }, [actorStats, searchQuery]);

  const studioStats = useMemo(() => {
    const map = new Map<string, StudioInfo>();
    for (const v of videos) {
      if (!v.studio) continue;
      const info = map.get(v.studio) || { name: v.studio, count: 0, actors: [] as string[], series: [] as string[] };
      info.count++;
      if (v.actors) for (const a of v.actors) { if (!info.actors.includes(a)) info.actors.push(a); }
      if (v.studioSeries && !info.series.includes(v.studioSeries)) info.series.push(v.studioSeries);
      map.set(v.studio, info);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [videos]);

  const filteredStudios = useMemo(() => {
    if (!searchQuery.trim()) return studioStats;
    const q = searchQuery.toLowerCase();
    return studioStats.filter((s) => s.name.toLowerCase().includes(q));
  }, [studioStats, searchQuery]);

  const totalSize = useMemo(() => {
    let bytes = 0;
    for (const v of videos) {
      if (v.size) {
        const m = v.size.match(/([\d.]+)\s*(GB|MB|TB)/i);
        if (m) {
          const n = parseFloat(m[1]), u = m[2].toUpperCase();
          if (u === "TB") bytes += n * 1024 ** 4;
          else if (u === "GB") bytes += n * 1024 ** 3;
          else if (u === "MB") bytes += n * 1024 ** 2;
        }
      }
    }
    if (bytes >= 1024 ** 4) return `${(bytes / (1024 ** 4)).toFixed(1)} TB`;
    return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
  }, [videos]);

  // 分组：将 items 按 cols 列分组为行
  const videoRows = useMemo(() => {
    const rows: VideoMeta[][] = [];
    for (let i = 0; i < filteredVideos.length; i += VIDEO_CD) rows.push(filteredVideos.slice(i, i + VIDEO_CD));
    return rows;
  }, [filteredVideos]);
  const actorRows = useMemo(() => {
    const rows: ActorInfo[][] = [];
    for (let i = 0; i < filteredActors.length; i += CD) rows.push(filteredActors.slice(i, i + CD));
    return rows;
  }, [filteredActors]);
  const studioRows = useMemo(() => {
    const rows: StudioInfo[][] = [];
    for (let i = 0; i < filteredStudios.length; i += CD) rows.push(filteredStudios.slice(i, i + CD));
    return rows;
  }, [filteredStudios]);

  // 虚拟列表 —— 以行为单位
  const videoVirtualizer = useVirtualizer({
    count: videoRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 220,
    overscan: 4,
    enabled: tab === "videos",
  });
  const actorVirtualizer = useVirtualizer({
    count: actorRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 150,
    overscan: 4,
    enabled: tab === "actors",
  });
  const studioVirtualizer = useVirtualizer({
    count: studioRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 150,
    overscan: 4,
    enabled: tab === "studios",
  });

  const handleTabChange = useCallback((t: "videos" | "actors" | "studios") => {
    setTab(t);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  const activeCount = tab === "videos" ? filteredVideos.length : tab === "actors" ? filteredActors.length : filteredStudios.length;

  return (
    <div className="h-full flex flex-col bg-[#f8fafc] dark:bg-slate-950 select-none">
      <PageLoader active={loading} label="加载情报" />

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 dark:border-slate-800 shrink-0 bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm">
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
            type="text" placeholder="搜索..."
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 w-56 pl-8 pr-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/20"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-slate-200 dark:border-slate-800 shrink-0 bg-white/60 dark:bg-slate-950/60">
        {([
          { key: "videos" as const, label: "影片", icon: Film },
          { key: "actors" as const, label: "演员", icon: Users },
          { key: "studios" as const, label: "厂商", icon: Building2 },
        ]).map(({ key, label, icon: Icon }) => (
          <button
            key={key} onClick={() => handleTabChange(key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
              tab === key ? "bg-amber-500 text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <Icon className="w-3 h-3" />{label}
          </button>
        ))}
        <div className="ml-auto text-[10px] text-slate-400">
          {activeCount} 项
          {searchQuery && <span className="text-amber-500 ml-1">(筛选: "{searchQuery}")</span>}
        </div>
      </div>

      {/* Virtual Scrolling Grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {/* ====== 影片 ====== */}
        {tab === "videos" && (
          videoRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-300 gap-3">
              <Film className="w-12 h-12 opacity-30" />
              <p className="text-xs">{searchQuery ? "未找到匹配影片" : "暂无影片数据"}</p>
            </div>
          ) : (
            <div style={{ height: videoVirtualizer.getTotalSize(), width: "100%", position: "relative" }}>
              <div style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${videoVirtualizer.getVirtualItems()[0]?.start ?? 0}px)` }}>
                {videoVirtualizer.getVirtualItems().map((vRow) => (
                  <div key={vRow.key} data-index={vRow.index} ref={videoVirtualizer.measureElement} className="grid grid-cols-2 gap-4 pb-4">
                    {videoRows[vRow.index].map((v) => (
                      <VideoCard key={v.id} video={v} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )
        )}

        {/* ====== 演员 ====== */}
        {tab === "actors" && (
          actorRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-300 gap-3">
              <Users className="w-12 h-12 opacity-30" />
              <p className="text-xs">{searchQuery ? "未找到匹配演员" : "暂无演员数据"}</p>
            </div>
          ) : (
            <div style={{ height: actorVirtualizer.getTotalSize(), width: "100%", position: "relative" }}>
              <div style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${actorVirtualizer.getVirtualItems()[0]?.start ?? 0}px)` }}>
                {actorVirtualizer.getVirtualItems().map((vRow) => (
                  <div key={vRow.key} data-index={vRow.index} ref={actorVirtualizer.measureElement} className="grid grid-cols-4 gap-4 pb-4">
                    {actorRows[vRow.index].map((a) => (
                      <ActorCard key={a.name} actor={a} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )
        )}

        {/* ====== 厂商 ====== */}
        {tab === "studios" && (
          studioRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-300 gap-3">
              <Building2 className="w-12 h-12 opacity-30" />
              <p className="text-xs">{searchQuery ? "未找到匹配厂商" : "暂无厂商数据"}</p>
            </div>
          ) : (
            <div style={{ height: studioVirtualizer.getTotalSize(), width: "100%", position: "relative" }}>
              <div style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${studioVirtualizer.getVirtualItems()[0]?.start ?? 0}px)` }}>
                {studioVirtualizer.getVirtualItems().map((vRow) => (
                  <div key={vRow.key} data-index={vRow.index} ref={studioVirtualizer.measureElement} className="grid grid-cols-4 gap-4 pb-4">
                    {studioRows[vRow.index].map((s) => (
                      <StudioCard key={s.name} studio={s} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}