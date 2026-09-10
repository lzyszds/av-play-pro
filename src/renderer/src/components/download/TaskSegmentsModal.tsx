/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, useEffect, useMemo, useState, type ErrorInfo } from "react";
import {
  X,
  Layers,
  HardDrive,
  Cpu,
  FolderOpen,
  Copy,
  Check,
  Terminal,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { trpc } from "../../lib/trpc";
import type { DownloadTask } from "../../pages/download/types";
import {
  formatBytes,
  formatSpeed,
  extractVideoCode,
} from "../../pages/download/utils";
import { getStatusBadge } from "./StatusBadge";

interface TaskSegmentsModalProps {
  task: DownloadTask | null;
  open: boolean;
  onClose: () => void;
}

/**
 * 局部错误边界：即使弹窗内部计算或日志解析发生意外，也绝对不让整屏崩溃白屏
 */
class ModalErrorBoundary extends Component<
  { children: React.ReactNode; onClose: () => void },
  { hasError: boolean; errorText: string }
> {
  constructor(props: { children: React.ReactNode; onClose: () => void }) {
    super(props);
    this.state = { hasError: false, errorText: "" };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorText: error?.message || "组件渲染异常" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[TaskSegmentsModal] 渲染捕获异常:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          onClick={this.props.onClose}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-full max-w-md rounded-2xl bg-[#0c1017] border border-rose-500/30 p-6 text-slate-100 shadow-2xl space-y-4 text-center"
          >
            <div className="w-12 h-12 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mx-auto text-rose-400">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-white">分片详情加载遇到问题</h3>
            <p className="text-xs text-slate-400 font-mono break-all">
              {this.state.errorText}
            </p>
            <button
              type="button"
              onClick={this.props.onClose}
              className="px-4 py-2 rounded-xl bg-white/[0.1] hover:bg-white/[0.2] text-xs font-semibold text-white transition cursor-pointer"
            >
              关闭视窗
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function TaskSegmentsModalContent({
  task,
  onClose,
}: {
  task: DownloadTask;
  onClose: () => void;
}) {
  const [copiedPath, setCopiedPath] = useState(false);
  const [hoveredBlockIndex, setHoveredBlockIndex] = useState<number | null>(null);

  // 安全数值保护
  const totalSegs =
    typeof task.totalSegments === "number" && Number.isFinite(task.totalSegments) && task.totalSegments > 0
      ? Math.round(task.totalSegments)
      : 0;

  const downSegs =
    typeof task.downloadedSegments === "number" && Number.isFinite(task.downloadedSegments) && task.downloadedSegments > 0
      ? Math.round(task.downloadedSegments)
      : 0;

  const remainingSegs = Math.max(0, totalSegs - downSegs);

  // 严格安全的百分比计算（防止 NaN / undefined 导致 toFixed 抛错）
  const rawPercent =
    totalSegs > 0
      ? (downSegs / totalSegs) * 100
      : typeof task.progress === "number" && Number.isFinite(task.progress)
      ? task.progress
      : 0;

  const percent = Math.min(100, Math.max(0, rawPercent));

  // 安全估算单片体积
  const downloadedBytes =
    typeof task.downloadedSize === "number" && Number.isFinite(task.downloadedSize) && task.downloadedSize > 0
      ? task.downloadedSize
      : 0;

  const totalBytes =
    typeof task.totalSize === "number" && Number.isFinite(task.totalSize) && task.totalSize > 0
      ? task.totalSize
      : typeof task.fileSize === "number" && Number.isFinite(task.fileSize) && task.fileSize > 0
      ? task.fileSize
      : 0;

  const avgSegSize =
    downSegs > 0 && downloadedBytes > 0
      ? downloadedBytes / downSegs
      : totalSegs > 0 && totalBytes > 0
      ? totalBytes / totalSegs
      : 0;

  const formatSafeBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "—";
    try {
      return formatBytes(bytes);
    } catch {
      return `${Math.round(bytes / 1024)} KB`;
    }
  };

  const safeSpeedText =
    typeof task.speed === "number" && Number.isFinite(task.speed) && task.speed > 0
      ? formatSpeed(task.speed)
      : task.status === "DOWNLOADING"
      ? "正在拉取切片…"
      : "—";

  // 80 个分片块的视觉分布（4 行 × 20 列）
  const TOTAL_BLOCKS = 80;
  const completedBlocks = Math.min(
    TOTAL_BLOCKS,
    Math.round((percent / 100) * TOTAL_BLOCKS),
  );

  const safeName = task.name || "未命名切片任务";
  const videoCode = extractVideoCode(safeName);

  // 极度安全的日志提取（彻底防止 line 不是 string 时 line.includes 报 TypeError）
  const segmentLogs = useMemo(() => {
    if (!task.logs || !Array.isArray(task.logs) || task.logs.length === 0) return [];
    const valid: string[] = [];
    for (const item of task.logs) {
      let str = "";
      if (typeof item === "string") {
        str = item;
      } else if (item && typeof item === "object") {
        if ("text" in item && typeof (item as { text: unknown }).text === "string") {
          str = (item as { text: string }).text;
        } else if ("message" in item && typeof (item as { message: unknown }).message === "string") {
          str = (item as { message: string }).message;
        } else {
          str = JSON.stringify(item);
        }
      } else if (item != null) {
        str = String(item);
      }

      if (!str) continue;
      const lower = str.toLowerCase();
      if (
        str.includes("/") ||
        lower.includes("segment") ||
        lower.includes("part") ||
        lower.includes("download") ||
        str.includes("%")
      ) {
        valid.push(str);
      }
    }
    return valid.slice(-15);
  }, [task.logs]);

  const openFolder = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!task.savePath) return;
    void trpc.system.openPath.mutate({ path: task.savePath });
  };

  const copyPath = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!task.savePath) return;
    navigator.clipboard.writeText(task.savePath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 1800);
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 anim-fade-in"
      onClick={onClose}
    >
      {/* 柔和暗色遮罩 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />

      {/* 模态卡片 */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-2xl rounded-2xl bg-[#0c1017] border border-white/[0.1] shadow-2xl shadow-black/80 overflow-hidden flex flex-col text-slate-100 max-h-[90vh]"
      >
        {/* 1. 顶栏 */}
        <div className="h-12 px-5 border-b border-white/[0.06] bg-white/[0.02] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-accent-500/15 text-accent-400 flex items-center justify-center shrink-0 border border-accent-500/25">
              <Layers className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-white truncate flex items-center gap-2">
              分片下载详情与切片拓扑
            </h3>
            {videoCode && (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-accent-500/15 text-accent-300 border border-accent-500/25 shrink-0">
                {videoCode}
              </span>
            )}
            <div className="shrink-0">{getStatusBadge(task.status)}</div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] flex items-center justify-center text-slate-400 hover:text-white transition cursor-pointer"
            aria-label="关闭分片详情"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 2. 主体内容 */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* 任务目标切片源 */}
          <div className="px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <span className="text-[10px] text-slate-500 font-mono block mb-0.5">
              TARGET STREAM / 目标切片源
            </span>
            <div className="text-xs text-slate-200 font-medium truncate select-text">
              {safeName}
            </div>
          </div>

          {/* 4 维核心分片指标 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {/* 分片总数 */}
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-semibold mb-1">
                <Layers className="w-3.5 h-3.5 text-accent-400" />
                <span>分片总进度</span>
              </div>
              <div className="text-base font-mono font-bold text-white">
                {downSegs}
                <span className="text-xs text-slate-500 font-normal">
                  {" "}
                  / {totalSegs > 0 ? totalSegs : "—"}
                </span>
              </div>
              <div className="text-[10px] text-accent-400 font-mono mt-0.5">
                {percent.toFixed(1)}% 已落盘
              </div>
            </div>

            {/* 剩余待下 */}
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-semibold mb-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>剩余分片</span>
              </div>
              <div className="text-base font-mono font-bold text-white">
                {totalSegs > 0 ? remainingSegs : "—"}
                <span className="text-xs text-slate-500 font-normal"> 片</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                {safeSpeedText}
              </div>
            </div>

            {/* 分片均重 */}
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-semibold mb-1">
                <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                <span>单片平均体积</span>
              </div>
              <div className="text-base font-mono font-bold text-white">
                {formatSafeBytes(avgSegSize)}
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                预估总计 {totalBytes > 0 ? formatSafeBytes(totalBytes) : "计算中"}
              </div>
            </div>

            {/* 并发与加密 */}
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-semibold mb-1">
                <Cpu className="w-3.5 h-3.5 text-sky-400" />
                <span>线程与加密</span>
              </div>
              <div className="text-base font-mono font-bold text-white">
                {task.threads ?? 16} <span className="text-xs text-slate-500 font-normal">线程</span>
              </div>
              <div className="text-[10px] text-sky-400 font-mono mt-0.5 truncate">
                {task.encryptionType === "NONE" ? "无加密直传" : task.encryptionType || "AES-128"}
              </div>
            </div>
          </div>

          {/* 分片块状全景分布图 (Segment Chunk Grid) */}
          <div className="p-4 rounded-xl bg-black/40 border border-white/[0.06] space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-300">分片缓冲区拓扑分布</span>
                <span className="text-[10px] font-mono text-slate-500">
                  (按进度映射 {TOTAL_BLOCKS} 区块)
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400">
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-[2px] bg-emerald-500" />
                  <span>已完成</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-[2px] bg-accent-500 animate-pulse" />
                  <span>正在下载</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-[2px] bg-white/10" />
                  <span>未下载</span>
                </div>
              </div>
            </div>

            {/* 80 晶格色块图（采用严谨的 inline grid 模板，杜绝 Tailwind 缺失 grid-cols-20 样式问题） */}
            <div
              className="p-2.5 rounded-lg bg-white/[0.015] border border-white/[0.04]"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(20, minmax(0, 1fr))",
                gap: "3px",
              }}
            >
              {Array.from({ length: TOTAL_BLOCKS }).map((_, i) => {
                const isDone = i < completedBlocks;
                const isCurrent = i === completedBlocks && task.status === "DOWNLOADING";

                return (
                  <div
                    key={i}
                    onMouseEnter={() => setHoveredBlockIndex(i)}
                    onMouseLeave={() => setHoveredBlockIndex(null)}
                    style={{ minHeight: "14px" }}
                    className={`rounded-[2px] transition-colors cursor-pointer ${
                      isDone
                        ? "bg-emerald-500/80 hover:bg-emerald-400"
                        : isCurrent
                        ? "bg-accent-500 hover:bg-accent-400 animate-pulse"
                        : "bg-white/[0.07] hover:bg-white/[0.15]"
                    }`}
                  />
                );
              })}
            </div>

            {/* 悬停探针提示 */}
            <div className="h-5 flex items-center justify-between text-[11px] font-mono text-slate-400 px-1">
              {hoveredBlockIndex !== null && totalSegs > 0 ? (
                <>
                  <span className="text-slate-200">
                    区块 #{hoveredBlockIndex + 1}: 估算对应分片 ~#
                    {Math.round((hoveredBlockIndex / TOTAL_BLOCKS) * totalSegs)} 至 #
                    {Math.round(((hoveredBlockIndex + 1) / TOTAL_BLOCKS) * totalSegs)}
                  </span>
                  <span
                    className={
                      hoveredBlockIndex < completedBlocks ? "text-emerald-400" : "text-slate-500"
                    }
                  >
                    {hoveredBlockIndex < completedBlocks ? "✔ 数据已完整校验落盘" : "待抓取"}
                  </span>
                </>
              ) : (
                <span className="text-slate-500 text-[10px]">
                  将光标悬停在上方分片色块，可查看对应片段的落盘区间
                </span>
              )}
            </div>
          </div>

          {/* 存储目录与快速定位 */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] text-xs">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] text-slate-500 font-mono block mb-0.5">
                SEGMENTS LOCAL CACHE / 分片文件本地落盘路径
              </span>
              <div
                className="font-mono text-slate-300 truncate select-all"
                title={task.savePath || "未指定路径"}
              >
                {task.savePath || "未指定本地保存路径"}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={openFolder}
                className="px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 transition flex items-center gap-1.5 cursor-pointer text-xs font-medium"
                title="在系统访达中定位分片文件夹"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>打开目录</span>
              </button>
              <button
                type="button"
                onClick={copyPath}
                className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-slate-200 transition cursor-pointer"
                title="复制路径"
              >
                {copiedPath ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* 实时分片抓取日志流 */}
          {segmentLogs.length > 0 && (
            <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-black/50">
              <div className="h-6 px-3 bg-white/[0.02] border-b border-white/[0.04] flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <span className="flex items-center gap-1.5">
                  <Terminal className="w-3 h-3 text-emerald-400" />
                  <span>SEGMENT LOG STREAM / 最新切片抓取日志</span>
                </span>
                <span>{segmentLogs.length} 条</span>
              </div>
              <div className="p-2.5 font-mono text-[10px] leading-relaxed text-slate-400 max-h-32 overflow-y-auto space-y-0.5 select-all">
                {segmentLogs.map((log, idx) => (
                  <div key={idx} className="truncate">
                    <span className="text-slate-600 mr-2">›</span>
                    <span className={log.includes("%") ? "text-accent-300" : ""}>{log}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 3. 底栏 */}
        <div className="h-12 px-5 border-t border-white/[0.06] bg-white/[0.015] flex items-center justify-between text-xs shrink-0">
          <div className="text-[11px] text-slate-500 font-mono">
            {task.status === "COMPLETED" ? "所有分片已完全合并入库" : "后台线程自动分批拉取校验中"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-semibold text-white transition cursor-pointer"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

export function TaskSegmentsModal({
  task,
  open,
  onClose,
}: TaskSegmentsModalProps) {
  // ESC 键关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !task) return null;

  return (
    <ModalErrorBoundary onClose={onClose}>
      <TaskSegmentsModalContent task={task} onClose={onClose} />
    </ModalErrorBoundary>
  );
}
