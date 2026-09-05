import React, { useRef, useState } from "react";
import {
  Wrench,
  X,
  RefreshCw,
  Image,
  Film,
  Captions,
  BarChart3,
  Globe,
  Square,
  FileSignature,
} from "lucide-react";
import * as Slider from "@radix-ui/react-slider";
import * as Progress from "@radix-ui/react-progress";
import { trpc } from "../../lib/trpc";
import { thumbnailQueue } from "../../lib/thumbnailQueue";
import type { VideoItem } from "../../pages/player/types";
import { Tooltip } from "../common/Tooltip";

export interface RepairTarget {
  name: string;
  folderPath: string;
  videoFilePath?: string | null;
}

interface RepairModalProps {
  mode: "single" | "all";
  targets: RepairTarget[];
  rootPath?: string;
  onClose: () => void;
  onLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
  onDone?: () => void;
}

type WhisperModel = "tiny" | "base" | "small" | "medium" | "large-v3";
const WHISPER_MODELS: WhisperModel[] = [
  "tiny",
  "base",
  "small",
  "medium",
  "large-v3",
];

function extractCode(name: string): string | null {
  const m = name.match(/[A-Z]{2,6}-\d{3,5}/i);
  return m ? m[0].toUpperCase() : null;
}

export function RepairModal({
  mode,
  targets,
  rootPath,
  onClose,
  onLog,
  onDone,
}: RepairModalProps) {
  const [fixCover, setFixCover] = useState(true);
  const [fixPreview, setFixPreview] = useState(true);
  const [fixSubtitle, setFixSubtitle] = useState(false);
  const [fixThumbs, setFixThumbs] = useState(false);
  const [fixScrape, setFixScrape] = useState(true);
  const [fixRename, setFixRename] = useState(true);
  const [forceThumbs, setForceThumbs] = useState(false);
  const [customCoverUrl, setCustomCoverUrl] = useState("");
  const [customPreviewUrl, setCustomPreviewUrl] = useState("");
  const [whisperModel, setWhisperModel] = useState<WhisperModel>("base");
  const [whisperLang, setWhisperLang] = useState("auto");
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const [stopping, setStopping] = useState(false);

  // 每个任务独立的并发数
  const [scrapeConc, setScrapeConc] = useState(3);
  const [renameConc, setRenameConc] = useState(4);
  const [coverConc, setCoverConc] = useState(2);
  const [thumbsConc, setThumbsConc] = useState(5);
  const [subtitleConc, setSubtitleConc] = useState(2);

  // 每个任务独立的进度
  const [scrapeDone, setScrapeDone] = useState(0);
  const [renameDone, setRenameDone] = useState(0);
  const [coverDone, setCoverDone] = useState(0);
  const [thumbsDone, setThumbsDone] = useState(0);
  const [subtitleDone, setSubtitleDone] = useState(0);

  const isSingle = mode === "single";
  const total = targets.length;
  const title = isSingle
    ? `修复视频：${targets[0]?.name || "—"}`
    : `批量修复（共 ${total} 个视频）`;

  const handleRun = async () => {
    if (
      !fixCover &&
      !fixPreview &&
      !fixSubtitle &&
      !fixThumbs &&
      !fixScrape &&
      !fixRename
    ) {
      onLog("请至少选择一项要修复的内容", "WARNING");
      return;
    }
    if (fixRename && !rootPath) {
      onLog("无法重命名：未提供根目录 (rootPath)", "ERROR");
      return;
    }
    if (!isSingle && (customCoverUrl.trim() || customPreviewUrl.trim())) {
      const ok = window.confirm(
        "你为「全部修复」填写了自定义 URL，这会让所有视频都使用同一个地址。确定继续吗？",
      );
      if (!ok) return;
    }
    setRunning(true);
    stopRef.current = false;
    setStopping(false);
    setScrapeDone(0);
    setRenameDone(0);
    setCoverDone(0);
    setThumbsDone(0);
    setSubtitleDone(0);

    let fail = 0;
    // 工作副本：重命名会改 folderPath / videoFilePath，后续阶段读这个
    const work: RepairTarget[] = targets.map((t) => ({ ...t }));

    // 通用 worker pool：concurrency 个并发 worker 从游标取任务
    const runPool = async (
      concurrency: number,
      processor: (t: RepairTarget, idx: number) => Promise<void>,
    ) => {
      let cursor = 0;
      const n = Math.max(1, Math.min(concurrency, work.length));
      await Promise.all(
        Array.from({ length: n }, async () => {
          while (!stopRef.current) {
            const idx = cursor++;
            if (idx >= work.length) return;
            try {
              await processor(work[idx], idx);
            } catch {
              // processor 内部已记日志
            }
          }
        }),
      );
    };

    // —— 4 个独立 processor ——
    const processScrape = async (t: RepairTarget) => {
      try {
        const r: any = await trpc.meta.scrapeMetadata.mutate({
          folderPath: t.folderPath,
        });
        if (r?.success) {
          onLog(`刮削成功: ${t.name} - ${r.message || ""}`, "SUCCESS");
        } else {
          fail++;
          onLog(`刮削失败: ${t.name} - ${r?.error || "未知"}`, "ERROR");
        }
      } catch (err: any) {
        fail++;
        onLog(`刮削异常: ${t.name} - ${err?.message || err}`, "ERROR");
      } finally {
        setScrapeDone((v) => v + 1);
      }
    };

    const processCoverPreview = async (t: RepairTarget) => {
      const code = extractCode(t.name) || t.name.split(" ")[0];
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
          onLog(`封面/预览均已存在，跳过: ${t.name}`, "INFO");
        } else {
          onLog(`封面/预览已处理: ${t.name}`, "SUCCESS");
        }
      } catch (err: any) {
        fail++;
        onLog(`封面/预览失败: ${t.name} - ${err?.message || err}`, "ERROR");
      } finally {
        setCoverDone((v) => v + 1);
      }
    };

    const processThumbs = async (t: RepairTarget) => {
      try {
        const enqueuedId = thumbnailQueue.enqueue({
          name: t.name,
          folderPath: t.folderPath,
          force: forceThumbs,
        });
        if (enqueuedId) {
          onLog(
            `刻度图任务已入队: ${t.name}${forceThumbs ? " (强制)" : ""}`,
            "INFO",
          );
        }
      } catch (err: any) {
        fail++;
        onLog(`刻度图入队失败: ${t.name} - ${err?.message || err}`, "ERROR");
      } finally {
        setThumbsDone((v) => v + 1);
      }
    };

    const processRename = async (t: RepairTarget, idx: number) => {
      try {
        const r: any = await trpc.meta.renameFolderByCode.mutate({
          folderPath: t.folderPath,
          rootPath: rootPath!,
        });
        if (r?.success) {
          if (r.renamed && r.newPath) {
            // 同步更新工作副本：后续 cover/thumbs/subtitle 用新路径
            const oldBase = t.videoFilePath
              ? t.videoFilePath.split(/[\\/]/).pop()
              : null;
            const newFolder = r.newPath as string;
            work[idx] = {
              ...t,
              folderPath: newFolder,
              videoFilePath: oldBase
                ? `${newFolder}${newFolder.includes("\\") ? "\\" : "/"}${oldBase}`
                : t.videoFilePath,
            };
            onLog(`重命名: ${t.name} → ${newFolder}`, "SUCCESS");
          } else {
            onLog(`重命名跳过（名称已最新）: ${t.name}`, "INFO");
          }
        } else {
          fail++;
          onLog(`重命名失败: ${t.name} - ${r?.error || "未知"}`, "ERROR");
        }
      } catch (err: any) {
        fail++;
        onLog(`重命名异常: ${t.name} - ${err?.message || err}`, "ERROR");
      } finally {
        setRenameDone((v) => v + 1);
      }
    };

    const processSubtitle = async (t: RepairTarget) => {
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
          onLog(`字幕任务已入队: ${t.name} (job ${r?.jobId})`, "INFO");
        }
      } catch (err: any) {
        fail++;
        onLog(`字幕入队失败: ${t.name} - ${err?.message || err}`, "ERROR");
      } finally {
        setSubtitleDone((v) => v + 1);
      }
    };

    try {
      // 三阶段：刮削 → 重命名 → 其余（封面/刻度图/字幕）
      // 阶段间串行（重命名要读刮削写的 meta；后续任务要用重命名后的新路径）
      // 阶段内各任务独立 pool，并行

      // Phase 1: 刮削
      if (fixScrape && !stopRef.current) {
        await runPool(scrapeConc, processScrape);
      }

      // Phase 2: 重命名（依赖 Phase 1 写入的 meta.json）
      if (fixRename && !stopRef.current) {
        await runPool(renameConc, processRename);
      }

      // Phase 3: 其余任务，全部并行
      if (!stopRef.current) {
        const pools: Promise<void>[] = [];
        if (fixCover || fixPreview)
          pools.push(runPool(coverConc, processCoverPreview));
        if (fixThumbs) pools.push(runPool(thumbsConc, processThumbs));
        if (fixSubtitle) pools.push(runPool(subtitleConc, processSubtitle));
        await Promise.all(pools);
      }

      const stopped = stopRef.current;
      if (stopped) {
        onLog(`已停止：失败 ${fail}`, "WARNING");
      } else {
        onLog(`修复完成（失败 ${fail}）`, fail > 0 ? "WARNING" : "SUCCESS");
      }
      onDone?.();
      if (!stopped) onClose();
    } finally {
      setRunning(false);
      setStopping(false);
      stopRef.current = false;
    }
  };

  const handleStop = () => {
    stopRef.current = true;
    setStopping(true);
    onLog("停止信号已发出，等待已发起的任务完成...", "WARNING");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm anim-fade-in"
      onClick={(e) => {
        if (running) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-[460px] max-w-[90vw] max-h-[90vh] flex flex-col anim-pop-in border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-md bg-amber-500">
              <Wrench className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
              {title}
            </span>
          </div>
          <Tooltip content="关闭修复窗口 (Esc)" placement="left">
            <button
              type="button"
              disabled={running}
              onClick={onClose}
              aria-label="关闭修复窗口"
              className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>

        <div className="px-5 py-4 space-y-4 text-xs flex-1 overflow-y-auto">
          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              要修复的项目
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Toggle
                checked={fixScrape}
                onChange={setFixScrape}
                icon={Globe}
                label="联网刮削 (元数据/标题/演员)"
              />
              <Toggle
                checked={fixRename}
                onChange={setFixRename}
                icon={FileSignature}
                label="智能重命名 (基于刮削结果)"
              />
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

          {(fixScrape ||
            fixRename ||
            fixCover ||
            fixPreview ||
            fixThumbs ||
            fixSubtitle) && (
            <div
              className="space-y-2.5 border-t border-slate-100 dark:border-slate-800 pt-3"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                各任务并发数（并行执行）
                {isSingle && (
                  <span className="ml-2 text-slate-400 normal-case font-normal">
                    · 单视频模式仅显示进度
                  </span>
                )}
              </div>
              {fixScrape && (
                <ConcRow
                  label="联网刮削"
                  value={scrapeConc}
                  onChange={setScrapeConc}
                  max={8}
                  running={running}
                  done={scrapeDone}
                  total={total}
                />
              )}
              {fixRename && (
                <ConcRow
                  label="智能重命名"
                  value={renameConc}
                  onChange={setRenameConc}
                  max={10}
                  running={running}
                  done={renameDone}
                  total={total}
                />
              )}
              {(fixCover || fixPreview) && (
                <ConcRow
                  label="封面/预览"
                  value={coverConc}
                  onChange={setCoverConc}
                  max={8}
                  running={running}
                  done={coverDone}
                  total={total}
                />
              )}
              {fixThumbs && (
                <ConcRow
                  label="刻度图入队"
                  value={thumbsConc}
                  onChange={setThumbsConc}
                  max={20}
                  running={running}
                  done={thumbsDone}
                  total={total}
                />
              )}
              {fixSubtitle && (
                <ConcRow
                  label="字幕入队"
                  value={subtitleConc}
                  onChange={setSubtitleConc}
                  max={20}
                  running={running}
                  done={subtitleDone}
                  total={total}
                />
              )}
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
            关闭
          </button>
          {running ? (
            <button
              type="button"
              onClick={handleStop}
              disabled={stopping}
              className="flex-1 py-2 text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 rounded-lg transition cursor-pointer disabled:opacity-60 flex items-center justify-center gap-1.5"
            >
              <Square className="w-3 h-3" />
              {stopping ? "停止中..." : "停止"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRun}
              className="flex-1 py-2 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Wrench className="w-3 h-3" />
              {isSingle ? "开始修复" : `修复 ${total} 个`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const ConcRow = React.memo(function ConcRow({
  label,
  value,
  onChange,
  max,
  running,
  done,
  total,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
  running: boolean;
  done: number;
  total: number;
}) {
  // 拖拽时只更新本地 state，松手才同步到父组件，避免父级整树重渲染
  const [localValue, setLocalValue] = useState(value);
  // 父级 prop 变化（外部代码 setValue）时同步本地
  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-bold text-slate-600 dark:text-slate-300">
          {label}
        </span>
        <span className="font-mono text-amber-600 dark:text-amber-400">
          并发 {localValue}
          {running && (
            <span className="ml-2 text-slate-500 dark:text-slate-400">
              · {done}/{total} ({pct}%)
            </span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Tooltip content="减少并发数" placement="top">
          <button
            type="button"
            disabled={running || localValue <= 1}
            onClick={() => {
              const next = Math.max(1, localValue - 1);
              setLocalValue(next);
              onChange(next);
            }}
            aria-label="减少并发数"
            className="w-6 h-6 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer text-xs font-bold shrink-0"
          >
            −
          </button>
        </Tooltip>
        <Slider.Root
          className="conc-slider relative flex items-center select-none touch-none w-full h-5 cursor-pointer data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
          value={[localValue]}
          min={1}
          max={max}
          step={1}
          disabled={running}
          onValueChange={(v) => setLocalValue(v[0])}
          onValueCommit={(v) => onChange(v[0])}
        >
          <Slider.Track className="bg-slate-200 dark:bg-slate-700 relative grow rounded-full h-1.5 slider-track-smooth">
            <Slider.Range className="absolute bg-amber-500 rounded-full h-full" />
          </Slider.Track>
          <Slider.Thumb
            className="block w-4 h-4 bg-white border-2 border-amber-500 shadow-md rounded-full hover:bg-amber-50 dark:hover:bg-amber-950 focus:outline-none focus:ring-2 focus:ring-amber-300 slider-thumb-smooth"
            aria-label={label}
          />
        </Slider.Root>
        <Tooltip content="增加并发数" placement="top">
          <button
            type="button"
            disabled={running || localValue >= max}
            onClick={() => {
              const next = Math.min(max, localValue + 1);
              setLocalValue(next);
              onChange(next);
            }}
            aria-label="增加并发数"
            className="w-6 h-6 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer text-xs font-bold shrink-0"
          >
            +
          </button>
        </Tooltip>
      </div>
    </div>
  );
});

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
