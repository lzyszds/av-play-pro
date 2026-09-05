import React, { useEffect, useState } from "react";
import { BarChart3, X, Trash2 } from "lucide-react";
import { thumbnailQueue, type ThumbJob } from "../lib/thumbnailQueue";
import { FloatingBall } from "./FloatingBall";
import { Tooltip } from "./common/Tooltip";

export function ThumbnailQueueWidget({
  bottomOffset = 16,
  rightOffset = 16,
}: {
  bottomOffset?: number;
  rightOffset?: number;
}) {
  const [jobs, setJobs] = useState<ThumbJob[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => thumbnailQueue.subscribe(setJobs), []);

  if (jobs.length === 0) return null;
  const running = jobs.filter((j) => j.status === "running");
  const pending = jobs.filter((j) => j.status === "pending");
  const activeCount = running.length + pending.length;

  const overallPct = (() => {
    if (running.length === 0) return pending.length > 0 ? 0 : 100;
    const sum = running.reduce(
      (acc, j) => acc + (j.totalFrames > 0 ? j.doneFrames / j.totalFrames : 0),
      0,
    );
    return Math.floor((sum / running.length) * 100);
  })();

  const popover = (
    <>
      <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
          {running.length} 处理 · {pending.length} 排队 / {jobs.length} 总
        </span>
        <Tooltip content="清理已结束任务" placement="left">
          <button
            onClick={() => thumbnailQueue.clearFinished()}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </Tooltip>
      </div>

      {running.length > 0 && (
        <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="text-slate-500">
              处理中进度（{running.length} 个）
            </span>
            <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
              {overallPct}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-amber-600 transition-[width] duration-300"
              style={{ width: `${overallPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="max-h-72 overflow-y-auto">
        {jobs.map((j) => {
          const pct =
            j.totalFrames > 0
              ? Math.floor((j.doneFrames / j.totalFrames) * 100)
              : 0;
          return (
            <div
              key={j.id}
              className="px-3 py-1.5 border-b border-slate-50 dark:border-slate-800 last:border-b-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] text-slate-700 dark:text-slate-200 font-medium">
                  {j.name}
                </span>
                <StatusBadge status={j.status} />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-[width] duration-300 ${
                      j.status === "failed"
                        ? "bg-rose-500"
                        : j.status === "cancelled"
                          ? "bg-slate-400"
                          : "bg-amber-500"
                    }`}
                    style={{ width: `${j.status === "done" ? 100 : pct}%` }}
                  />
                </div>
                <span className="text-[9px] text-slate-400 font-mono shrink-0 w-12 text-right">
                  {j.totalFrames > 0
                    ? `${j.doneFrames}/${j.totalFrames}`
                    : "—"}
                </span>
                {(j.status === "pending" || j.status === "running") && (
                  <Tooltip content="取消生成" placement="left">
                    <button
                      onClick={() => thumbnailQueue.cancel(j.id)}
                      className="p-0.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Tooltip>
                )}
                {(j.status === "done" ||
                  j.status === "failed" ||
                  j.status === "cancelled") && (
                  <Tooltip content="移除记录" placement="left">
                    <button
                      onClick={() => thumbnailQueue.remove(j.id)}
                      className="p-0.5 text-slate-300 hover:text-slate-600 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </Tooltip>
                )}
              </div>
              {j.error && (
                <div className="text-[9px] text-rose-500 mt-0.5 truncate">
                  {j.error}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <FloatingBall
      tone="amber"
      icon={<BarChart3 className="w-4 h-4" />}
      progress={running.length > 0 ? overallPct : 0}
      badge={activeCount > 0 ? activeCount : null}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      popover={popover}
      popoverTitle={
        <span className="flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5 text-amber-500" />
          刻度图队列
        </span>
      }
      bottomOffset={bottomOffset}
      rightOffset={rightOffset}
      title={`刻度图：${running.length} 处理中，${pending.length} 排队`}
      pulse={running.length > 0}
    />
  );
}

function StatusBadge({ status }: { status: ThumbJob["status"] }) {
  const map: Record<ThumbJob["status"], string> = {
    pending: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    running:
      "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    failed: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
    cancelled: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    skipped: "bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300",
  };
  const label = {
    pending: "等待",
    running: "处理中",
    done: "完成",
    failed: "失败",
    cancelled: "取消",
    skipped: "跳过",
  }[status];
  return (
    <span
      className={`text-[9px] px-1.5 py-0.5 rounded font-bold font-mono shrink-0 ${map[status]}`}
    >
      {label}
    </span>
  );
}
