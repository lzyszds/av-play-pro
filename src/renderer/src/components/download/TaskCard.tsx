import React, { useRef, useState } from "react";
import { Play, Pause, Trash2, Copy, Check, RotateCcw } from "lucide-react";
import { CoverImage } from "../CoverImage";
import type { DownloadTask } from "../../pages/download/types";
import {
  formatBytes,
  formatSpeed,
  resolveTaskCoverUrl,
} from "../../pages/download/utils";
import { getStatusBadge } from "./StatusBadge";
import { Tooltip } from "../common/Tooltip";

export interface TaskCardProps {
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

function TaskCardImpl({
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
}: TaskCardProps) {
  const coverUrl = resolveTaskCoverUrl(task, {
    allowRemote: allowRemoteCovers,
  });
  useScheduleTick(task.taskTag === "SCHEDULED" && !!task.scheduledAt);

  return (
    <div
      id={`task-card-${task.id}`}
      onClick={() => onSelectTask(task.id)}
      style={{ ["--i" as string]: Math.min(index, 12) }}
      className={`anim-fade-stagger group relative flex flex-col bg-white rounded-xl border overflow-hidden cursor-pointer transition-transform duration-150 hover:-translate-y-0.5 will-change-transform ${
        isFlashing
          ? "border-amber-500 ring-4 ring-amber-400/60 shadow-xl shadow-amber-500/30"
          : isSelected
            ? "border-amber-500 ring-2 ring-amber-500/30 shadow-sm"
            : "border-slate-200 shadow-sm"
      }`}
    >
      {/* Cover / Preview */}
      <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
        <CoverImage src={coverUrl} alt={task.name} logoSize={56} />

        <div className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />
        <div className="absolute top-2 left-2 z-10 flex gap-1">
          {getStatusBadge(task.status)}
          {task.taskTag === "SCHEDULED" && task.scheduledAt && (
            <span
              className="text-[9px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full shadow-sm border border-amber-400/60 backdrop-blur-sm whitespace-nowrap"
              title={`定时下载: ${new Date(task.scheduledAt).toLocaleString()}`}
            >
              ⏰ {formatScheduledAt(task.scheduledAt)}
            </span>
          )}
        </div>

        <div className="absolute top-2 right-2 z-10 flex gap-1">
          <span className="text-[9px] bg-black/60 text-white px-1.5 py-0.5 font-mono rounded backdrop-blur-sm">
            {task.format}
          </span>
          {task.resolution && (
            <span className="text-[9px] bg-black/60 text-amber-300 px-1.5 py-0.5 font-mono rounded backdrop-blur-sm">
              {task.resolution}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {task.status !== "COMPLETED" && (
          <div className="absolute bottom-0 left-0 right-0 z-10">
            {task.status === "DOWNLOADING" && (
              <div className="flex items-center justify-between px-2 pb-1 text-[9px] font-mono text-white drop-shadow-2xl">
                <span className="text-shadow-md text-shadow-red-500">
                  {task.progress.toFixed(1)}%
                </span>
                <span className="text-shadow-md text-shadow-red-500">
                  {formatSpeed(task.speed)}
                </span>
              </div>
            )}
            <div className="w-full bg-black/20 h-1">
              <div
                className="bg-linear-to-r from-cyan-200 to-cyan-500 shadow-xl h-1 transition-all duration-300"
                style={{ width: `${task.progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Info + Actions */}
      <div className="flex flex-col gap-1.5 p-3">
        <div
          className="font-semibold text-[13px] text-slate-800 truncate group-hover:text-amber-700 transition-colors"
          title={task.name}
        >
          {task.name}
        </div>
        {task.taskTag === "SCHEDULED" && task.scheduledAt && (
          <div className="text-[10px] text-amber-700 dark:text-amber-400 font-mono leading-tight truncate">
            ⏰ {formatScheduledAt(task.scheduledAt)} · {new Date(task.scheduledAt).toLocaleString()}
          </div>
        )}

        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-2 text-[10px] text-black font-mono min-w-0">
            <span className="truncate">
              {task.totalSize > 0
                ? `${formatBytes(task.downloadedSize)} / ${formatBytes(task.totalSize)}`
                : task.fileSize > 0
                  ? formatBytes(task.fileSize)
                  : "未知大小"}
            </span>
            {task.encryptionType && task.encryptionType !== "NONE" && (
              <span className="text-slate-500">* {task.encryptionType}</span>
            )}
          </div>

          <div
            className="flex items-center gap-1.5 text-black shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip content="复制 N_m3u8DL-RE 调取指令" placement="top">
              <button
                onClick={(e) => onCopyCommand(e, task)}
                className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 hover:bg-amber-50 hover:text-amber-700 transition cursor-pointer"
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
                    className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 hover:text-amber-700 hover:bg-amber-50 transition cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
                <Tooltip content="立即查看" placement="top">
                  <button
                    onClick={() => onPlayCompleted?.(task)}
                    className="p-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 hover:bg-emerald-100 transition cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </button>
                </Tooltip>
              </>
            ) : task.status === "FAILED" ? (
              <Tooltip content="重试下载（清零进度后重新入队）" placement="top">
                <button
                  onClick={() => onTriggerPauseResume(task.id)}
                  className="p-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 transition cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip
                content={task.status === "DOWNLOADING" ? "暂停下载" : "继续下载"}
                placement="top"
              >
                <button
                  onClick={() => onTriggerPauseResume(task.id)}
                  className={`p-1.5 rounded-lg bg-slate-50 border border-slate-200 transition cursor-pointer ${
                    task.status === "DOWNLOADING"
                      ? "text-amber-600 hover:bg-amber-50"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
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
                className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}

// 只在影响本卡片显示的字段变化时才重渲染。下载进度高频更新时，
// 没在下载的其它卡片完全不会被波及。
export const TaskCard = React.memo(TaskCardImpl, (prev, next) => {
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
