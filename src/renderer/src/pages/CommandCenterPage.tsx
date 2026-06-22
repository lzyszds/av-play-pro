import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Award,
  Bell,
  Boxes,
  CalendarDays,
  CheckCircle2,
  Clapperboard,
  Dice5,
  Film,
  Gauge,
  HardDrive,
  ListChecks,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Workflow,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import { trpc } from "../lib/trpc";
import { PageLoader } from "../components/PageLoader";
import { CoverImage } from "../components/CoverImage";

interface Props {
  videoPath: string;
  onAddSystemLog: (text: string, level: "INFO" | "WARNING" | "SUCCESS" | "ERROR") => void;
}

interface VideoItem {
  id: string;
  name: string;
  url: string;
  coverUrl?: string;
  size?: string;
  createdAt?: number;
  code?: string;
  title?: string;
  actors?: string[];
  genres?: string[];
  studio?: string;
  duration?: string;
}

interface IngestStep {
  key: string;
  label: string;
  count: number;
  status: string;
}

interface TimelineBookmark {
  id: string;
  videoName: string;
  videoUrl: string;
  currentTime: number;
  duration?: number;
  note?: string;
  createdAt: string;
}

function encodeMediaUrl(filePath?: string): string | undefined {
  if (!filePath || filePath.includes("://")) return filePath;
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const encoded = segments.map((seg, index) =>
    index === 0 && /^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg),
  );
  return `local-media:///${encoded.join("/")}`;
}

function convertVideo(video: VideoItem): VideoItem {
  return { ...video, coverUrl: encodeMediaUrl(video.coverUrl) };
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Film;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        <Icon className="w-3.5 h-3.5 text-amber-500" />
        {label}
      </div>
      <div className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">{value}</div>
      {sub && <div className="text-[10px] text-slate-400 truncate">{sub}</div>}
    </div>
  );
}

function MiniVideo({ video, onPlay }: { video: VideoItem; onPlay?: (video: VideoItem) => void }) {
  const v = convertVideo(video);
  return (
    <button
      type="button"
      onClick={() => onPlay?.(v)}
      className="group text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden hover:border-amber-300 dark:hover:border-amber-700 transition cursor-pointer"
    >
      <div className="aspect-video bg-slate-100 dark:bg-slate-800">
        {v.coverUrl ? <CoverImage src={v.coverUrl} alt={v.name} /> : <div className="h-full flex items-center justify-center"><Film className="w-6 h-6 text-slate-400" /></div>}
      </div>
      <div className="p-2">
        <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200 line-clamp-2 group-hover:text-amber-600">
          {v.title || v.name}
        </div>
        <div className="mt-1 flex items-center gap-1 text-[9px] text-slate-400">
          {v.code && <span className="font-mono text-amber-500">{v.code}</span>}
          {v.size && <span>{v.size}</span>}
        </div>
      </div>
    </button>
  );
}

function HeatGrid({ values }: { values: Record<string, number> }) {
  const days = useMemo(() => {
    const out: string[] = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = 119; i >= 0; i -= 1) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    return out;
  }, []);
  const max = Math.max(1, ...days.map((day) => values[day] || 0));
  return (
    <div className="grid grid-cols-[repeat(30,1fr)] gap-1">
      {days.map((day) => {
        const value = values[day] || 0;
        const ratio = value / max;
        const cls =
          value === 0
            ? "bg-slate-100 dark:bg-slate-800"
            : ratio < 0.34
              ? "bg-amber-200 dark:bg-amber-900"
              : ratio < 0.67
                ? "bg-amber-400 dark:bg-amber-700"
                : "bg-amber-500";
        return <div key={day} title={`${day}: ${value}`} className={`aspect-square rounded-sm ${cls}`} />;
      })}
    </div>
  );
}

function formatTime(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CommandCenterPage({ videoPath, onAddSystemLog }: Props) {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<VideoItem[]>([]);
  const [slotResults, setSlotResults] = useState<VideoItem[]>([]);
  const [ingestPlan, setIngestPlan] = useState<{ total: number; steps: IngestStep[] } | null>(null);
  const [timelineRows, setTimelineRows] = useState<TimelineBookmark[]>([]);
  const [runningIngest, setRunningIngest] = useState(false);

  const refresh = useCallback(async () => {
    if (!videoPath) return;
    setLoading(true);
    try {
      const data = await trpc.library.overview.query({ rootPath: videoPath });
      const [plan, timeline] = await Promise.all([
        trpc.library.ingestPlan.query({ rootPath: videoPath }),
        trpc.library.timeline.query({}),
      ]);
      setOverview(data);
      setIngestPlan(plan);
      setTimelineRows((timeline as TimelineBookmark[]).slice(0, 8));
      onAddSystemLog(`指挥中心已刷新: ${data.totals.videos} 部`, "SUCCESS");
    } catch (err: any) {
      onAddSystemLog(`指挥中心刷新失败: ${err?.message || err}`, "ERROR");
    } finally {
      setLoading(false);
    }
  }, [videoPath, onAddSystemLog]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const q = query.trim();
    if (!q || !videoPath) {
      setSearchResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const rows = await trpc.library.search.query({ rootPath: videoPath, query: q });
      setSearchResults(rows.map(convertVideo));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, videoPath]);

  const runSlot = async () => {
    const rows = await trpc.library.slot.query({ rootPath: videoPath });
    setSlotResults(rows.map(convertVideo));
    onAddSystemLog(`片库老虎机抽出 ${rows.length} 个候选`, "INFO");
  };

  const runIngest = async () => {
    setRunningIngest(true);
    try {
      const res = await trpc.library.runIngest.mutate({ rootPath: videoPath });
      onAddSystemLog(res.message, res.success ? "SUCCESS" : "WARNING");
      await refresh();
    } catch (err: any) {
      onAddSystemLog(`自动入库失败: ${err?.message || err}`, "ERROR");
    } finally {
      setRunningIngest(false);
    }
  };

  const openWidgetWindow = async () => {
    try {
      await trpc.window.openLibraryWidget.mutate({ rootPath: videoPath });
      onAddSystemLog("片库桌面小组件已打开", "SUCCESS");
    } catch (err: any) {
      onAddSystemLog(`打开片库小组件失败: ${err?.message || err}`, "ERROR");
    }
  };

  const openVideo = (video: VideoItem) => {
    window.open(encodeMediaUrl(video.url), "_blank");
  };

  const totals = overview?.totals;

  return (
    <div className="h-full overflow-y-auto bg-[#f8fafc] dark:bg-slate-950 p-5 space-y-4">
      <PageLoader active={loading} label="加载指挥中心" />

      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Gauge className="w-5 h-5 text-amber-500" />
            片库指挥中心
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">Live Mode / 入库流水线 / 搜索 / 演员墙 / 热力图 / 成就 / 通知</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="本地搜索：番号 / 演员 / 标签 / 片商"
              className="w-full h-9 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 pl-9 pr-3 text-[12px] focus:outline-none focus:border-amber-400"
            />
          </div>
          <button type="button" onClick={refresh} className="h-9 px-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[12px] font-bold text-slate-600 dark:text-slate-300 hover:text-amber-500 transition cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5 inline mr-1" />
            刷新
          </button>
          <button type="button" onClick={openWidgetWindow} className="h-9 px-3 rounded-lg bg-amber-500 text-white text-[12px] font-bold hover:bg-amber-600 transition cursor-pointer">
            小组件窗口
          </button>
        </div>
      </div>

      {searchResults.length > 0 && (
        <section className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/10 p-3">
          <div className="text-[12px] font-bold text-amber-700 dark:text-amber-300 mb-2">搜索结果</div>
          <div className="grid grid-cols-6 gap-2">
            {searchResults.slice(0, 12).map((video) => <MiniVideo key={video.id} video={video} onPlay={openVideo} />)}
          </div>
        </section>
      )}

      {totals && (
        <div className="grid grid-cols-4 xl:grid-cols-8 gap-3">
          <StatTile icon={Film} label="影片" value={String(totals.videos)} sub={totals.totalSize} />
          <StatTile icon={Users} label="演员" value={String(totals.actors)} sub={`${totals.studios} 片商`} />
          <StatTile icon={Play} label="未看" value={String(totals.unseen)} sub={`${totals.halfWatched} 有播放记录`} />
          <StatTile icon={Boxes} label="重复番号" value={String(totals.duplicates)} sub="可清理版本" />
          <StatTile icon={Clapperboard} label="缺封面" value={String(totals.missingCover)} sub="入库待处理" />
          <StatTile icon={Wrench} label="缺资料" value={String(totals.missingMeta)} sub="meta 待补" />
          <StatTile icon={Activity} label="书签" value={String(totals.bookmarks)} sub="时间轴片段" />
          <StatTile icon={HardDrive} label="体积" value={totals.totalSize} sub="本地片库" />
        </div>
      )}

      <div className="grid grid-cols-[1fr_1fr] gap-4">
        <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Workflow className="w-4 h-4 text-cyan-500" />
              自动入库流水线计划
            </h3>
            <button type="button" onClick={runIngest} disabled={runningIngest} className="h-7 px-3 rounded-md bg-cyan-600 text-white text-[11px] font-bold disabled:opacity-50 cursor-pointer">
              {runningIngest ? "执行中..." : "执行入库"}
            </button>
          </div>
          <div className="space-y-2">
            {(ingestPlan?.steps || []).map((step) => {
              const total = Math.max(1, ingestPlan?.total || 1);
              const width = Math.min(100, Math.round((step.count / total) * 100));
              return (
                <div key={step.key} className="rounded-md bg-slate-50 dark:bg-slate-800 px-3 py-2">
                  <div className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="font-bold text-slate-700 dark:text-slate-200 truncate">{step.label}</span>
                    <span className="font-mono text-slate-400 shrink-0">{step.count}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-white dark:bg-slate-950 overflow-hidden">
                    <div className="h-full bg-cyan-500" style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-amber-500" />
              最近时间轴书签
            </h3>
            <span className="text-[10px] text-slate-400">播放器里点时间可跳转</span>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {timelineRows.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-slate-400">还没有保存过时间轴书签</div>
            ) : (
              timelineRows.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => window.open(encodeMediaUrl(item.videoUrl), "_blank")}
                  className="w-full text-left rounded-md bg-slate-50 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-950/20 px-3 py-2 transition cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-amber-600">{formatTime(item.currentTime)}</span>
                    <span className="text-[9px] text-slate-400">{item.createdAt?.slice(0, 10)}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate">{item.videoName}</div>
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-[1.3fr_0.9fr] gap-4">
        <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              看片仪表盘 Live Mode
            </h3>
            <button type="button" onClick={runIngest} disabled={runningIngest} className="h-7 px-3 rounded-md bg-amber-500 text-white text-[11px] font-bold disabled:opacity-50 cursor-pointer">
              {runningIngest ? "入库中..." : "运行自动入库"}
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {(overview?.recent || []).slice(0, 8).map((video: VideoItem) => <MiniVideo key={video.id} video={video} onPlay={openVideo} />)}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Bell className="w-4 h-4 text-rose-500" />
              本地通知中心
            </h3>
          </div>
          <div className="space-y-2">
            {(overview?.notifications || []).length === 0 && (
              <div className="text-[12px] text-slate-400 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                暂无待处理事项
              </div>
            )}
            {(overview?.notifications || []).map((note: any, index: number) => (
              <div key={index} className="rounded-md bg-slate-50 dark:bg-slate-800 px-3 py-2">
                <div className="text-[12px] font-bold text-slate-700 dark:text-slate-200">{note.title}</div>
                <div className="text-[10px] text-slate-400">{note.body}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold flex items-center gap-2"><Dice5 className="w-4 h-4 text-pink-500" />片库老虎机</h3>
            <button type="button" onClick={runSlot} className="h-7 px-3 rounded-md bg-pink-500 text-white text-[11px] font-bold cursor-pointer">开摇</button>
          </div>
          <div className="space-y-2">
            {(slotResults.length ? slotResults : (overview?.unseen || []).slice(0, 3)).map((video: VideoItem) => (
              <div key={video.id} className="flex items-center gap-2">
                <div className="w-20 aspect-video rounded overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0">
                  {convertVideo(video).coverUrl ? <CoverImage src={convertVideo(video).coverUrl} alt={video.name} /> : null}
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">{video.title || video.name}</div>
                  <div className="text-[9px] text-slate-400 truncate">{video.actors?.join(" / ") || video.code}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <h3 className="text-sm font-bold flex items-center gap-2 mb-3"><CalendarDays className="w-4 h-4 text-amber-500" />欲望热力图</h3>
          <HeatGrid values={overview?.addedByDay || {}} />
          <div className="mt-2 text-[10px] text-slate-400">按最近 120 天入库数量计算</div>
        </section>

        <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <h3 className="text-sm font-bold flex items-center gap-2 mb-3"><Award className="w-4 h-4 text-violet-500" />片库成就</h3>
          <div className="space-y-2">
            {(overview?.achievements || []).map((ach: any) => (
              <div key={ach.id}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className={ach.done ? "text-emerald-500 font-bold" : "text-slate-600 dark:text-slate-300"}>{ach.title}</span>
                  <span className="text-slate-400">{ach.progress}/{ach.target}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className={`h-full ${ach.done ? "bg-emerald-500" : "bg-violet-500"}`} style={{ width: `${Math.min(100, (ach.progress / ach.target) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <h3 className="text-sm font-bold flex items-center gap-2 mb-3"><UserRound className="w-4 h-4 text-rose-500" />本地演员墙</h3>
        <div className="grid grid-cols-8 gap-2">
          {(overview?.actors || []).slice(0, 32).map((actor: any) => (
            <div key={actor.name} className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2">
              <div className="text-[12px] font-bold text-slate-700 dark:text-slate-200 truncate">{actor.name}</div>
              <div className="text-[10px] text-slate-400">{actor.count} 部 · {actor.unseen} 未看</div>
              <div className="mt-1 text-[9px] text-slate-400 truncate">{actor.genres.slice(0, 3).join(" / ")}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
