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
    <div>
      <div className="px-4 py-3 border-b border-slate-100/70 dark:border-slate-800/70 flex items-center justify-between text-[11px]">
        <span className="font-bold text-slate-600 dark:text-slate-300">
          {downloading.length} 下载中 · {pending.length} 排队
        </span>
        {totalSpeed > 0 && (
          <span className="font-mono text-sky-500 font-bold tabular-nums">
            {formatSpeed(totalSpeed)}
          </span>
        )}
      </div>

      <div className="max-h-72 overflow-y-auto">
        {downloading.length === 0 && (
          <div className="px-4 py-5 text-center text-slate-400 text-[11px]">
            暂无下载中的任务
          </div>
        )}
        {downloading.map((t) => {
          const pct = Math.max(0, Math.min(100, t.progress || 0));
          return (
            <button
              key={t.id}
              onClick={() => {
                onJumpToTask(t.id);
                setOpen(false);
              }}
              className="w-full text-left px-4 py-3 border-b border-slate-100/60 dark:border-slate-800/60 last:border-b-0 hover:bg-sky-50/60 dark:hover:bg-sky-500/10 transition cursor-pointer"
              title="点击跳转到此任务卡片"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                  {t.name}
                </span>
                <span className="font-mono text-[11px] font-bold text-sky-600 dark:text-sky-400 shrink-0 tabular-nums">
                  {pct.toFixed(0)}%
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-slate-200/80 dark:bg-slate-700/60 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-400 via-sky-500 to-indigo-500 transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center gap-x-3 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                <span>{formatSpeed(t.speed)}</span>
                {t.totalSize > 0 && (
                  <span>
                    {formatBytes(t.downloadedSize)} /{" "}
                    {formatBytes(t.totalSize)}
                  </span>
                )}
                {t.downloadedSegments > 0 && t.totalSegments > 0 && (
                  <span>
                    {t.downloadedSegments}/{t.totalSegments} 段
                  </span>
                )}
              </div>
            </button>
          );
        })}

        {pending.length > 0 && (
          <>
            <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              排队中（{pending.length}）
            </div>
            {pending.slice(0, 8).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  onJumpToTask(t.id);
                  setOpen(false);
                }}
                className="w-full text-left px-4 py-1.5 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition cursor-pointer truncate"
                title="点击跳转"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 mr-2 align-middle" />
                {t.name}
              </button>
            ))}
            {pending.length > 8 && (
              <div className="px-4 py-1 text-[10px] text-slate-400 text-center">
                还有 {pending.length - 8} 个排队…
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <FloatingBall
      tone="sky"
      icon={<Download className="w-5 h-5" />}
      progress={downloading.length > 0 ? overallPct : 0}
      badge={downloading.length + pending.length}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      popover={popover}
      popoverWidthClass="w-[22rem]"
      popoverTitle={
        <span className="flex items-center gap-2">
          <Download className="w-4 h-4 text-sky-500" />
          <span>下载队列</span>
          {overallPct > 0 && (
            <span className="ml-auto text-[11px] font-mono text-slate-500 dark:text-slate-400">
              总进度 {overallPct}%
            </span>
          )}
        </span>
      }
      bottomOffset={bottomOffset}
      rightOffset={rightOffset}
      title={`下载：${downloading.length} 进行中，${pending.length} 排队`}
      pulse={downloading.length > 0}
    />
  );
}
