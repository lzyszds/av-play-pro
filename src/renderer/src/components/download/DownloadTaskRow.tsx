import React from "react";
import { Play, Pause, Trash2, Copy, Check, RotateCcw } from "lucide-react";
import { CoverImage } from "../CoverImage";
import type { DownloadTask } from "../../pages/download/types";
import {
  formatBytes,
  formatSpeed,
  extractVideoCode,
  resolveTaskCoverUrl,
} from "../../pages/download/utils";
import { getStatusBadge } from "./StatusBadge";
import { Tooltip } from "../common/Tooltip";

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

/** 行内状态色映射的 3px 进度条（玫瑰渐变 / 完成绿 / 暂停灰 / 失败暗红） */
function RowProgress({ progress, status }: { progress: number; status: DownloadTask["status"] }) {
  const barBg =
    status === "COMPLETED"
      ? "bg-emerald-500"
      : status === "FAILED"
        ? "bg-rose-800"
        : status === "PAUSED"
          ? "bg-slate-400/70"
          : "bg-linear-to-r from-accent-400 to-accent-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]";
  const trackBg = status === "COMPLETED" ? "bg-emerald-500/15" : "bg-slate-950/15 dark:bg-white/10";
  return (
    <div className={`w-full h-[3px] ${trackBg} overflow-hidden rounded-full`}>
      <div
        className={`h-full ${barBg} transition-all duration-300`}
        style={{ width: `${Math.max(progress, status === "PENDING" || status === "PARSING" ? 4 : progress)}%` }}
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
}: DownloadTaskRowProps) {
  const coverUrl = resolveTaskCoverUrl(task, { allowRemote: allowRemoteCovers });
  useScheduleTick(task.taskTag === "SCHEDULED" && !!task.scheduledAt);
  const code = extractVideoCode(task.name);

  return (
    <div
      id={`task-card-${task.id}`}
      role="button"
      aria-label={`选择任务 ${task.name}`}
      onClick={() => onSelectTask(task.id)}
      style={{ ["--i" as string]: Math.min(index, 14) }}
      className={`anim-fade-stagger group relative flex items-center gap-3.5 h-24 px-4 rounded-xl border bg-surface-1 overflow-hidden cursor-pointer transition-all duration-150 hover:-translate-y-px hover:shadow-lg will-change-transform ${
        isFlashing
          ? "border-accent-500 ring-4 ring-accent-400/60 shadow-xl shadow-accent-500/30"
          : isSelected
            ? "border-accent-500/70 ring-2 ring-accent-500/25 shadow-sm"
            : "border-hairline shadow-sm"
      } ${task.status === "FAILED" ? "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:bg-rose-500" : ""} ${
        task.status === "PAUSED" ? "opacity-60 saturate-50" : ""
      }`}
    >
      {/* 封面缩略 */}
      <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-slate-900 shrink-0">
        <CoverImage src={coverUrl} alt={task.name} logoSize={32} />
      </div>

      {/* 中段：名称 / 番号 / 元信息 / 进度 */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="font-semibold text-[13px] text-text-1 truncate group-hover:text-accent-600 transition-colors"
            title={task.name}
          >
            {task.name}
          </span>
          {code && (
            <span className="shrink-0 text-[10px] font-mono font-bold text-accent-500/90">{code}</span>
          )}
          <span className="ml-auto shrink-0 flex items-center gap-1">
            <span className="text-[9px] bg-slate-950/60 dark:bg-black/60 text-white px-1.5 py-0.5 font-mono rounded">
              {task.format}
            </span>
            {task.resolution && (
              <span className="text-[9px] bg-slate-950/60 dark:bg-black/60 text-accent-300 px-1.5 py-0.5 font-mono rounded">
                {task.resolution}
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2.5 text-[10px] font-mono text-text-2 min-w-0">
          {getStatusBadge(task.status)}
          <span className="truncate">
            {task.status === "DOWNLOADING" && task.speed > 0
              ? formatSpeed(task.speed)
              : task.totalSize > 0
                ? `${formatBytes(task.downloadedSize)} / ${formatBytes(task.totalSize)}`
                : task.fileSize > 0
                  ? formatBytes(task.fileSize)
                  : "未知大小"}
          </span>
          {task.totalSegments > 0 && (
            <span className="truncate">
              分片 {task.downloadedSegments}/{task.totalSegments}
            </span>
          )}
          {task.encryptionType && task.encryptionType !== "NONE" && (
            <span className="text-text-3">*{task.encryptionType}</span>
          )}
          {task.taskTag === "SCHEDULED" && task.scheduledAt && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-bold text-accent-600 dark:text-accent-400 whitespace-nowrap"
              title={`定时下载: ${new Date(task.scheduledAt).toLocaleString()}`}
            >
              ⏰ {formatScheduledAt(task.scheduledAt)}
            </span>
          )}
        </div>

        <RowProgress progress={task.progress} status={task.status} />
      </div>

      {/* 操作组 */}
      <div
        className="flex items-center gap-1.5 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Tooltip content="复制 N_m3u8DL-RE 调用指令" placement="top">
          <button
            onClick={(e) => onCopyCommand(e, task)}
            className="p-2 rounded-lg bg-surface-2 border-hairline hover:bg-accent-500/10 hover:text-accent-500 transition cursor-pointer"
          >
            {copiedTaskId === task.id ? (
              <Check className="w-3.5 h-3.5 text-emerald-500" />
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
                className="p-2 rounded-lg bg-surface-2 border-hairline text-text-3 hover:text-accent-500 hover:bg-accent-500/10 transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            <Tooltip content="立即查看" placement="top">
              <button
                onClick={() => onPlayCompleted?.(task)}
                className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
              </button>
            </Tooltip>
          </>
        ) : task.status === "FAILED" ? (
          <Tooltip content="重试下载（清零进度后重新入队）" placement="top">
            <button
              onClick={() => onTriggerPauseResume(task.id)}
              className="p-2 rounded-lg bg-rose-50 border border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/30 text-rose-600 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-500/20 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        ) : (
          <Tooltip content={task.status === "DOWNLOADING" ? "暂停下载" : "继续下载"} placement="top">
            <button
              onClick={() => onTriggerPauseResume(task.id)}
              className={`p-2 rounded-lg bg-surface-2 border-hairline transition cursor-pointer ${
                task.status === "DOWNLOADING"
                  ? "text-accent-500 hover:bg-accent-500/10"
                  : "text-text-3 hover:text-text-1 hover:bg-accent-500/5"
              }`}
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
            className="p-2 rounded-lg bg-surface-2 border-hairline hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
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
