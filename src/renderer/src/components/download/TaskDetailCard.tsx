import React, { useEffect, useState } from "react";
import {
  X,
  Play,
  Pause,
  Trash2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Terminal,
  RotateCcw,
} from "lucide-react";
import { CoverImage } from "../CoverImage";
import type { DownloadTask } from "../../pages/download/types";
import {
  formatBytes,
  formatSpeed,
  generateN3u8DLCommand,
  getCoverUrlFromName,
  toProxiedAssetUrl,
} from "../../pages/download/utils";
import { getStatusBadge } from "./StatusBadge";

interface Props {
  task: DownloadTask;
  index?: number;
  onClose: () => void;
  onTriggerPauseResume: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onPlayCompleted?: (task: DownloadTask) => void;
}

function Field({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[9px] uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500 font-semibold">
        {label}
      </span>
      <span
        className={`text-[12px] text-slate-800 dark:text-slate-100 truncate ${
          mono ? "font-mono" : ""
        } font-semibold`}
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

export function TaskDetailCard({
  task,
  onClose,
  onTriggerPauseResume,
  onDeleteTask,
  onPlayCompleted,
}: Props) {
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const coverUrl =
    toProxiedAssetUrl(task.coverUrl) || getCoverUrlFromName(task.name);

  const sizeText =
    task.totalSize > 0
      ? `${formatBytes(task.downloadedSize)} / ${formatBytes(task.totalSize)}`
      : task.fileSize > 0
        ? formatBytes(task.fileSize)
        : "—";
  const segText =
    task.downloadedSegments > 0 && task.totalSegments > 0
      ? `${task.downloadedSegments} / ${task.totalSegments}`
      : `${task.progress.toFixed(1)}%`;
  const encText =
    task.encryptionType === "NONE"
      ? "未加密"
      : task.encryptionType || "AES-128";

  // 进度环：r=28, c=2π·28 ≈ 175.93
  const R = 28;
  const C = 2 * Math.PI * R;
  const offset = C - (task.progress / 100) * C;

  const copyCommand = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(generateN3u8DLCommand(task));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 anim-fade-in"
      onClick={onClose}
    >
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" />

      <div
        id={`task-card-${task.id}`}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-white/98 dark:bg-slate-900/96 backdrop-blur-xl border border-amber-300/70 dark:border-amber-500/40 shadow-2xl shadow-amber-500/20 ring-2 ring-amber-400/40 overflow-hidden anim-scale-in"
      >
      {/* 顶部封面带 */}
      <div className="relative h-40 w-full overflow-hidden bg-slate-900 shrink-0">
        <CoverImage
          src={coverUrl}
          alt={task.name}
          logoSize={64}
          className="opacity-90"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/40 to-slate-900/95" />

        {/* 顶部条：状态 + 关闭 */}
        <div className="absolute top-2 left-2 right-2 z-10 flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {getStatusBadge(task.status)}
            <span className="text-[9px] bg-black/55 text-white px-1.5 py-0.5 font-mono rounded backdrop-blur-sm">
              {task.format}
            </span>
            {task.resolution && (
              <span className="text-[9px] bg-black/55 text-amber-300 px-1.5 py-0.5 font-mono rounded backdrop-blur-sm">
                {task.resolution}
              </span>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="w-7 h-7 rounded-full bg-black/55 backdrop-blur-sm hover:bg-rose-500/80 flex items-center justify-center text-white/90 transition cursor-pointer"
            title="关闭详情"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 进度环挂在封面底部偏右 */}
        <div className="absolute bottom-2 right-3 z-10 w-16 h-16 flex items-center justify-center">
          <svg className="absolute inset-0" viewBox="0 0 64 64">
            <circle
              cx="32"
              cy="32"
              r={R}
              fill="rgba(0,0,0,0.45)"
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="4"
            />
            <circle
              cx="32"
              cy="32"
              r={R}
              fill="none"
              stroke="rgb(245, 158, 11)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={offset}
              transform="rotate(-90 32 32)"
              style={{ transition: "stroke-dashoffset 0.4s ease" }}
            />
          </svg>
          <div className="relative text-[11px] font-bold font-mono text-white drop-shadow">
            {task.progress.toFixed(0)}%
          </div>
        </div>

        {/* 标题落在封面底部 */}
        <div className="absolute bottom-2 left-3 right-20 z-10">
          <div className="text-[13px] font-bold text-white truncate drop-shadow select-text" title={task.name}>
            {task.name}
          </div>
          <div className="text-[10px] text-white/70 font-mono mt-0.5">
            #{task.id.slice(0, 8)} · {formatSpeed(task.speed)}
          </div>
        </div>
      </div>

      {/* 护照信息区 */}
      <div className="flex-1 flex flex-col gap-3 p-3 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-3 gap-2 px-3 py-2 rounded-lg bg-slate-50/80 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
          <Field label="加密" value={encText} mono={false} />
          <Field label="大小" value={sizeText} />
          <Field label="片段" value={segText} />
          <Field label="线程" value={String(task.threads ?? 16)} />
          <Field label="速度" value={formatSpeed(task.speed)} />
          <Field
            label="创建"
            value={
              task.creationTime
                ? new Date(task.creationTime).toLocaleString().slice(5, 16)
                : "—"
            }
            mono={false}
          />
        </div>

        {/* 链接 / 路径 */}
        <div className="space-y-1.5">
          <div className="flex items-start gap-2 text-[11px]">
            <span className="shrink-0 text-[9px] uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500 mt-0.5 w-8 font-semibold">
              HLS
            </span>
            <span className="font-mono text-slate-700 dark:text-slate-300 break-all select-all leading-snug">
              {task.url}
            </span>
          </div>
          <div className="flex items-start gap-2 text-[11px]">
            <span className="shrink-0 text-[9px] uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500 mt-0.5 w-8 font-semibold">
              DIR
            </span>
            <span className="font-mono text-slate-700 dark:text-slate-300 break-all select-all leading-snug">
              {task.savePath}
            </span>
          </div>
        </div>

        {/* 折叠的终端命令 */}
        <div className="mt-auto">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setTerminalOpen((v) => !v);
            }}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-100/80 hover:bg-slate-200/70 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-200 transition cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" />
              终端命令
            </span>
            {terminalOpen ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          {terminalOpen && (
            <div className="mt-2 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-[#0d1117] anim-fade-in">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/70 bg-[#161b22]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#ff5f56]" />
                  <span className="w-2 h-2 rounded-full bg-[#ffbd2e]" />
                  <span className="w-2 h-2 rounded-full bg-[#27c93f]" />
                  <span className="ml-2 text-[10px] font-mono text-slate-400">
                    N_m3u8DL-RE
                  </span>
                </div>
                <button
                  onClick={copyCommand}
                  className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-300 hover:text-white hover:bg-white/10 rounded transition cursor-pointer"
                  title="复制终端命令"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      已复制
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      复制
                    </>
                  )}
                </button>
              </div>
              <div className="max-h-32 overflow-y-auto px-3 py-2 text-[11px] font-mono text-slate-200 leading-relaxed select-all break-all">
                <span className="text-emerald-400">$</span>{" "}
                {generateN3u8DLCommand(task)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center justify-end gap-1.5 px-3 py-2 border-t border-slate-200/70 dark:border-slate-800/70 bg-white/60 dark:bg-slate-900/60">
        <button
          onClick={copyCommand}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 transition cursor-pointer"
          title="复制命令"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-500" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          复制命令
        </button>

        {task.status === "COMPLETED" ? (
          <button
            onClick={() => onPlayCompleted?.(task)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold transition cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            立即查看
          </button>
        ) : task.status === "FAILED" ? (
          <button
            onClick={() => onTriggerPauseResume(task.id)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-[11px] font-bold transition cursor-pointer"
            title="重置进度并重新加入下载队列"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            重试下载
          </button>
        ) : (
          <button
            onClick={() => onTriggerPauseResume(task.id)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
              task.status === "DOWNLOADING"
                ? "bg-amber-500 hover:bg-amber-600 text-white"
                : "bg-slate-800 hover:bg-slate-700 text-white dark:bg-slate-700 dark:hover:bg-slate-600"
            }`}
          >
            {task.status === "DOWNLOADING" ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                暂停
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                {task.status === "PAUSED" ? "继续" : "开始"}
              </>
            )}
          </button>
        )}

        <button
          onClick={() => onDeleteTask(task.id)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 dark:text-rose-300 text-[11px] font-semibold transition cursor-pointer"
          title="删除任务"
        >
          <Trash2 className="w-3.5 h-3.5" />
          删除
        </button>
      </div>
      </div>
    </div>
  );
}
