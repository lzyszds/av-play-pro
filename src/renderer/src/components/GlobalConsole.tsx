import React, { useEffect, useRef, useState } from "react";
import { Terminal, Trash2, GripHorizontal, X } from "lucide-react";
import { Dropdown } from "./Dropdown";
import type { LogMessage } from "../pages/download/types";

type LevelFilter = "ALL" | "INFO" | "SUCCESS" | "WARNING" | "ERROR";

interface GlobalConsoleProps {
  logs: LogMessage[];
  setLogs: React.Dispatch<React.SetStateAction<LogMessage[]>>;
  height: number;
  onHeightChange: (h: number) => void;
  onClose?: () => void;
}

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 700;

function getLogLevelColor(level: string): string {
  switch (level) {
    case "SUCCESS":
      return "text-emerald-600 dark:text-emerald-400";
    case "WARNING":
      return "text-orange-600 dark:text-orange-400 font-medium";
    case "ERROR":
      return "text-red-600 dark:text-red-400 font-medium";
    case "DEBUG":
      return "text-sky-600 dark:text-sky-400";
    default:
      return "text-slate-600 dark:text-slate-300";
  }
}

function getLogLevelBadge(level: string): string {
  switch (level) {
    case "SUCCESS":
      return "bg-emerald-50/70 text-emerald-600 border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400";
    case "WARNING":
      return "bg-orange-50/70 text-orange-600 border-orange-100 dark:bg-orange-500/10 dark:border-orange-500/20 dark:text-orange-400";
    case "ERROR":
      return "bg-red-50/70 text-red-600 border-red-100 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400";
    case "DEBUG":
      return "bg-sky-50/70 text-sky-600 border-sky-100 dark:bg-sky-500/10 dark:border-sky-500/20 dark:text-sky-400";
    default:
      return "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400";
  }
}

function getLogLevelLabel(level: string): string {
  switch (level) {
    case "SUCCESS":
      return "成功";
    case "WARNING":
      return "警告";
    case "ERROR":
      return "错误";
    case "DEBUG":
      return "调试";
    default:
      return "消息";
  }
}

export function GlobalConsole({
  logs,
  setLogs,
  height,
  onHeightChange,
  onClose,
}: GlobalConsoleProps) {
  const [filter, setFilter] = useState<LevelFilter>("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filteredLogs = logs.filter((l) =>
    filter === "ALL" ? true : l.level === filter,
  );

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // 拖拽缩放
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const onMove = (mv: MouseEvent) => {
      const dy = startY - mv.clientY;
      const h = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startH + dy));
      onHeightChange(h);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className="shrink-0 bg-[#fffaf5] dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex flex-col text-slate-600 dark:text-slate-300"
      style={{ height }}
    >
      {/* 拖拽手柄 */}
      <div
        onMouseDown={startDrag}
        title="拖动调整高度"
        className="group h-1.5 -mt-0.5 bg-transparent hover:bg-amber-500/40 cursor-row-resize flex items-center justify-center shrink-0"
      >
        <GripHorizontal className="w-4 h-2 text-transparent group-hover:text-amber-600 transition" />
      </div>

      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 shrink-0">
        <div className="flex items-center gap-2 text-xs font-bold">
          <Terminal className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-slate-700 dark:text-slate-200">控制台日志</span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
            ({filteredLogs.length}
            {filter !== "ALL" && `/${logs.length}`})
          </span>
        </div>

        <div className="flex items-center gap-3 text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400">过滤:</span>
            <Dropdown
              value={filter}
              onChange={(v: any) => setFilter(v)}
              options={[
                { value: "ALL", label: "全部", dot: "bg-slate-400" },
                { value: "INFO", label: "消息", dot: "bg-slate-400" },
                { value: "SUCCESS", label: "成功", dot: "bg-emerald-500" },
                { value: "WARNING", label: "警告", dot: "bg-orange-500" },
                { value: "ERROR", label: "错误", dot: "bg-red-500" },
              ]}
            />
          </div>

          <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-slate-300 text-amber-500"
            />
            自动滚动
          </label>

          <button
            onClick={() => setLogs([])}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition cursor-pointer"
            title="清空日志"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              title="关闭控制台"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 日志列表 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 space-y-1 text-[10.5px] leading-relaxed font-mono select-text"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-slate-400 dark:text-slate-600 text-center py-6">
            暂无日志。执行操作后,日志将在此实时刷新。
          </div>
        ) : (
          filteredLogs.map((log, idx) => (
            <div
              key={log.id + idx}
              className="flex gap-2.5 items-start"
            >
              <span className="text-slate-400 dark:text-slate-600 font-extralight shrink-0">
                [{log.timestamp}]
              </span>
              <span
                className={`text-[10px] border px-1.5 rounded select-none shrink-0 font-semibold ${getLogLevelBadge(log.level)}`}
              >
                {getLogLevelLabel(log.level)}
              </span>
              <span className={`${getLogLevelColor(log.level)} break-all`}>
                {log.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
