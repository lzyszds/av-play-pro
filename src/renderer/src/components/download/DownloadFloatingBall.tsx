import React, { useState } from "react";
import { Download } from "lucide-react";
import { FloatingBall } from "../FloatingBall";
import type { DownloadTask } from "../../pages/download/types";
import { formatBytes, formatSpeed } from "../../pages/download/utils";

interface Props {
  tasks: DownloadTask[];
  onJumpToTask: (id: string) => void;
  bottomOffset?: number;
  rightOffset?: number;
}

export function DownloadFloatingBall({
  tasks,
  onJumpToTask,
  bottomOffset = 16,
  rightOffset = 16,
}: Props) {
  const [open, setOpen] = useState(false);

  const downloading = tasks.filter((t) => t.status === "DOWNLOADING");
  const pending = tasks.filter((t) => t.status === "PENDING");

  if (downloading.length === 0 && pending.length === 0) return null;

  const overallPct = (() => {
    if (downloading.length === 0) return 0;
    const sum = downloading.reduce(
      (acc, t) => acc + Math.max(0, Math.min(100, t.progress || 0)),
      0,
    );
    return Math.floor(sum / downloading.length);
  })();

  const totalSpeed = downloading.reduce((acc, t) => acc + (t.speed || 0), 0);

  const popover = (
    <>
      <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
        <span>
          {downloading.length} 下载中 · {pending.length} 排队
        </span>
        {totalSpeed > 0 && (
          <span className="font-bold text-amber-600 dark:text-amber-400">
            {formatSpeed(totalSpeed)}
          </span>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto">
        {downloading.length === 0 && (
          <div className="px-3 py-4 text-center text-slate-400 text-[11px]">
            暂无下载中的任务
          </div>
        )}
        {downloading.map((t) => {
          const pct = Math.max(0, Math.min(100, t.progress || 0));
          const segText =
            t.downloadedSegments > 0 && t.totalSegments > 0
              ? `${t.downloadedSegments}/${t.totalSegments}`
              : "—";
          const sizeText =
            t.totalSize > 0
              ? `${formatBytes(t.downloadedSize)} / ${formatBytes(t.totalSize)}`
              : "—";
          return (
            <button
              key={t.id}
              onClick={() => {
                onJumpToTask(t.id);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 border-b border-slate-50 dark:border-slate-800 last:border-b-0 hover:bg-amber-50/60 dark:hover:bg-amber-500/10 transition cursor-pointer"
              title="点击跳转到此任务卡片"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-bold text-slate-800 dark:text-slate-100">
                  {t.name}
                </span>
                <span className="font-mono text-[10px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
                  {pct.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-amber-600 transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] font-mono text-slate-500 dark:text-slate-400">
                <span>{formatSpeed(t.speed)}</span>
                <span>片段 {segText}</span>
                <span>{sizeText}</span>
              </div>
            </button>
          );
        })}

        {pending.length > 0 && (
          <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800">
            排队中（{pending.length}）
          </div>
        )}
        {pending.slice(0, 8).map((t) => (
          <button
            key={t.id}
            onClick={() => {
              onJumpToTask(t.id);
              setOpen(false);
            }}
            className="w-full text-left px-3 py-1.5 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-amber-50/60 dark:hover:bg-amber-500/10 transition cursor-pointer truncate"
            title="点击跳转"
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 mr-2 align-middle" />
            {t.name}
          </button>
        ))}
        {pending.length > 8 && (
          <div className="px-3 py-1 text-[9px] text-slate-400 text-center">
            还有 {pending.length - 8} 个排队…
          </div>
        )}
      </div>
    </>
  );

  return (
    <FloatingBall
      tone="sky"
      icon={<Download className="w-4 h-4" />}
      progress={downloading.length > 0 ? overallPct : 0}
      badge={
        downloading.length + pending.length > 0
          ? downloading.length + pending.length
          : null
      }
      open={open}
      onToggle={() => setOpen((v) => !v)}
      popover={popover}
      popoverTitle={
        <span className="flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5 text-sky-500" />
          下载队列
        </span>
      }
      bottomOffset={bottomOffset}
      rightOffset={rightOffset}
      title={`下载：${downloading.length} 进行中，${pending.length} 排队`}
      pulse={downloading.length > 0}
    />
  );
}
