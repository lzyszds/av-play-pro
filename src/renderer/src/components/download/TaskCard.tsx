import React, { useRef, useState } from "react";
import { Play, Pause, Trash2, Copy, Check, Film } from "lucide-react";
import type { DownloadTask } from "../../pages/download/types";
import {
  formatBytes,
  formatSpeed,
  getCoverUrlFromName,
  toProxiedAssetUrl,
} from "../../pages/download/utils";
import { getStatusBadge } from "./StatusBadge";

export interface TaskCardProps {
  task: DownloadTask;
  isSelected: boolean;
  copiedTaskId: string | null;
  index: number;
  onSelectTask: (id: string) => void;
  onTriggerPauseResume: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onCopyCommand: (e: React.MouseEvent, task: DownloadTask) => void;
  onPlayCompleted?: (task: DownloadTask) => void;
}

export function TaskCard({
  task,
  isSelected,
  copiedTaskId,
  index,
  onSelectTask,
  onTriggerPauseResume,
  onDeleteTask,
  onCopyCommand,
  onPlayCompleted,
}: TaskCardProps) {
  const coverUrl =
    toProxiedAssetUrl(task.coverUrl) || getCoverUrlFromName(task.name);

  return (
    <div
      onClick={() => onSelectTask(task.id)}
      style={{ ["--i" as string]: Math.min(index, 12) }}
      className={`anim-fade-stagger group relative flex flex-col bg-white rounded-xl border overflow-hidden cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${
        isSelected
          ? "border-amber-500 ring-2 ring-amber-500/30"
          : "border-slate-200 shadow-sm"
      }`}
    >
      {/* Cover / Preview */}
      <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={task.name}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={(e) => {
              // 加载失败时隐藏图片，显示占位符
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
            <Film className="w-10 h-10 text-slate-600" />
          </div>
        )}

        <div className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />
        <div className="absolute top-2 left-2 z-10">
          {getStatusBadge(task.status)}
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
            <button
              onClick={(e) => onCopyCommand(e, task)}
              className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 hover:bg-amber-50 hover:text-amber-700 transition cursor-pointer"
              title="复制 N_m3u8DL-RE 调取指令"
            >
              {copiedTaskId === task.id ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>

            {task.status === "COMPLETED" ? (
              <button
                onClick={() => onPlayCompleted?.(task)}
                className="p-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 hover:bg-emerald-100 transition cursor-pointer"
                title="立即查看"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                onClick={() => onTriggerPauseResume(task.id)}
                className={`p-1.5 rounded-lg bg-slate-50 border border-slate-200 transition cursor-pointer ${
                  task.status === "DOWNLOADING"
                    ? "text-amber-600 hover:bg-amber-50"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                }`}
                title={task.status === "DOWNLOADING" ? "暂停下载" : "继续下载"}
                disabled={task.status === "FAILED"}
              >
                {task.status === "DOWNLOADING" ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-current" />
                )}
              </button>
            )}

            <button
              onClick={() => onDeleteTask(task.id)}
              className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
              title="删除任务"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
