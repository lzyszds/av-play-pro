import React, { useState } from "react";
import { Wrench, X, RefreshCw, Image, Film, Captions, BarChart3 } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { thumbnailQueue } from "../../lib/thumbnailQueue";
import type { VideoItem } from "../../pages/player/types";

export interface RepairTarget {
  name: string;
  folderPath: string;
  videoFilePath?: string | null;
}

interface RepairModalProps {
  mode: "single" | "all";
  targets: RepairTarget[];
  onClose: () => void;
  onLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
  onDone?: () => void;
}

type WhisperModel = "tiny" | "base" | "small" | "medium" | "large-v3";
const WHISPER_MODELS: WhisperModel[] = ["tiny", "base", "small", "medium", "large-v3"];

function extractCode(name: string): string | null {
  const m = name.match(/[A-Z]{2,6}-\d{3,5}/i);
  return m ? m[0].toUpperCase() : null;
}

export function RepairModal({
  mode,
  targets,
  onClose,
  onLog,
  onDone,
}: RepairModalProps) {
  const [fixCover, setFixCover] = useState(true);
  const [fixPreview, setFixPreview] = useState(true);
  const [fixSubtitle, setFixSubtitle] = useState(false);
  const [fixThumbs, setFixThumbs] = useState(false);
  const [forceThumbs, setForceThumbs] = useState(false);
  const [customCoverUrl, setCustomCoverUrl] = useState("");
  const [customPreviewUrl, setCustomPreviewUrl] = useState("");
  const [whisperModel, setWhisperModel] = useState<WhisperModel>("base");
  const [whisperLang, setWhisperLang] = useState("auto");
  const [running, setRunning] = useState(false);
  const [progressText, setProgressText] = useState("");

  const isSingle = mode === "single";
  const total = targets.length;
  const title = isSingle
    ? `修复视频：${targets[0]?.name || "—"}`
    : `批量修复（共 ${total} 个视频）`;

  const handleRun = async () => {
    if (!fixCover && !fixPreview && !fixSubtitle && !fixThumbs) {
      onLog("请至少选择一项要修复的内容", "WARNING");
      return;
    }
    if (!isSingle && (customCoverUrl.trim() || customPreviewUrl.trim())) {
      const ok = window.confirm(
        "你为「全部修复」填写了自定义 URL，这会让所有视频都使用同一个地址。确定继续吗？",
      );
      if (!ok) return;
    }
    setRunning(true);
    let done = 0;
    let fail = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        setProgressText(`[${i + 1}/${targets.length}] ${t.name}`);
        const code = extractCode(t.name) || t.name.split(" ")[0];

        // 封面 / 预览：后端已按文件存在与否自动跳过，自定义 URL 视为强制重下
        if (fixCover || fixPreview) {
          try {
            const r: any = await trpc.download.downloadCoverPreview.mutate({
              id: code,
              name: t.name,
              saveDir: t.folderPath,
              skipCover: !fixCover,
              skipPreview: !fixPreview,
              customCoverUrl: customCoverUrl.trim() || undefined,
              customPreviewUrl: customPreviewUrl.trim() || undefined,
            });
            if (r && r.skipped) {
              onLog(`封面/预览文件均已存在，跳过: ${t.name}`, "INFO");
            } else {
              onLog(`封面/预览已处理: ${t.name}`, "SUCCESS");
            }
          } catch (err: any) {
            fail++;
            onLog(`封面/预览失败: ${t.name} - ${err?.message || err}`, "ERROR");
          }
        }

        // 刻度图（雪碧图 + VTT）→ 入后台队列（关闭弹窗也会继续）
        // 已有刻度图的默认跳过；勾选"强制重新生成"才会重做
        if (fixThumbs) {
          const enqueuedId = thumbnailQueue.enqueue({
            name: t.name,
            folderPath: t.folderPath,
            force: forceThumbs,
          });
          // enqueue 内部会检测重复/已存在并返回已存在的任务 id，这里保持静默
          if (enqueuedId) {
            onLog(
              `刻度图任务已入队: ${t.name}${forceThumbs ? " (强制)" : ""}`,
              "INFO",
            );
          }
        }

        // 字幕（Whisper 入队）：后端已按文件存在与否自动跳过
        if (fixSubtitle) {
          try {
            let videoFile = t.videoFilePath;
            if (!videoFile) {
              const found = (await trpc.videos.findVideoFile.query({
                folder: t.folderPath,
              })) as { success: boolean; path?: string };
              if (found.success && found.path) videoFile = found.path;
            }
            if (!videoFile) throw new Error("未找到视频文件");
            const r: any = await trpc.whisper.transcribe.mutate({
              videoPath: videoFile,
              model: whisperModel,
              language: whisperLang,
            });
            if (r && r.skipped) {
              onLog(`字幕文件已存在，跳过: ${t.name}`, "INFO");
            } else {
              onLog(
                `字幕任务已入队: ${t.name} (job ${r?.jobId})`,
                "INFO",
              );
            }
          } catch (err: any) {
            fail++;
            onLog(`字幕入队失败: ${t.name} - ${err?.message || err}`, "ERROR");
          }
        }

        done++;
      }
      onLog(
        `修复完成：成功 ${done}，失败 ${fail}`,
        fail > 0 ? "WARNING" : "SUCCESS",
      );
      onDone?.();
      onClose();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm anim-fade-in"
      onClick={(e) => {
        if (running) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-[460px] max-w-[90vw] anim-pop-in border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-md bg-amber-500">
              <Wrench className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
              {title}
            </span>
          </div>
          <button
            type="button"
            disabled={running}
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 text-xs">
          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              要修复的项目
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Toggle
                checked={fixCover}
                onChange={setFixCover}
                icon={Image}
                label="封面"
              />
              <Toggle
                checked={fixPreview}
                onChange={setFixPreview}
                icon={Film}
                label="预览视频"
              />
              <Toggle
                checked={fixSubtitle}
                onChange={setFixSubtitle}
                icon={Captions}
                label="生成字幕 (Whisper)"
              />
              <Toggle
                checked={fixThumbs}
                onChange={setFixThumbs}
                icon={BarChart3}
                label="刻度图（雪碧图）"
              />
            </div>
            {fixThumbs && (
              <label className="flex items-center gap-2 mt-1 px-1 text-[10px] text-slate-500 dark:text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={forceThumbs}
                  onChange={(e) => setForceThumbs(e.target.checked)}
                  className="rounded border-slate-300 text-amber-500"
                />
                强制重新生成（默认已有的会跳过）
              </label>
            )}
          </div>

          {(fixCover || fixPreview) && (
            <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                自定义来源（可选，留空走默认 CDN）
              </div>
              {fixCover && (
                <input
                  type="text"
                  placeholder="封面 URL（图片直链）"
                  value={customCoverUrl}
                  onChange={(e) => setCustomCoverUrl(e.target.value)}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-mono rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:focus:ring-amber-900/40"
                />
              )}
              {fixPreview && (
                <input
                  type="text"
                  placeholder="预览视频 URL（mp4 直链）"
                  value={customPreviewUrl}
                  onChange={(e) => setCustomPreviewUrl(e.target.value)}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-mono rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:focus:ring-amber-900/40"
                />
              )}
            </div>
          )}

          {fixSubtitle && (
            <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                字幕生成参数
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500">模型</span>
                  <select
                    value={whisperModel}
                    onChange={(e) =>
                      setWhisperModel(e.target.value as WhisperModel)
                    }
                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-[11px]"
                  >
                    {WHISPER_MODELS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500">语言</span>
                  <input
                    type="text"
                    value={whisperLang}
                    onChange={(e) => setWhisperLang(e.target.value)}
                    placeholder="auto / ja / zh / en"
                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-[11px] font-mono"
                  />
                </label>
              </div>
              {!isSingle && (
                <div className="text-[10px] text-amber-600 dark:text-amber-400">
                  批量字幕会逐个入队，耗时较长。
                </div>
              )}
            </div>
          )}

          {running && (
            <div className="text-[11px] text-amber-600 dark:text-amber-400 font-mono flex items-center gap-2">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span className="truncate">{progressText}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 py-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            disabled={running}
            onClick={onClose}
            className="flex-1 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition cursor-pointer disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            disabled={running}
            onClick={handleRun}
            className="flex-1 py-2 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition cursor-pointer disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {running ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Wrench className="w-3 h-3" />
            )}
            {running ? "处理中..." : isSingle ? "开始修复" : `修复 ${total} 个`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  icon: Icon,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-bold transition cursor-pointer ${
        checked
          ? "border-amber-400 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="flex-1 text-left truncate">{label}</span>
      <span
        className={`w-3 h-3 rounded border ${
          checked
            ? "bg-amber-500 border-amber-500"
            : "border-slate-300 dark:border-slate-600"
        }`}
      />
    </button>
  );
}
