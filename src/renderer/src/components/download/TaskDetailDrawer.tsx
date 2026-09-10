/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from "react";
import {
  X,
  Play,
  Pause,
  Trash2,
  Copy,
  Check,
  ChevronDown,
  Terminal,
  RotateCcw,
  FolderOpen,
  Link as LinkIcon,
  ShieldCheck,
  Clock,
  Zap,
  HardDrive,
  Cpu,
  Layers,
} from "lucide-react";
import { trpc } from "../../lib/trpc";
import { CoverImage } from "../CoverImage";
import type { DownloadTask } from "../../pages/download/types";
import {
  formatBytes,
  formatSpeed,
  extractVideoCode,
  generateN3u8DLCommand,
  resolveTaskCoverUrl,
} from "../../pages/download/utils";
import { getStatusBadge } from "./StatusBadge";
import { Tooltip } from "../common/Tooltip";

export interface TaskDetailDrawerProps {
  task: DownloadTask | null;
  open: boolean;
  onClose: () => void;
  onTriggerPauseResume: (id: string) => void;
  /** 删除时页面需同步关闭与选中态 */
  onDeleteTask: (id: string) => void;
  onPlayCompleted?: (task: DownloadTask) => void;
  onOpenSegments?: (task: DownloadTask) => void;
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
  onClick,
  tooltip,
}: {
  icon: typeof Zap;
  label: string;
  value: React.ReactNode;
  accent?: boolean;
  onClick?: () => void;
  tooltip?: string;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`flex flex-col gap-1 p-2 rounded-xl border min-w-0 transition-all ${
        onClick
          ? "cursor-pointer bg-white/50 dark:bg-white/[0.04] hover:bg-accent-500/10 border-white/70 dark:border-white/[0.08] hover:border-accent-500/40 ring-0 hover:ring-1 hover:ring-accent-500/30 group/stat shadow-xs"
          : "bg-white/30 dark:bg-white/[0.025] border-white/50 dark:border-white/[0.05]"
      }`}
      title={tooltip || (typeof value === "string" ? value : undefined)}
    >
      <div className="flex items-center justify-between gap-1 text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon
            className={`w-3 h-3 shrink-0 ${
              onClick
                ? "text-accent-500 dark:text-accent-400 group-hover/stat:scale-110 transition-transform"
                : "text-slate-400 dark:text-slate-500"
            }`}
          />
          <span className="text-[10px] uppercase tracking-wider font-semibold truncate">
            {label}
          </span>
        </div>
        {onClick && (
          <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500 group-hover/stat:text-accent-400 opacity-70 group-hover/stat:opacity-100 transition shrink-0">
            详情 ↗
          </span>
        )}
      </div>
      <div
        className={`text-xs font-mono font-semibold truncate ${
          accent ? "text-accent-500 dark:text-accent-400" : "text-slate-800 dark:text-slate-200"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

export function TaskDetailDrawer({
  task,
  open,
  onClose,
  onTriggerPauseResume,
  onDeleteTask,
  onPlayCompleted,
  onOpenSegments,
}: TaskDetailDrawerProps) {
  const [terminalExpanded, setTerminalExpanded] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [cachedTask, setCachedTask] = useState<DownloadTask | null>(null);

  useEffect(() => {
    if (task) setCachedTask(task);
  }, [task]);

  useEffect(() => {
    if (open && !task) onClose();
  }, [open, task, onClose]);

  // ESC 键快捷收起
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const display = cachedTask && cachedTask.id === task?.id ? cachedTask : task;

  const copyCommand = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!display) return;
    navigator.clipboard.writeText(generateN3u8DLCommand(display));
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 1800);
  }, [display]);

  const copyPath = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!display?.savePath) return;
    navigator.clipboard.writeText(display.savePath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 1800);
  }, [display?.savePath]);

  const copyUrl = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!display?.url) return;
    navigator.clipboard.writeText(display.url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1800);
  }, [display?.url]);

  const openFolder = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!display?.savePath) return;
    void trpc.system.openPath.mutate({ path: display.savePath });
  }, [display?.savePath]);

  if (!open || !display) return null;

  const coverUrl = resolveTaskCoverUrl(display, { allowRemote: true });
  const videoCode = extractVideoCode(display.name);

  const sizeText =
    display.totalSize > 0
      ? `${formatBytes(display.downloadedSize)} / ${formatBytes(display.totalSize)}`
      : display.fileSize > 0
      ? formatBytes(display.fileSize)
      : "—";

  const segText =
    display.downloadedSegments > 0 && display.totalSegments > 0
      ? `${display.downloadedSegments} / ${display.totalSegments} (${display.progress.toFixed(1)}%)`
      : `${display.progress.toFixed(1)}%`;

  const encText =
    display.encryptionType === "NONE"
      ? "未加密"
      : display.encryptionType || "AES-128";

  // 进度环参数
  const R = 24;
  const C = 2 * Math.PI * R;
  const offset = C - (display.progress / 100) * C;
  const ringColor =
    display.status === "COMPLETED"
      ? "rgb(16, 185, 129)"
      : display.status === "FAILED"
      ? "rgb(244, 63, 94)"
      : "rgb(251, 146, 60)";

  return (
    <div className="shrink-0 w-full border-t border-white/60 dark:border-white/[0.08] bg-white/55 dark:bg-[#090d14]/98 backdrop-blur-2xl transition-all duration-300 shadow-[0_-10px_35px_rgba(0,0,0,0.08)] dark:shadow-[0_-10px_35px_rgba(0,0,0,0.6)] z-20">
      {/* 1. 顶部极简信息导轨 */}
      <div className="h-9 px-4 border-b border-white/50 dark:border-white/[0.04] bg-white/40 dark:bg-white/[0.015] flex items-center justify-between gap-3 text-xs">
        {/* 左侧：标识与任务名 */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-accent-500 dark:text-accent-400 shrink-0">
            DOCK 监控台
          </span>
          <span className="text-slate-300 dark:text-white/20">|</span>
          <div className="shrink-0">{getStatusBadge(display.status)}</div>
          {videoCode && (
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-accent-500/10 dark:bg-accent-500/15 text-accent-600 dark:text-accent-300 border border-accent-500/30 shrink-0">
              {videoCode}
            </span>
          )}
          <span
            className="text-slate-800 dark:text-slate-200 font-medium truncate select-text"
            title={display.name}
          >
            {display.name}
          </span>
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 shrink-0 hidden sm:inline">
            #{display.id.slice(0, 8)}
          </span>
        </div>

        {/* 右侧：状态指示与折叠控制 */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden md:flex items-center gap-2 font-mono text-[11px] text-slate-500 dark:text-slate-400 pl-2">
            <span className="text-accent-600 dark:text-accent-300 font-bold">{display.progress.toFixed(1)}%</span>
            <span className="text-slate-300 dark:text-white/20">·</span>
            <span className={display.speed > 0 ? "text-accent-500 dark:text-accent-400 font-bold" : "text-slate-400 dark:text-slate-400"}>
              {formatSpeed(display.speed)}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setTerminalExpanded((v) => !v)}
            className={`px-2 py-0.5 rounded-lg border text-[11px] font-medium transition flex items-center gap-1 cursor-pointer ${
              terminalExpanded
                ? "bg-white/70 dark:bg-white/[0.12] border-slate-300 dark:border-white/20 text-slate-800 dark:text-white"
                : "bg-white/40 dark:bg-white/[0.03] border-slate-200 dark:border-white/[0.06] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
            title="展开/折叠终端调试视窗"
          >
            <Terminal className="w-3 h-3" />
            <span className="hidden sm:inline">终端视窗</span>
          </button>

          <Tooltip content="收起监控台 (Esc)" placement="left">
            <button
              type="button"
              onClick={onClose}
              className="w-6 h-6 rounded-lg bg-white/45 hover:bg-white/80 dark:bg-white/[0.04] dark:hover:bg-white/[0.1] border border-white/60 dark:border-transparent flex items-center justify-center text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition cursor-pointer"
              aria-label="收起详情台"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* 2. 宽屏横向驾驶舱主体 */}
      <div className="p-3.5 flex flex-col md:flex-row items-stretch gap-4 min-w-0 max-h-[320px] overflow-y-auto">
        {/* 左列：封面与环形进度 */}
        <div className="relative w-full md:w-56 shrink-0 aspect-[16/9] md:aspect-auto md:h-auto rounded-xl overflow-hidden bg-slate-900/80 border border-white/[0.08] group flex flex-col justify-end p-2.5">
          <CoverImage
            src={coverUrl}
            alt={display.name}
            logoSize={40}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 opacity-85"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent pointer-events-none" />

          {/* 格式分辨率标签 */}
          <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
            <span className="text-[9px] bg-black/60 text-white px-1.5 py-0.5 font-mono rounded backdrop-blur-md border border-white/10">
              {display.format}
            </span>
            {display.resolution && (
              <span className="text-[9px] bg-black/60 text-accent-300 px-1.5 py-0.5 font-mono rounded backdrop-blur-md border border-white/10">
                {display.resolution}
              </span>
            )}
          </div>

          {/* 右上角悬浮进度环 */}
          <div className="absolute top-2 right-2 z-10 w-12 h-12 flex items-center justify-center">
            <svg className="absolute inset-0" viewBox="0 0 56 56">
              <circle
                cx="28"
                cy="28"
                r={R}
                fill="rgba(0,0,0,0.55)"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="3.5"
              />
              <circle
                cx="28"
                cy="28"
                r={R}
                fill="none"
                stroke={ringColor}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={offset}
                transform="rotate(-90 28 28)"
                style={{ transition: "stroke-dashoffset 0.4s ease" }}
              />
            </svg>
            <span className="relative text-[10px] font-bold font-mono text-white">
              {display.progress.toFixed(0)}%
            </span>
          </div>

          <div className="relative z-10 text-[11px] text-white font-mono truncate">
            {formatSpeed(display.speed)}
          </div>
        </div>

        {/* 中列：技术性能指标矩阵与路径 */}
        <div className="flex-1 flex flex-col justify-between gap-2.5 min-w-0">
          {/* 指标矩阵晶格 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <StatTile icon={ShieldCheck} label="加密协议" value={<span className="text-accent-600 dark:text-accent-300 font-bold">{encText}</span>} />
            <StatTile icon={HardDrive} label="体积大小" value={sizeText} />
            <StatTile
              icon={Layers}
              label="分片进度"
              value={<span className="text-accent-600 dark:text-accent-400 font-bold">{segText}</span>}
              accent={display.downloadedSegments > 0}
              onClick={() => onOpenSegments?.(display)}
              tooltip="点击查看分片拓扑分布、缓存路径与抓取日志"
            />
            <StatTile icon={Cpu} label="并发线程" value={<span className="text-accent-600 dark:text-accent-300 font-bold">{display.threads ?? 16} <span className="text-xs text-slate-400 dark:text-slate-400 font-normal">线程</span></span>} />
            <StatTile icon={Zap} label="实时速率" value={formatSpeed(display.speed)} accent={display.speed > 0} />
            <StatTile icon={Zap} label="实时速率" value={formatSpeed(display.speed)} accent={display.speed > 0} />
            <StatTile
              icon={Clock}
              label="创建时间"
              value={
                display.creationTime
                  ? new Date(display.creationTime).toLocaleString().slice(5, 16)
                  : "—"
              }
            />
          </div>

          {/* 路径与源地址条 */}
          <div className="space-y-1.5 pt-1">
            {/* DIR 保存路径 */}
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-white/35 dark:bg-white/[0.02] border border-white/60 dark:border-white/[0.04] text-[11px]">
              <span className="text-[9px] uppercase tracking-wider text-accent-500 dark:text-accent-400 font-mono font-bold shrink-0">
                DIR
              </span>
              <span
                className="font-mono text-slate-600 dark:text-slate-300 truncate select-all flex-1"
                title={display.savePath}
              >
                {display.savePath}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={openFolder}
                  className="px-2 py-0.5 rounded-lg bg-white/50 hover:bg-accent-500/15 dark:bg-white/[0.05] dark:hover:bg-accent-500/20 border border-white/60 dark:border-transparent text-slate-600 hover:text-accent-600 dark:text-slate-300 dark:hover:text-accent-200 transition flex items-center gap-1 cursor-pointer text-[10px]"
                  title="在系统访达中定位文件夹"
                >
                  <FolderOpen className="w-3 h-3" />
                  <span>定位目录</span>
                </button>
                <button
                  type="button"
                  onClick={copyPath}
                  className="p-1 rounded-lg bg-white/50 hover:bg-accent-500/15 dark:bg-white/[0.04] dark:hover:bg-accent-500/20 border border-white/60 dark:border-transparent text-slate-500 hover:text-accent-600 dark:text-slate-400 dark:hover:text-accent-200 transition cursor-pointer"
                  title="复制保存路径"
                >
                  {copiedPath ? (
                    <Check className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>

            {/* HLS 原流地址 */}
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-white/35 dark:bg-white/[0.02] border border-white/60 dark:border-white/[0.04] text-[11px]">
              <span className="text-[9px] uppercase tracking-wider text-accent-500 dark:text-accent-400 font-mono font-bold shrink-0">
                HLS
              </span>
              <span
                className="font-mono text-slate-500 dark:text-slate-400 truncate select-all flex-1"
                title={display.url}
              >
                {display.url}
              </span>
              <button
                type="button"
                onClick={copyUrl}
                className="p-1 rounded-lg bg-white/50 hover:bg-accent-500/15 dark:bg-white/[0.04] dark:hover:bg-accent-500/20 border border-white/60 dark:border-transparent text-slate-500 hover:text-accent-600 dark:text-slate-400 dark:hover:text-accent-200 transition shrink-0 cursor-pointer"
                title="复制播放源直链"
              >
                {copiedUrl ? (
                  <Check className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 右列：终端预览（展开时）与控制按钮组 */}
        <div className="w-full md:w-80 shrink-0 flex flex-col justify-between gap-2.5 border-t md:border-t-0 md:border-l border-white/60 dark:border-white/[0.06] pt-2 md:pt-0 md:pl-4">
          {/* 终端命令预览小窗 */}
          <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-[#0c1017] flex flex-col flex-1 min-h-[90px]">
            <div className="h-6 px-2.5 bg-black/40 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#ff5f56]" />
                <span className="w-2 h-2 rounded-full bg-[#ffbd2e]" />
                <span className="w-2 h-2 rounded-full bg-[#27c93f]" />
                <span className="text-[9px] font-mono text-slate-500 pl-1">TERMINAL COMMAND</span>
              </div>
              <button
                type="button"
                onClick={copyCommand}
                className="text-[10px] text-slate-400 hover:text-accent-300 flex items-center gap-1 transition cursor-pointer"
              >
                {copiedCmd ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>{copiedCmd ? "已复制" : "复制"}</span>
              </button>
            </div>
            <div
              className={`p-2 font-mono text-[10px] leading-relaxed text-slate-300 break-all select-all overflow-y-auto ${
                terminalExpanded ? "max-h-48" : "max-h-[64px]"
              }`}
            >
              <span className="text-accent-400 font-bold mr-1">$</span>
              {generateN3u8DLCommand(display)}
            </div>
          </div>

          {/* 底部动作胶囊组（纯色、无渐变） */}
          <div className="flex items-center justify-end gap-2 pt-1">
            {display.status === "COMPLETED" ? (
              <button
                type="button"
                onClick={() => onPlayCompleted?.(display)}
                className="flex-1 py-1.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>立即播放</span>
              </button>
            ) : display.status === "FAILED" ? (
              <button
                type="button"
                onClick={() => onTriggerPauseResume(display.id)}
                className="flex-1 py-1.5 px-3 rounded-xl bg-accent-500 hover:bg-accent-600 active:bg-accent-700 text-white text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>重试下载</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onTriggerPauseResume(display.id)}
                className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm ${
                  display.status === "DOWNLOADING"
                    ? "bg-accent-500 hover:bg-accent-600 text-white"
                    : "bg-white/60 hover:bg-white/90 text-slate-800 border border-white/70 dark:bg-white/[0.08] dark:hover:bg-white/[0.14] dark:text-white dark:border-transparent"
                }`}
              >
                {display.status === "DOWNLOADING" ? (
                  <>
                    <Pause className="w-3.5 h-3.5 text-white" />
                    <span>暂停任务</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current text-white" />
                    <span>{display.status === "PAUSED" ? "继续下载" : "开始任务"}</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => onDeleteTask(display.id)}
              className="py-1.5 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 dark:bg-rose-500/15 dark:hover:bg-rose-500/25 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs font-semibold transition flex items-center gap-1 cursor-pointer"
              title="删除任务与记录"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>删除</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
