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

/** 日系素雅细长进度条： downloading 玫瑰→粉渐变；完成绿；暂停灰；失败暗红 */
function RowProgress({ progress, status }: { progress: number; status: DownloadTask["status"] }) {
  const bar =
    status === "COMPLETED"
      ? "h-full bg-emerald-500/90 rounded-full"
      : status === "FAILED"
        ? "h-full bg-rose-800/90 rounded-full"
        : status === "PAUSED"
          ? "h-full bg-white/30 rounded-full"
          : "h-full bg-gradient-to-r from-rose-500 to-pink-400 rounded-full transition-all";
  return (
    <div className="w-full h-1.5 bg-white/10 dark:bg-white/10 rounded-full overflow-hidden">
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
      ? "text-rose-400"
      : task.status === "COMPLETED"
        ? "text-emerald-400"
        : task.status === "FAILED"
          ? "text-rose-500/90"
          : "text-white/40 dark:text-white/40";

  return (
    <div
      id={`task-card-${task.id}`}
      role="button"
      aria-label={`选择任务 ${task.name}`}
      onClick={() => onSelectTask(task.id)}
      style={{ ["--i" as string]: Math.min(index, 14) }}
      className={`anime-glass-card anim-fade-stagger group flex items-center gap-4 rounded-2xl p-4 transition-all duration-200 cursor-pointer ${
        isFlashing
          ? "!bg-white/12 !border-accent-500 ring-2 ring-accent-500/50"
          : isSelected
            ? "!bg-white/10 !border-accent-500/50 ring-1 ring-accent-500/30"
            : ""
      } ${task.status === "PAUSED" ? "opacity-60" : ""}`}
    >
      {/* 缩略图 / 番号占位 */}
      <div className="w-20 h-14 rounded-xl bg-slate-900/80 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center relative">
        {hasCover ? (
          <CoverImage src={coverUrl} alt={task.name} logoSize={32} />
        ) : (
          <span className="font-mono-num text-[11px] font-bold text-text-3">
            {code ? code.slice(0, 6) : "AV"}
          </span>
        )}
        {task.resolution && (
          <span className="absolute bottom-1 right-1 text-[9px] font-mono-num px-1 rounded bg-black/60 text-rose-300">
            {task.resolution}
          </span>
        )}
      </div>

      {/* 主信息与进度 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-text-1 truncate" title={task.name}>
              {task.name}
            </span>
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-white/5 dark:bg-white/5 text-text-3 border border-hairline">
              {task.format}
            </span>
            {code && (
              <span className="shrink-0 font-mono-num text-[10px] text-accent-400/80">{code}</span>
            )}
          </div>
          <span className={`shrink-0 font-mono-num text-xs font-semibold ${highlightCls}`}>
            {highlight}
          </span>
          <div
            className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition"
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip content="复制 N_m3u8DL-RE 指令" placement="top">
              <button
                onClick={(e) => onCopyCommand(e, task)}
                className="p-2 hover:bg-white/10 dark:hover:bg-white/10 rounded-xl text-text-2 hover:text-text-1 transition cursor-pointer"
                title="复制指令"
              >
                {copiedTaskId === task.id ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </Tooltip>

            {task.status === "COMPLETED" ? (
              <>
                <Tooltip content="重新下载（覆盖已下载文件）" placement="top">
                  <button
                    onClick={() => onRedownload?.(task.id)}
                    className="p-2 hover:bg-white/10 dark:hover:bg-white/10 rounded-xl text-text-2 hover:text-text-1 transition cursor-pointer"
                    title="重新下载"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </Tooltip>
                <Tooltip content="立即查看" placement="top">
                  <button
                    onClick={() => onPlayCompleted?.(task)}
                    className="p-2 hover:bg-rose-500/20 text-rose-400 rounded-xl transition cursor-pointer"
                    title="立即查看"
                  >
                    <Play className="w-4 h-4 fill-current" />
                  </button>
              </Tooltip>
              </>
            ) : task.status === "FAILED" ? (
              <Tooltip content="重试下载（清零进度后重新入队）" placement="top">
                <button
                  onClick={() => onTriggerPauseResume(task.id)}
                  className="p-2 hover:bg-rose-500/20 text-rose-400 rounded-xl transition cursor-pointer"
                  title="重试下载"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content={task.status === "DOWNLOADING" ? "暂停下载" : "继续下载"} placement="top">
                <button
                  onClick={() => onTriggerPauseResume(task.id)}
                  className="p-2 hover:bg-white/10 dark:hover:bg-white/10 rounded-xl text-text-2 hover:text-text-1 transition cursor-pointer"
                  title={task.status === "DOWNLOADING" ? "暂停" : "继续"}
                >
                  {task.status === "DOWNLOADING" ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4 fill-current" />
                  )}
                </button>
              </Tooltip>
            )}

            <Tooltip content="删除任务" placement="top">
              <button
                onClick={() => onDeleteTask(task.id)}
                className="p-2 hover:bg-rose-500/20 rounded-xl text-white/40 hover:text-rose-400 transition cursor-pointer"
                title="取消"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* 进度条 */}
        <RowProgress progress={task.progress} status={task.status} />

        {/* 底部元数据行 */}
        <div className="flex justify-between items-center text-[11px] font-mono-num text-text-3 mt-1.5">
          <span className="truncate">
            {task.totalSize > 0
              ? `${formatBytes(task.downloadedSize)} / ${formatBytes(task.totalSize)} (${Math.round(task.progress)}%)`
              : task.fileSize > 0
                ? formatBytes(task.fileSize)
                : "大小未知"}
            {task.totalSegments > 0 ? ` · ${task.downloadedSegments}/${task.totalSegments} 分片` : ""}
            {task.encryptionType && task.encryptionType !== "NONE" ? ` · ${task.encryptionType}` : ""}
            {task.taskTag === "SCHEDULED" && task.scheduledAt ? ` · ⏰ ${new Date(task.scheduledAt).toLocaleString()}` : ""}
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
