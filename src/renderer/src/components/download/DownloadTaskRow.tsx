import React from "react";
import { Play, Pause, Trash2, Copy, Check, RotateCcw, FolderOpen } from "lucide-react";
import { CoverImage } from "../CoverImage";
import type { DownloadTask } from "../../pages/download/types";
import {
  formatBytes,
  formatSpeed,
  extractVideoCode,
  resolveTaskCoverUrl,
} from "../../pages/download/utils";
import { Tooltip } from "../common/Tooltip";
import { trpc } from "../../lib/trpc";

export interface DownloadTaskRowProps {
  task: DownloadTask;
  isSelected: boolean;
  isFlashing?: boolean;
  copiedTaskId: string | null;
  index: number;
  /** 是否允许加载远程/CDN 封面；下载页隐藏时应为 false */
  allowRemoteCovers?: boolean;
  onSelectTask: (id: string) => void;
  onTriggerPauseResume: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onCopyCommand: (e: React.MouseEvent, task: DownloadTask) => void;
  onPlayCompleted?: (task: DownloadTask) => void;
  onRedownload?: (id: string) => void;
  onOpenSegments?: (task: DownloadTask) => void;
}

function formatScheduledAt(iso: string): string {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diff = target - now;
  if (diff <= 0) return "即将开始";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} 分钟后`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时后`;
  const days = Math.floor(hours / 24);
  return `${days} 天后`;
}

function useScheduleTick(enabled: boolean) {
  // 每 60 秒触发一次轻量重渲染，以便定时任务的"X 分钟后"相对时间保持新鲜
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 60_000);
    return () => window.clearInterval(t);
  }, [enabled]);
}

/** 饱满明亮的细进度条：完成绿；失败红；暂停灰；下载中发光玫瑰红 */
function RowProgress({ progress, status }: { progress: number; status: DownloadTask["status"] }) {
  const bar =
    status === "COMPLETED"
      ? "h-full bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.7)]"
      : status === "FAILED"
        ? "h-full bg-rose-500 rounded-full shadow-[0_0_8px_rgba(244,63,94,0.6)]"
        : status === "PAUSED"
          ? "h-full bg-slate-500 rounded-full"
          : "h-full bg-accent-500 rounded-full transition-all shadow-[0_0_10px_rgba(244,63,94,0.7)]";
  return (
    <div className="w-full h-2 bg-white/[0.12] border border-white/[0.06] rounded-full overflow-hidden shadow-inner">
      <div
        className={bar}
        style={{ width: `${Math.min(Math.max(progress, status === "PENDING" || status === "PARSING" ? 3 : 0), 100)}%` }}
      />
    </div>
  );
}

function DownloadTaskRowImpl({
  task,
  isSelected,
  isFlashing,
  copiedTaskId,
  index,
  allowRemoteCovers = true,
  onSelectTask,
  onTriggerPauseResume,
  onDeleteTask,
  onCopyCommand,
  onPlayCompleted,
  onRedownload,
  onOpenSegments,
}: DownloadTaskRowProps) {
  const coverUrl = resolveTaskCoverUrl(task, {
    allowRemote: allowRemoteCovers,
  });
  useScheduleTick(task.taskTag === "SCHEDULED" && !!task.scheduledAt);
  const code = extractVideoCode(task.name);

  // 左侧缩略：有封面用封面，无封面显示番号字母占位
  const hasCover = Boolean(coverUrl);

  // 主信息行右侧关键值：下载中给速率，已完成给绿勾语义
  const highlight =
    task.status === "DOWNLOADING"
      ? `${formatSpeed(task.speed)}`
      : task.status === "COMPLETED"
        ? "已完成"
        : task.status === "FAILED"
          ? "下载失败"
          : task.taskTag === "SCHEDULED" && task.scheduledAt
            ? `⏰ ${formatScheduledAt(task.scheduledAt)}`
            : task.status === "PARSING"
              ? "解析分片中"
              : "排队中";

  const highlightCls =
    task.status === "DOWNLOADING"
      ? "text-rose-300 font-bold"
      : task.status === "COMPLETED"
        ? "text-emerald-300 font-bold"
        : task.status === "FAILED"
          ? "text-rose-400 font-bold"
          : task.status === "PARSING"
            ? "text-sky-300 font-semibold"
            : "text-amber-300/90 font-medium";

  return (
    <div
      id={`task-card-${task.id}`}
      role="button"
      aria-label={`选择任务 ${task.name}`}
      onClick={() => onSelectTask(task.id)}
      style={{ ["--i" as string]: Math.min(index, 14) }}
      className={`anim-fade-stagger group flex items-center gap-3.5 rounded-xl p-3.5 transition-all duration-150 cursor-pointer border ${
        isFlashing
          ? "bg-[#1c2438] border-accent-500 ring-2 ring-accent-500/60 shadow-[0_4px_25px_rgba(244,63,94,0.35)]"
          : isSelected
            ? "bg-[#182135] border-accent-500/80 ring-1 ring-accent-500/40 shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
            : "bg-[#0f1523]/85 hover:bg-[#151c2d] border-white/[0.12] hover:border-white/[0.22] shadow-[0_4px_16px_rgba(0,0,0,0.35)]"
      } ${task.status === "PAUSED" ? "opacity-75" : ""}`}
    >
      {/* 缩略图 / 番号占位 */}
      <div className="w-20 h-13 rounded-lg bg-black/80 border border-white/[0.14] overflow-hidden shrink-0 flex items-center justify-center relative shadow-sm">
        {hasCover ? (
          <CoverImage src={coverUrl} alt={task.name} logoSize={32} />
        ) : (
          <span className="font-mono-num text-[11px] font-bold text-slate-400">
            {code ? code.slice(0, 6) : "AV"}
          </span>
        )}
        {task.resolution && (
          <span className="absolute bottom-1 right-1 text-[9px] font-mono-num px-1 rounded bg-black/80 text-rose-300 border border-white/10">
            {task.resolution}
          </span>
        )}
      </div>

      {/* 主信息与进度 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-semibold text-slate-100 group-hover:text-white truncate tracking-wide" title={task.name}>
              {task.name}
            </span>
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-white/[0.08] text-slate-300 border border-white/[0.12] font-mono font-medium">
              {task.format}
            </span>
            {code && (
              <span className="shrink-0 font-mono-num text-[10px] px-1.5 py-0.5 rounded bg-accent-500/20 text-accent-300 border border-accent-500/35 font-bold">{code}</span>
            )}
          </div>
          <span className={`shrink-0 font-mono-num text-xs font-semibold ${highlightCls}`}>
            {highlight}
          </span>
          <div
            className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition"
            onClick={(e) => e.stopPropagation()}
          >
            {task.savePath && (
              <Tooltip content="打开所在目录" placement="top">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void trpc.system.openPath.mutate({ path: task.savePath });
                  }}
                  className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.14] border border-white/[0.06] hover:border-white/20 text-slate-300 hover:text-white transition cursor-pointer"
                  title="打开目录"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            )}

            <Tooltip content="复制 N_m3u8DL-RE 指令" placement="top">
              <button
                onClick={(e) => onCopyCommand(e, task)}
                className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.14] border border-white/[0.06] hover:border-white/20 text-slate-300 hover:text-white transition cursor-pointer"
                title="复制指令"
              >
                {copiedTaskId === task.id ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </Tooltip>

            {task.status === "COMPLETED" ? (
              <>
                <Tooltip content="重新下载（覆盖已下载文件）" placement="top">
                  <button
                    onClick={() => onRedownload?.(task.id)}
                    className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.14] border border-white/[0.06] hover:border-white/20 text-slate-300 hover:text-white transition cursor-pointer"
                    title="重新下载"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
                <Tooltip content="立即查看" placement="top">
                  <button
                    onClick={() => onPlayCompleted?.(task)}
                    className="p-1.5 rounded-lg bg-accent-500/25 hover:bg-accent-500/40 border border-accent-500/40 text-accent-300 hover:text-white transition cursor-pointer"
                    title="立即查看"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </button>
                </Tooltip>
              </>
            ) : task.status === "FAILED" ? (
              <Tooltip content="重试下载（清零进度后重新入队）" placement="top">
                <button
                  onClick={() => onTriggerPauseResume(task.id)}
                  className="p-1.5 rounded-lg bg-rose-500/25 hover:bg-rose-500/40 border border-rose-500/40 text-rose-300 hover:text-white transition cursor-pointer"
                  title="重试下载"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content={task.status === "DOWNLOADING" ? "暂停下载" : "继续下载"} placement="top">
                <button
                  onClick={() => onTriggerPauseResume(task.id)}
                  className={`p-1.5 rounded-lg border transition cursor-pointer ${
                    task.status === "DOWNLOADING"
                      ? "bg-accent-500/25 hover:bg-accent-500/40 border-accent-500/40 text-accent-300 hover:text-white"
                      : "bg-white/[0.06] hover:bg-white/[0.16] border-white/10 hover:border-white/25 text-slate-200 hover:text-white"
                  }`}
                  title={task.status === "DOWNLOADING" ? "暂停" : "继续"}
                >
                  {task.status === "DOWNLOADING" ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  )}
                </button>
              </Tooltip>
            )}

            <Tooltip content="删除任务" placement="top">
              <button
                onClick={() => onDeleteTask(task.id)}
                className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/25 hover:border-rose-500/45 text-rose-300 hover:text-rose-200 transition cursor-pointer"
                title="删除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* 进度条 */}
        <RowProgress progress={task.progress} status={task.status} />

        {/* 底部元数据行 */}
        <div className="flex justify-between items-center text-xs font-mono-num text-slate-300 mt-2">
          <span className="truncate flex items-center flex-wrap gap-x-2 gap-y-1">
            <span className="font-semibold text-slate-200">
              {task.totalSize > 0
                ? `${formatBytes(task.downloadedSize)} / ${formatBytes(task.totalSize)} (${Math.round(task.progress)}%)`
                : task.fileSize > 0
                  ? formatBytes(task.fileSize)
                  : "大小未知"}
            </span>

            {task.totalSegments > 0 ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSegments?.(task);
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.08] hover:bg-accent-500/20 hover:border-accent-500/50 border border-white/[0.14] text-slate-200 hover:text-white transition-all cursor-pointer group/seg shadow-xs"
                title="点击查看分片拓扑分布与抓取日志"
              >
                <span className="text-[11px] text-accent-400 group-hover/seg:scale-110 transition-transform">⚡</span>
                <span className="font-medium">{task.downloadedSegments}/{task.totalSegments} 分片</span>
                <span className="text-[10px] text-slate-400 group-hover/seg:text-accent-300">↗</span>
              </button>
            ) : null}

            {task.encryptionType && task.encryptionType !== "NONE" ? (
              <span className="text-slate-400 font-mono">· {task.encryptionType}</span>
            ) : null}

            {task.taskTag === "SCHEDULED" && task.scheduledAt ? (
              <span className="text-amber-300/90 font-mono">· ⏰ {new Date(task.scheduledAt).toLocaleString()}</span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}

// 只在影响本行显示的字段变化时才重渲染。下载进度高频更新时，
// 没在下载的其它行完全不会被波及（350ms 批量合并已在页面层节流）。
export const DownloadTaskRow = React.memo(DownloadTaskRowImpl, (prev, next) => {
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isFlashing !== next.isFlashing) return false;
  if (prev.copiedTaskId !== next.copiedTaskId && (prev.copiedTaskId === prev.task.id || next.copiedTaskId === next.task.id)) return false;
  if (prev.index !== next.index) return false;
  if (prev.onSelectTask !== next.onSelectTask) return false;
  if (prev.onTriggerPauseResume !== next.onTriggerPauseResume) return false;
  if (prev.onDeleteTask !== next.onDeleteTask) return false;
  if (prev.onCopyCommand !== next.onCopyCommand) return false;
  if (prev.onPlayCompleted !== next.onPlayCompleted) return false;
  if (prev.onRedownload !== next.onRedownload) return false;
  if (prev.onOpenSegments !== next.onOpenSegments) return false;
  if (prev.allowRemoteCovers !== next.allowRemoteCovers) return false;
  const a = prev.task;
  const b = next.task;
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.status === b.status &&
    a.progress === b.progress &&
    a.speed === b.speed &&
    a.totalSize === b.totalSize &&
    a.downloadedSize === b.downloadedSize &&
    a.downloadedSegments === b.downloadedSegments &&
    a.totalSegments === b.totalSegments &&
    a.coverUrl === b.coverUrl &&
    a.previewUrl === b.previewUrl &&
    a.taskTag === b.taskTag &&
    a.scheduledAt === b.scheduledAt
  );
});
