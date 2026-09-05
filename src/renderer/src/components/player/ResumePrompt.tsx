import React, { useEffect, useRef, useState } from "react";
import { Play, X, History } from "lucide-react";
import { Tooltip } from "../common/Tooltip";

interface ResumePromptProps {
  videoName: string;
  currentTime: number;
  savedAt: number;
  autoCloseMs?: number;
  onResume: () => void;
  onClose: () => void;
}

function formatTime(sec: number): string {
  if (!sec || sec < 0) return "00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
}

export const ResumePrompt: React.FC<ResumePromptProps> = ({
  videoName,
  currentTime,
  savedAt,
  autoCloseMs = 5000,
  onResume,
  onClose,
}) => {
  const [progress, setProgress] = useState(100);
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    const startedAt = startedAtRef.current;
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const remain = Math.max(0, autoCloseMs - elapsed);
      setProgress((remain / autoCloseMs) * 100);
      if (remain <= 0) {
        window.clearInterval(tick);
        onClose();
      }
    }, 80);
    return () => window.clearInterval(tick);
  }, [autoCloseMs, onClose]);

  return (
    <div className="absolute top-4 left-4 z-50 w-80 rounded-xl bg-white dark:bg-slate-900 border border-amber-200/70 dark:border-amber-500/30 shadow-2xl shadow-amber-500/10 overflow-hidden anim-resume-prompt">
      <div className="px-4 pt-3 pb-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="shrink-0 w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
              <History className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-slate-800 dark:text-slate-100">
                继续上次观看
              </div>
              <div className="text-[9px] text-slate-400 dark:text-slate-500">
                {relativeTime(savedAt)} · 已看到 {formatTime(currentTime)}
              </div>
            </div>
          </div>
          <Tooltip content="关闭提示" placement="left">
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>

        <div
          className="text-[11px] text-slate-600 dark:text-slate-300 truncate mb-3"
          title={videoName}
        >
          {videoName}
        </div>

        <button
          type="button"
          onClick={onResume}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white text-xs font-bold rounded-lg shadow-sm shadow-amber-500/20 transition cursor-pointer"
        >
          <Play className="w-3.5 h-3.5 fill-white" />
          从 {formatTime(currentTime)} 继续播放
        </button>
      </div>

      {/* 倒计时进度条 */}
      <div className="h-0.5 bg-amber-100 dark:bg-amber-500/10 relative overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-400 to-amber-500"
          style={{ width: `${progress}%`, transition: "width 80ms linear" }}
        />
      </div>
    </div>
  );
};
