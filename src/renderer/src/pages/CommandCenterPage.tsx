import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Clapperboard,
  Copy,
  ExternalLink,
  Film,
  FolderArchive,
  Gauge,
  HardDrive,
  Info,
  Layers,
  ListFilter,
  Play,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";
import { trpc } from "../lib/trpc";
import { PageLoader } from "../components/PageLoader";
import { Tooltip } from "../components/common/Tooltip";
import { CoverImage } from "../components/CoverImage";
import { OrganizerModal } from "../components/organizer/OrganizerModal";
import { Button } from "../components/common/Button";

interface Props {
  videoPath: string;
  tempPath?: string;
  onAddSystemLog: (text: string, level: "INFO" | "WARNING" | "SUCCESS" | "ERROR") => void;
  onPlayVideo?: (name: string) => void;
  onNavigate?: (page: string) => void;
}

interface VideoItem {
  id: string;
  name: string;
  url: string;
  coverUrl?: string;
  previewUrl?: string;
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

interface CleanupItem {
  id: string;
  path: string;
  name: string;
  kind: "empty" | "no_video" | "tiny_video" | "temp" | "loose_file";
  reason: string;
  sizeBytes: number;
  sizeLabel: string;
  fileCount: number;
  selectedByDefault: boolean;
}

interface DuplicateGroup {
  code: string;
  count: number;
  videos: VideoItem[];
}

const KIND_LABEL: Record<CleanupItem["kind"], { label: string; color: string }> = {
  empty: { label: "空文件夹", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  no_video: { label: "无正片残留", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  tiny_video: { label: "损坏/不完整", color: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
  temp: { label: "临时缓存", color: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
  loose_file: { label: "散落杂项", color: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300" },
};

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

function formatBytesClient(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 综合计算片库健康雷达评分 (0 - 100) */
function calculateHealthScore(overview: any, health: any): {
  score: number;
  grade: string;
  level: "excellent" | "good" | "warning" | "danger";
  summary: string;
} {
  if (!overview?.totals) {
    return { score: 100, grade: "S", level: "excellent", summary: "片库健康正常" };
  }
  const total = Math.max(1, overview.totals.videos || 1);
  let deduction = 0;

  // 1. 缺封面扣分 (最高扣 25 分)
  const missingCoverRate = (overview.totals.missingCover || 0) / total;
  deduction += Math.min(25, Math.round(missingCoverRate * 40));

  // 2. 缺元数据/番号扣分 (最高扣 25 分)
  const missingMetaRate = (overview.totals.missingMeta || 0) / total;
  deduction += Math.min(25, Math.round(missingMetaRate * 45));

  // 3. 重复番号扣分 (每组扣 3 分，最高 15 分)
  const dupCount = overview.totals.duplicates || 0;
  deduction += Math.min(15, dupCount * 3);

  // 4. 磁盘剩余空间扣分 (低于 10% 扣 15 分，低于 5% 扣 25 分)
  if (health && health.totalBytes > 0 && health.freeBytes > 0) {
    const freeRatio = health.freeBytes / health.totalBytes;
    if (freeRatio < 0.05) deduction += 25;
    else if (freeRatio < 0.10) deduction += 15;
    else if (freeRatio < 0.15) deduction += 5;
  }

  const score = Math.max(0, Math.min(100, 100 - deduction));

  if (score >= 90) {
    return {
      score,
      grade: "S 优异",
      level: "excellent",
      summary: "片库状态极佳，元数据完备，存储空间充裕",
    };
  }
  if (score >= 75) {
    return {
      score,
      grade: "A 良好",
      level: "good",
      summary: "片库整体健康，仅存在少量待补全元数据或重复版本",
    };
  }
  if (score >= 60) {
    return {
      score,
      grade: "B 需治理",
      level: "warning",
      summary: "发现若干待治理事项，建议运行入库流水线并清理冗余",
    };
  }
  return {
    score,
    grade: "C 警报",
    level: "danger",
    summary: "元数据缺失严重或磁盘空间见底，请立即体检与清理",
  };
}

export function CommandCenterPage({
  videoPath,
  tempPath,
  onAddSystemLog,
  onPlayVideo,
  onNavigate,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<any>(null);
  const [healthData, setHealthData] = useState<any>(null);
  const [ingestPlan, setIngestPlan] = useState<{ total: number; steps: IngestStep[] } | null>(null);
  const [runningIngest, setRunningIngest] = useState(false);

  // 诊断工作台子标签: "duplicates" | "metadata" | "pipeline" | "cleaner"
  const [activeSubTab, setActiveSubTab] = useState<"duplicates" | "metadata" | "pipeline" | "cleaner">("duplicates");

  // 元数据过滤: "all" | "missingCover" | "missingMeta"
  const [metaFilter, setMetaFilter] = useState<"all" | "missingCover" | "missingMeta">("all");

  // 磁盘清理状态
  const [cleanupItems, setCleanupItems] = useState<CleanupItem[]>([]);
  const [cleanupSelected, setCleanupSelected] = useState<Set<string>>(new Set());
  const [cleanupTotalLabel, setCleanupTotalLabel] = useState("0 B");
  const [cleanupScanning, setCleanupScanning] = useState(false);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupScannedOnce, setCleanupScannedOnce] = useState(false);

  // Emby 软链接整理弹窗
  const [showOrganizerModal, setShowOrganizerModal] = useState(false);

  // 本地快速搜索
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<VideoItem[]>([]);

  // 刷新核心数据
  const refresh = useCallback(async () => {
    if (!videoPath) return;
    setLoading(true);
    try {
      const [data, health, plan] = await Promise.all([
        trpc.library.overview.query({ rootPath: videoPath }),
        trpc.library.health.query({ rootPath: videoPath, tempPath: tempPath || undefined }),
        trpc.library.ingestPlan.query({ rootPath: videoPath }),
      ]);
      setOverview(data);
      setHealthData(health);
      setIngestPlan(plan);
      onAddSystemLog(`片库控制台已同步: ${data.totals.videos} 部影片`, "SUCCESS");
    } catch (err: any) {
      onAddSystemLog(`片库数据同步失败: ${err?.message || err}`, "ERROR");
    } finally {
      setLoading(false);
    }
  }, [videoPath, tempPath, onAddSystemLog]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 搜索处理
  useEffect(() => {
    const q = query.trim();
    if (!q || !videoPath) {
      setSearchResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const rows = await trpc.library.search.query({ rootPath: videoPath, query: q });
        setSearchResults(rows.map(convertVideo));
      } catch {}
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, videoPath]);

  // 运行自动入库流水线
  const runIngest = async () => {
    if (runningIngest) return;
    setRunningIngest(true);
    try {
      const res = await trpc.library.runIngest.mutate({ rootPath: videoPath });
      onAddSystemLog(res.message, res.success ? "SUCCESS" : "WARNING");
      await refresh();
    } catch (err: any) {
      onAddSystemLog(`自动入库执行失败: ${err?.message || err}`, "ERROR");
    } finally {
      setRunningIngest(false);
    }
  };

  // 打开桌面小组件
  const openWidgetWindow = async () => {
    try {
      await trpc.window.openLibraryWidget.mutate({ rootPath: videoPath });
      onAddSystemLog("片库桌面微型组件已调起", "SUCCESS");
    } catch (err: any) {
      onAddSystemLog(`打开小组件失败: ${err?.message || err}`, "ERROR");
    }
  };

  // 扫描磁盘清理目标
  const scanCleanup = async () => {
    if (!videoPath) {
      onAddSystemLog("未配置视频库路径，无法扫描磁盘残留", "WARNING");
      return;
    }
    setCleanupScanning(true);
    try {
      const data = await trpc.library.scanCleanupTargets.query({
        rootPath: videoPath,
        tempPath: tempPath || undefined,
      });
      setCleanupItems(data.items as CleanupItem[]);
      setCleanupTotalLabel(data.totalLabel);
      setCleanupSelected(
        new Set(
          (data.items as CleanupItem[])
            .filter((item) => item.selectedByDefault)
            .map((item) => item.path),
        ),
      );
      setCleanupScannedOnce(true);
      onAddSystemLog(
        `磁盘扫描完成: 发现 ${data.items.length} 处冗余（可释放 ${data.totalLabel}）`,
        data.items.length > 0 ? "WARNING" : "SUCCESS",
      );
    } catch (err: any) {
      onAddSystemLog(`磁盘扫描失败: ${err?.message || err}`, "ERROR");
    } finally {
      setCleanupScanning(false);
    }
  };

  const toggleCleanupItem = (itemPath: string) => {
    setCleanupSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemPath)) next.delete(itemPath);
      else next.add(itemPath);
      return next;
    });
  };

  const selectCleanupDefaults = () => {
    setCleanupSelected(
      new Set(cleanupItems.filter((item) => item.selectedByDefault).map((item) => item.path)),
    );
  };

  const selectAllCleanup = () => {
    setCleanupSelected(new Set(cleanupItems.map((item) => item.path)));
  };

  const clearCleanupSelection = () => setCleanupSelected(new Set());

  // 执行删除清理
  const runCleanup = async () => {
    if (cleanupSelected.size === 0 || cleanupRunning) return;
    const ok = window.confirm(
      `【谨慎操作】确认永久删除选中的 ${cleanupSelected.size} 项残留文件与文件夹？\n此操作不可恢复。`,
    );
    if (!ok) return;

    setCleanupRunning(true);
    try {
      const res = await trpc.library.cleanCleanupTargets.mutate({
        rootPath: videoPath,
        tempPath: tempPath || undefined,
        paths: [...cleanupSelected],
      });
      onAddSystemLog(res.message, res.success ? "SUCCESS" : "WARNING");
      if (res.failed?.length) {
        for (const fail of res.failed.slice(0, 3)) {
          onAddSystemLog(`清理失败: ${fail}`, "ERROR");
        }
      }
      await scanCleanup();
      await refresh();
    } catch (err: any) {
      onAddSystemLog(`清理执行中断: ${err?.message || err}`, "ERROR");
    } finally {
      setCleanupRunning(false);
    }
  };

  // 播放处理（优先应用内置播放器）
  const handlePlayVideo = (videoName: string) => {
    if (onPlayVideo) {
      onPlayVideo(videoName);
    } else {
      // 降级回退
      const v = overview?.recent?.find((i: VideoItem) => i.name === videoName);
      if (v) window.open(encodeMediaUrl(v.url), "_blank");
    }
  };

  // 计算健康评分
  const healthMeta = useMemo(() => calculateHealthScore(overview, healthData), [overview, healthData]);

  // 已选清理字节数
  const selectedCleanupBytes = useMemo(
    () =>
      cleanupItems
        .filter((item) => cleanupSelected.has(item.path))
        .reduce((sum, item) => sum + item.sizeBytes, 0),
    [cleanupItems, cleanupSelected],
  );

  const totals = overview?.totals;
  const issues = overview?.issues;
  const duplicateGroups: DuplicateGroup[] = issues?.duplicates || [];

  // 过滤缺失项
  const filteredMissingItems: VideoItem[] = useMemo(() => {
    if (!issues) return [];
    if (metaFilter === "missingCover") return issues.missingCover || [];
    if (metaFilter === "missingMeta") return issues.missingMeta || [];
    // all
    const map = new Map<string, VideoItem>();
    for (const v of issues.missingCover || []) map.set(v.id, v);
    for (const v of issues.missingMeta || []) map.set(v.id, v);
    return Array.from(map.values());
  }, [issues, metaFilter]);

  // 磁盘百分比
  const diskPercentage = useMemo(() => {
    if (!healthData || !healthData.totalBytes || healthData.totalBytes <= 0) return null;
    const usedBytes = Math.max(0, healthData.totalBytes - (healthData.freeBytes || 0));
    return Math.min(100, Math.round((usedBytes / healthData.totalBytes) * 100));
  }, [healthData]);

  return (
    <div className="relative h-full overflow-y-auto bg-slate-50/50 dark:bg-slate-950 p-6 space-y-6 text-slate-800 dark:text-slate-100">
      <PageLoader active={loading} label="同步指挥中枢数据..." />

      {/* ===================== 1. 顶栏：标题与核心行动群 ===================== */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200/80 dark:border-slate-800/80 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shadow-xs shrink-0">
            <Gauge className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                片库指挥中枢
              </h2>
              <span className="text-[10px] font-bold font-mono uppercase px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                Operations Console
              </span>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              片库健康诊断 · 资产规范化治理 · 磁盘空间瘦身与自动化流水线
            </p>
          </div>
        </div>

        {/* 顶部行动按钮 */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* 本地搜索 */}
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索番号 / 演员 / 片商..."
              className="w-full h-9 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 pl-9 pr-3 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition shadow-2xs"
            />
            {query && (
              <Tooltip content="清空搜索词" placement="bottom">
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="清空搜索词"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  ✕
                </button>
              </Tooltip>
            )}
          </div>

          <Button
            variant="secondary"
            size="md"
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />}
            onClick={refresh}
            title="刷新数据"
          >
            刷新
          </Button>

          <Button
            variant="secondary"
            size="md"
            icon={<FolderArchive className="w-3.5 h-3.5 text-blue-500" />}
            onClick={() => setShowOrganizerModal(true)}
            className="text-blue-600 dark:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
            title="Emby / Plex 媒体库规范化软链接导出与 NFO 整理"
          >
            Emby软链接整理
          </Button>

          <Button
            variant="primary"
            size="md"
            icon={<Sparkles className="w-3.5 h-3.5" />}
            onClick={openWidgetWindow}
            title="打开独立桌面片库悬浮组件"
          >
            桌面小组件
          </Button>
        </div>
      </div>

      {/* 搜索结果浮层展示 */}
      {searchResults.length > 0 && (
        <section className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-3 anim-fade-in shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold text-amber-800 dark:text-amber-300">
            <span>找到 {searchResults.length} 部相关作品</span>
            <span className="text-[10px] text-amber-600/80 dark:text-amber-400">点击直接在播放器播放</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {searchResults.slice(0, 12).map((video) => (
              <button
                key={video.id}
                type="button"
                onClick={() => handlePlayVideo(video.name)}
                className="group text-left rounded-xl border border-amber-200/60 dark:border-amber-900/40 bg-white dark:bg-slate-900 overflow-hidden hover:border-amber-400 hover:shadow-md transition cursor-pointer"
              >
                <div className="aspect-video bg-slate-100 dark:bg-slate-800 relative">
                  {video.coverUrl ? (
                    <CoverImage src={video.coverUrl} alt={video.name} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-400">
                      <Film className="w-5 h-5" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                    <Play className="w-6 h-6 text-white drop-shadow" />
                  </div>
                </div>
                <div className="p-2">
                  <div className="text-[11px] font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-amber-500">
                    {video.title || video.name}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[9px] text-slate-400 font-mono">
                    <span className="text-amber-600 dark:text-amber-400 font-bold">{video.code}</span>
                    <span>{video.size}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ===================== 2. 控制台驾驶舱：健康雷达 + 4大核心资产胶囊 ===================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 左侧：片库健康综合雷达 (4 cols) */}
        <div className="lg:col-span-4 rounded-2xl p-5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {healthMeta.level === "excellent" || healthMeta.level === "good" ? (
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-amber-500" />
              )}
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                片库健康诊断指数
              </h3>
            </div>
            <span
              className={`text-[11px] font-bold px-2 py-0.5 rounded-lg ${
                healthMeta.level === "excellent"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                  : healthMeta.level === "good"
                    ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20"
                    : healthMeta.level === "warning"
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                      : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
              }`}
            >
              {healthMeta.grade}
            </span>
          </div>

          <div className="flex items-baseline gap-3 my-1">
            <div
              className={`text-5xl font-black tracking-tight ${
                healthMeta.level === "excellent"
                  ? "text-emerald-500"
                  : healthMeta.level === "good"
                    ? "text-sky-500"
                    : healthMeta.level === "warning"
                      ? "text-amber-500"
                      : "text-rose-500"
              }`}
            >
              {healthMeta.score}
            </div>
            <div className="text-slate-400 text-xs font-mono">/ 100 分</div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {healthMeta.summary}
          </p>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
            <span>未看作品: <strong className="text-slate-700 dark:text-slate-200">{totals?.unseen || 0}</strong> 部</span>
            <span>已看/半看: <strong className="text-slate-700 dark:text-slate-200">{totals?.halfWatched || 0}</strong> 部</span>
            <button
              type="button"
              onClick={() => onNavigate?.("stats")}
              className="text-amber-500 hover:underline cursor-pointer flex items-center gap-0.5"
            >
              查看深度统计
              <ExternalLink className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>

        {/* 右侧：4大资产胶囊指标 (8 cols) */}
        <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* 胶囊 1: 影片总资产 */}
          <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
              <span>影片资产</span>
              <Film className="w-4 h-4 text-blue-500" />
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {totals?.videos || 0}
                <span className="text-xs font-normal text-slate-400 ml-1">部</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                {totals?.totalSize || "0 B"}
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/60 text-[10px] text-slate-400 truncate">
              覆盖 {totals?.actors || 0} 位演员 · {totals?.studios || 0} 片商
            </div>
          </div>

          {/* 胶囊 2: 存储磁盘余量 */}
          <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
              <span>磁盘存储</span>
              <HardDrive className="w-4 h-4 text-purple-500" />
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {healthData && healthData.freeBytes > 0
                  ? formatBytesClient(healthData.freeBytes)
                  : "--"}
                <span className="text-xs font-normal text-slate-400 ml-1">可用</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    (diskPercentage || 0) > 90
                      ? "bg-rose-500"
                      : (diskPercentage || 0) > 80
                        ? "bg-amber-500"
                        : "bg-purple-500"
                  }`}
                  style={{ width: `${diskPercentage || 0}%` }}
                />
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/60 text-[10px] text-slate-400 truncate">
              {healthData && healthData.totalBytes > 0
                ? `已用 ${diskPercentage}% / 总量 ${formatBytesClient(healthData.totalBytes)}`
                : "正在检测磁盘容量"}
            </div>
          </div>

          {/* 胶囊 3: 元数据完备率 */}
          <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
              <span>资料完备度</span>
              <Clapperboard className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {totals?.videos
                  ? `${Math.max(
                      0,
                      Math.round(
                        (1 -
                          ((totals?.missingCover || 0) + (totals?.missingMeta || 0)) /
                            (totals.videos * 2)) *
                          100,
                      ),
                    )}%`
                  : "100%"}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                缺封面 {totals?.missingCover || 0} · 缺信息 {totals?.missingMeta || 0}
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/60 text-[10px] text-slate-400 truncate">
              <button
                type="button"
                onClick={() => setActiveSubTab("metadata")}
                className="text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                查看待补清单 →
              </button>
            </div>
          </div>

          {/* 胶囊 4: 冗余版本与残留 */}
          <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
              <span>冗余与残留</span>
              <Boxes className="w-4 h-4 text-rose-500" />
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {totals?.duplicates || 0}
                <span className="text-xs font-normal text-slate-400 ml-1">组重复</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {cleanupScannedOnce ? `可瘦身 ${cleanupTotalLabel}` : "待扫描残留"}
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/60 text-[10px] text-slate-400 truncate">
              <button
                type="button"
                onClick={() => {
                  setActiveSubTab("duplicates");
                }}
                className="text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
              >
                排查重复文件 →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ===================== 3. 诊断与治理中枢 (Triage & Operations Panel) ===================== */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {/* 工作台 Tab 切换顶栏 */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 pt-3">
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActiveSubTab("duplicates")}
              className={`pb-3 text-xs font-bold transition relative cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === "duplicates"
                  ? "text-rose-600 dark:text-rose-400 border-b-2 border-rose-500"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Boxes className="w-3.5 h-3.5" />
              <span>重复番号去重</span>
              {duplicateGroups.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500/10 text-rose-600 dark:text-rose-400 font-mono font-bold">
                  {duplicateGroups.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab("metadata")}
              className={`pb-3 text-xs font-bold transition relative cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === "metadata"
                  ? "text-amber-600 dark:text-amber-400 border-b-2 border-amber-500"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Clapperboard className="w-3.5 h-3.5" />
              <span>元数据与封面缺失</span>
              {((totals?.missingCover || 0) > 0 || (totals?.missingMeta || 0) > 0) && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono font-bold">
                  {(totals?.missingCover || 0) + (totals?.missingMeta || 0)}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab("pipeline")}
              className={`pb-3 text-xs font-bold transition relative cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === "pipeline"
                  ? "text-cyan-600 dark:text-cyan-400 border-b-2 border-cyan-500"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Workflow className="w-3.5 h-3.5" />
              <span>自动入库流水线</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSubTab("cleaner");
                if (!cleanupScannedOnce) void scanCleanup();
              }}
              className={`pb-3 text-xs font-bold transition relative cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === "cleaner"
                  ? "text-purple-600 dark:text-purple-400 border-b-2 border-purple-500"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>磁盘瘦身清理</span>
              {cleanupItems.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-purple-500/10 text-purple-600 dark:text-purple-400 font-mono font-bold">
                  {cleanupItems.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* ================= 工作台 Tab 1: 重复番号去重 ================= */}
        {activeSubTab === "duplicates" && (
          <div className="p-5 space-y-4 anim-fade-in">
            <div className="flex items-center justify-between text-xs text-slate-500 gap-3 flex-wrap">
              <p>
                检测到同一番号存在多个存放目录或不同分辨率版本。可对比画质与体积后择优保留，释放宝贵硬盘空间。
              </p>
              <div className="flex items-center gap-3">
                <span className="font-mono text-slate-400">共 {duplicateGroups.length} 组重复记录</span>
                {duplicateGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!videoPath) return;
                      if (!window.confirm(`将删除 ${duplicateGroups.length} 组重复番号的多余副本，只保留最早下载的那个，确认继续？`)) return;
                      try {
                        const res: any = await trpc.library.dedupeVideos.mutate({ rootPath: videoPath });
                        onAddSystemLog(res.message, res.deleted > 0 ? "SUCCESS" : "INFO");
                        if (res.failed?.length > 0) {
                          onAddSystemLog(`去重失败项: ${res.failed.join("; ")}`, "WARNING");
                        }
                        await refresh();
                      } catch (err: any) {
                        onAddSystemLog(`一键去重失败: ${err?.message || err}`, "ERROR");
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-500/25 text-xs font-bold transition cursor-pointer flex items-center gap-1"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    一键去重（保留最早）
                  </button>
                )}
              </div>
            </div>

            {duplicateGroups.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto opacity-80" />
                <div className="font-semibold text-slate-700 dark:text-slate-200">没有发现重复番号</div>
                <p className="text-[11px] text-slate-400">片库规范整洁，未出现多版本冗余</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                {duplicateGroups.map((group) => (
                  <div
                    key={group.code}
                    className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                          {group.code}
                        </span>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                          存在 {group.count} 个版本副本
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400">
                        点击各版本可在播放器快速对比
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {group.videos.map((vid, idx) => (
                        <div
                          key={vid.id || idx}
                          className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-slate-800 dark:text-slate-200 truncate" title={vid.name}>
                              {vid.name}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                              <span className="font-bold text-purple-500">{vid.size}</span>
                              {vid.duration && <span>{vid.duration}</span>}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handlePlayVideo(vid.name)}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-amber-500 hover:text-white text-slate-700 dark:text-slate-300 text-[11px] font-bold transition cursor-pointer shrink-0 flex items-center gap-1"
                          >
                            <Play className="w-3 h-3" />
                            <span>试播对比</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================= 工作台 Tab 2: 元数据与封面缺失 ================= */}
        {activeSubTab === "metadata" && (
          <div className="p-5 space-y-4 anim-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">分类筛选:</span>
                <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs">
                  <button
                    type="button"
                    onClick={() => setMetaFilter("all")}
                    className={`px-2.5 py-1 rounded-md font-bold transition cursor-pointer ${
                      metaFilter === "all"
                        ? "bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-2xs"
                        : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    全部缺失 ({filteredMissingItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetaFilter("missingCover")}
                    className={`px-2.5 py-1 rounded-md font-bold transition cursor-pointer ${
                      metaFilter === "missingCover"
                        ? "bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-2xs"
                        : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    缺封面 ({issues?.missingCover?.length || 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetaFilter("missingMeta")}
                    className={`px-2.5 py-1 rounded-md font-bold transition cursor-pointer ${
                      metaFilter === "missingMeta"
                        ? "bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-2xs"
                        : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    缺元数据 ({issues?.missingMeta?.length || 0})
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={runIngest}
                disabled={runningIngest}
                className="h-8 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-xs"
              >
                <Workflow className="w-3.5 h-3.5" />
                <span>{runningIngest ? "正在写入 meta.json..." : "一键自动生成元数据"}</span>
              </button>
            </div>

            {filteredMissingItems.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto opacity-80" />
                <div className="font-semibold text-slate-700 dark:text-slate-200">所有视频资料完备</div>
                <p className="text-[11px] text-slate-400">目前没有缺少封面或番号标题的孤儿影片</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[500px] overflow-y-auto pr-1">
                {filteredMissingItems.map((vid) => (
                  <div
                    key={vid.id}
                    className="p-3 rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-800/30 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-800 dark:text-slate-200 truncate" title={vid.name}>
                        {vid.name}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px]">
                        {!vid.coverUrl && (
                          <span className="px-1.5 py-0.2 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold">
                            缺封面
                          </span>
                        )}
                        {(!vid.code || !vid.title) && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold">
                            缺 meta
                          </span>
                        )}
                        <span className="text-slate-400 font-mono ml-auto">{vid.size}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handlePlayVideo(vid.name)}
                      className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:text-amber-500 text-slate-600 dark:text-slate-300 text-[11px] font-bold transition cursor-pointer shrink-0"
                      title="在内置播放器打开查看"
                    >
                      去播放
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================= 工作台 Tab 3: 自动入库流水线 ================= */}
        {activeSubTab === "pipeline" && (
          <div className="p-5 space-y-5 anim-fade-in">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  本地目录自动规范化入库流水线
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  对视频库全量扫描，识别番号规则、自动补齐 meta.json、核对封面图与刷新片库检索索引。
                </p>
              </div>

              <button
                type="button"
                onClick={runIngest}
                disabled={runningIngest}
                className="h-8 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-xs shadow-cyan-500/20"
              >
                <Workflow className={`w-3.5 h-3.5 ${runningIngest ? "animate-spin" : ""}`} />
                <span>{runningIngest ? "流水线运转中..." : "启动全量入库"}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {(ingestPlan?.steps || []).map((step, idx) => {
                const total = Math.max(1, ingestPlan?.total || 1);
                const pct = Math.min(100, Math.round((step.count / total) * 100));
                return (
                  <div
                    key={step.key}
                    className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex flex-col justify-between space-y-3"
                  >
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-slate-400 font-mono text-[10px]">STEP 0{idx + 1}</span>
                      <span className="font-mono text-cyan-600 dark:text-cyan-400">{step.count}</span>
                    </div>

                    <div>
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                        {step.label}
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full bg-cyan-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>

                    <div className="text-[10px] text-slate-400 flex items-center justify-between">
                      <span>就绪</span>
                      <span>{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-4 rounded-xl bg-cyan-50/50 dark:bg-cyan-950/20 border border-cyan-200/60 dark:border-cyan-900/40 flex items-center justify-between text-xs text-cyan-800 dark:text-cyan-300">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-cyan-500 shrink-0" />
                <span>
                  提示：如需抓取高精封面或生成 30 张切片刻度图，进入主「播放器」点击右侧「修复刮削」即可批量派发后台队列。
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate?.("player")}
                className="font-bold underline text-cyan-600 dark:text-cyan-400 cursor-pointer shrink-0"
              >
                前往播放器
              </button>
            </div>
          </div>
        )}

        {/* ================= 工作台 Tab 4: 磁盘瘦身清理 ================= */}
        {activeSubTab === "cleaner" && (
          <div className="p-5 space-y-4 anim-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>片库与临时缓存清理瘦身</span>
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  扫描因下载中断、历史删除未彻底删除的空目录、无正片残留、下载缓存以及损坏超小文件。
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={scanCleanup}
                  disabled={cleanupScanning || !videoPath}
                  className="h-8 px-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${cleanupScanning ? "animate-spin" : ""}`} />
                  <span>{cleanupScanning ? "扫描中..." : "重新扫描"}</span>
                </button>

                <button
                  type="button"
                  onClick={runCleanup}
                  disabled={cleanupRunning || cleanupSelected.size === 0}
                  className="h-8 px-3.5 rounded-lg bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-xs shadow-rose-500/20"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{cleanupRunning ? "正在清理..." : `删除选中 (${cleanupSelected.size})`}</span>
                </button>
              </div>
            </div>

            {cleanupItems.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 space-y-2">
                {cleanupScanning ? (
                  <div className="space-y-2">
                    <RefreshCw className="w-6 h-6 text-amber-500 animate-spin mx-auto" />
                    <div>正在深度遍历片库目录与临时缓存...</div>
                  </div>
                ) : (
                  <>
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto opacity-80" />
                    <div className="font-semibold text-slate-700 dark:text-slate-200">
                      {cleanupScannedOnce ? "太棒了！未发现任何可清理残留" : "尚未进行磁盘体检扫描"}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {cleanupScannedOnce
                        ? "所有目录均结构完整且无孤儿文件"
                        : "点击上方「重新扫描」即可快速探测可回收空间"}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs">
                  <div className="text-slate-500">
                    扫描到 <strong className="text-slate-800 dark:text-slate-200">{cleanupItems.length}</strong> 处残留 ·{" "}
                    合计 <strong className="text-slate-800 dark:text-slate-200">{cleanupTotalLabel}</strong> ·{" "}
                    已勾选待清理: <strong className="text-rose-500">{formatBytesClient(selectedCleanupBytes)}</strong>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectCleanupDefaults}
                      className="text-xs text-slate-500 hover:text-amber-500 cursor-pointer"
                    >
                      推荐勾选
                    </button>
                    <span className="text-slate-300 dark:text-slate-700">|</span>
                    <button
                      type="button"
                      onClick={selectAllCleanup}
                      className="text-xs text-slate-500 hover:text-amber-500 cursor-pointer"
                    >
                      全选
                    </button>
                    <span className="text-slate-300 dark:text-slate-700">|</span>
                    <button
                      type="button"
                      onClick={clearCleanupSelection}
                      className="text-xs text-slate-500 hover:text-amber-500 cursor-pointer"
                    >
                      清空
                    </button>
                  </div>
                </div>

                <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                  {cleanupItems.map((item) => {
                    const checked = cleanupSelected.has(item.path);
                    const meta = KIND_LABEL[item.kind];
                    return (
                      <label
                        key={item.id}
                        className={`flex items-start gap-3 rounded-xl p-3 cursor-pointer border transition ${
                          checked
                            ? "bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40"
                            : "bg-slate-50 dark:bg-slate-800/40 border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCleanupItem(item.path)}
                          className="mt-1 accent-rose-500 cursor-pointer"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${meta.color}`}>
                              {meta.label}
                            </span>
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                              {item.name}
                            </span>
                            <span className="ml-auto text-[11px] font-mono text-slate-500 dark:text-slate-400 shrink-0 font-semibold">
                              {item.sizeLabel} ({item.fileCount} 文件)
                            </span>
                          </div>
                          <div className="mt-1 text-[10px] text-slate-400 truncate">{item.reason}</div>
                          <div className="mt-0.5 text-[9px] font-mono text-slate-300 dark:text-slate-600 truncate">
                            {item.path}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ===================== 4. 底部联动：系统动态与最近入库速览 ===================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 左侧：待办与事件通知中心 (5 cols) */}
        <div className="lg:col-span-5 rounded-2xl p-5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-500" />
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                运行环境与自检事件
              </h4>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              v{healthData?.appVersion || "1.0.0"}
            </span>
          </div>

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {/* 磁盘与自检项目列表 */}
            {(healthData?.checks || []).map((chk: any, idx: number) => (
              <div
                key={idx}
                className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {chk.status === "ok" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  )}
                  <span className="font-bold text-slate-700 dark:text-slate-200 truncate">
                    {chk.label}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 truncate max-w-[200px]" title={chk.detail}>
                  {chk.detail}
                </span>
              </div>
            ))}

            {/* 告警提醒 */}
            {(overview?.notifications || []).map((n: any, idx: number) => (
              <div
                key={`note-${idx}`}
                className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="font-bold text-amber-900 dark:text-amber-200">{n.title}</span>
                </div>
                <span className="text-[10px] text-amber-700 dark:text-amber-300/80">{n.body}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧：最近入库快速通道 (7 cols) */}
        <div className="lg:col-span-7 rounded-2xl p-5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <PlayCircle className="w-4 h-4 text-amber-500" />
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                最近入库新片（点击直接在内置播放器启播）
              </h4>
            </div>
            <button
              type="button"
              onClick={() => onNavigate?.("player")}
              className="text-[11px] text-amber-500 hover:underline cursor-pointer flex items-center gap-1 font-semibold"
            >
              全部作品 →
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(overview?.recent || []).slice(0, 4).map((vid: VideoItem) => (
              <button
                key={vid.id}
                type="button"
                onClick={() => handlePlayVideo(vid.name)}
                className="group text-left rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 overflow-hidden hover:border-amber-400 hover:shadow-md transition cursor-pointer"
              >
                <div className="aspect-video bg-slate-100 dark:bg-slate-800 relative">
                  {convertVideo(vid).coverUrl ? (
                    <CoverImage src={convertVideo(vid).coverUrl} alt={vid.name} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-400">
                      <Film className="w-5 h-5" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                    <Play className="w-6 h-6 text-white drop-shadow" />
                  </div>
                </div>

                <div className="p-2">
                  <div className="text-[11px] font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-amber-500">
                    {vid.title || vid.name}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[9px] text-slate-400 font-mono">
                    <span className="text-amber-600 dark:text-amber-400 font-bold">{vid.code}</span>
                    <span>{vid.size}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ===================== 5. 弹窗：Emby / Plex 软链接整理 ===================== */}
      {showOrganizerModal && (
        <OrganizerModal
          sourcePath={videoPath}
          onClose={() => setShowOrganizerModal(false)}
          onAddSystemLog={onAddSystemLog}
        />
      )}
    </div>
  );
}
