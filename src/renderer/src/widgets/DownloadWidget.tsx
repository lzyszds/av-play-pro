import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, X, ExternalLink, Pause } from "lucide-react";
import { trpc } from "../lib/trpc";

interface Task {
  id: string;
  name: string;
  status: string;
  progress: number;
  speed: number;
}

// 把 N_m3u8DL-RE 的输出行解析成进度信息，只取我们关心的几项
function parseLine(line: string): {
  percent: number | null;
  speed: number | null;
} {
  const pct = line.match(/(\d+\.?\d*)%/);
  const sp = line.match(/([\d.]+)\s*(B|KB|MB|GB|TB)ps/);
  const units: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1048576,
    GB: 1073741824,
    TB: 1099511627776,
  };
  return {
    percent: pct ? parseFloat(pct[1]) : null,
    speed: sp ? parseFloat(sp[1]) * (units[sp[2]] || 1) : null,
  };
}

function formatSpeed(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B/s";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}/s`;
}

export function DownloadWidget() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [expanded, setExpanded] = useState(false);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // 冷启动：拉一次现有任务
  useEffect(() => {
    void trpc.storage.getDownloadState
      .query()
      .then((state: any) => {
        if (Array.isArray(state?.tasks)) {
          setTasks(
            (state.tasks as Task[]).map((t) => ({
              id: t.id,
              name: t.name,
              status: t.status,
              progress: t.progress || 0,
              speed: t.speed || 0,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  // 监听 download-progress 推送，与主窗口同源
  useEffect(() => {
    const unlisten = window.electronAPI?.download?.onProgress?.(
      (_e: any, data: any) => {
        const id = data?.taskId as string | undefined;
        if (!id) return;
        const info = parseLine(data.line || "");

        if (data.done) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    status: data.success ? "COMPLETED" : "FAILED",
                    progress: data.success ? 100 : t.progress,
                    speed: 0,
                  }
                : t,
            ),
          );
          return;
        }

        setTasks((prev) => {
          const exists = prev.some((t) => t.id === id);
          if (!exists) {
            return [
              ...prev,
              {
                id,
                name: id.slice(0, 8),
                status: "DOWNLOADING",
                progress: info.percent ?? 0,
                speed: info.speed ?? 0,
              },
            ];
          }
          return prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: "DOWNLOADING",
                  progress: info.percent ?? t.progress,
                  speed: info.speed ?? t.speed,
                }
              : t,
          );
        });
      },
    );
    return () => unlisten?.();
  }, []);

  const { downloading, pending, completed, overall, topSpeed } = useMemo(() => {
    const dl = tasks.filter((t) => t.status === "DOWNLOADING");
    const pd = tasks.filter((t) => t.status === "PENDING").length;
    const co = tasks.filter((t) => t.status === "COMPLETED").length;
    const sumProg = dl.reduce((s, t) => s + (t.progress || 0), 0);
    const avg = dl.length > 0 ? sumProg / dl.length : 0;
    const sp = dl.reduce((s, t) => s + (t.speed || 0), 0);
    return {
      downloading: dl,
      pending: pd,
      completed: co,
      overall: Math.max(0, Math.min(100, avg)),
      topSpeed: sp,
    };
  }, [tasks]);

  // 同步窗口尺寸
  useEffect(() => {
    void trpc.window.setDownloadWidgetExpanded
      .mutate({ expanded })
      .catch(() => {});
  }, [expanded]);

  const focusMain = () => {
    void trpc.window.focus.mutate().catch(() => {});
  };

  const close = () => {
    void trpc.window.closeDownloadWidget.mutate().catch(() => {});
  };

  // ============ 圆形悬浮球 ============
  // SVG ring: r=42, circumference = 2πr ≈ 263.89
  const R = 42;
  const C = 2 * Math.PI * R;
  const offset = C - (overall / 100) * C;
  const idle = downloading.length === 0;
  const ringColor = idle
    ? "rgba(148, 163, 184, 0.6)"
    : "rgb(245, 158, 11)";

  if (!expanded) {
    return (
      <div
        className="w-screen h-screen flex items-center justify-center select-none"
        style={
          {
            background: "transparent",
            WebkitAppRegion: "drag",
          } as React.CSSProperties
        }
      >
        <div
          onClick={() => setExpanded(true)}
          className="relative w-22 h-22 rounded-full bg-slate-900/85 backdrop-blur-md shadow-xl ring-1 ring-white/10 flex items-center justify-center cursor-pointer hover:scale-105 transition-transform"
          style={
            {
              width: 88,
              height: 88,
              WebkitAppRegion: "no-drag",
            } as React.CSSProperties
          }
          title={
            idle
              ? "暂无下载中任务"
              : `${downloading.length} 个下载中 · ${overall.toFixed(0)}%`
          }
        >
          <svg className="absolute inset-0" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="6"
            />
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={ringColor}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={offset}
              transform="rotate(-90 50 50)"
              style={{ transition: "stroke-dashoffset 0.4s ease" }}
            />
          </svg>
          <div className="relative flex flex-col items-center text-white">
            {idle ? (
              <>
                <Pause className="w-4 h-4 opacity-70" />
                <span className="text-[9px] mt-0.5 opacity-70">空闲</span>
              </>
            ) : (
              <>
                <span className="text-sm font-bold leading-none">
                  {overall.toFixed(0)}
                  <span className="text-[10px] opacity-70">%</span>
                </span>
                <span className="text-[9px] mt-0.5 text-amber-300/90 font-mono">
                  {formatSpeed(topSpeed)}
                </span>
              </>
            )}
          </div>
          {pending > 0 && (
            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center shadow">
              {pending}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ============ 展开态：详情面板 ============
  return (
    <div
      className="w-screen h-screen select-none"
      style={
        { background: "transparent", WebkitAppRegion: "drag" } as React.CSSProperties
      }
    >
      <div
        className="absolute inset-2 rounded-2xl bg-slate-900/92 backdrop-blur-xl shadow-2xl ring-1 ring-white/10 text-white flex flex-col overflow-hidden"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b border-white/10"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <div className="flex items-center gap-1.5 text-[11px] font-bold">
            <Download className="w-3.5 h-3.5 text-amber-400" />
            下载小组件
          </div>
          <div
            className="flex items-center gap-0.5"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <button
              onClick={focusMain}
              className="w-6 h-6 rounded hover:bg-white/10 flex items-center justify-center text-slate-300 hover:text-amber-300 cursor-pointer"
              title="打开主程序"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setExpanded(false)}
              className="w-6 h-6 rounded hover:bg-white/10 flex items-center justify-center text-slate-300 cursor-pointer text-[14px]"
              title="收起为悬浮球"
            >
              −
            </button>
            <button
              onClick={close}
              className="w-6 h-6 rounded hover:bg-rose-500/20 flex items-center justify-center text-slate-300 hover:text-rose-300 cursor-pointer"
              title="关闭小组件"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="px-3 py-2 border-b border-white/5 flex items-center gap-3 text-[11px]">
          <div className="flex-1">
            <div className="flex items-center justify-between text-[10px] mb-0.5">
              <span className="text-amber-300 font-bold">
                {downloading.length} 下载
              </span>
              <span className="text-slate-400">
                排队 {pending} · 完成 {completed}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all"
                style={{ width: `${overall}%` }}
              />
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] text-slate-400">总速</div>
            <div className="text-[11px] font-mono text-amber-300 font-bold">
              {formatSpeed(topSpeed)}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-1.5">
          {downloading.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[11px] text-slate-400">
              当前没有下载任务
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {downloading.slice(0, 6).map((t) => (
                <div
                  key={t.id}
                  className="px-2 py-1 rounded bg-white/5 hover:bg-white/8 transition cursor-default"
                  title={t.name}
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="truncate text-slate-100 font-semibold">
                      {t.name}
                    </span>
                    <span className="ml-2 font-mono text-amber-300 shrink-0">
                      {t.progress.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1 rounded bg-black/30 mt-1 overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-all"
                      style={{ width: `${t.progress}%` }}
                    />
                  </div>
                  <div className="text-[9px] mt-0.5 font-mono text-slate-400">
                    {formatSpeed(t.speed)}
                  </div>
                </div>
              ))}
              {downloading.length > 6 && (
                <div className="text-center text-[10px] text-slate-400 mt-1">
                  其余 {downloading.length - 6} 个未展示
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
