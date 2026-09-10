import React, { useState, useEffect, useMemo } from "react";
import { Tooltip } from "../common/Tooltip";
import { Button } from "../common/Button";
import {
  Plus,
  Play,
  Copy,
  Check,
  Download,
  X,
  FolderOpen,
  Settings2,
  Clock,
  Sparkles,
  ClipboardPaste,
  ShieldCheck,
  Terminal,
  Cpu,
  Layers,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { parseHeadersText, extractVideoCode } from "../../pages/download/utils";
import { trpc } from "../../lib/trpc";

export interface NewTaskModalProps {
  initialUrl?: string;
  initialCandidate?: {
    name: string;
    url: string;
    coverUrl?: string;
    previewUrl?: string;
    pageUrl?: string;
  };
  onClose: () => void;
  onAddTask: (task: {
    name: string;
    url: string;
    format: "MP4" | "MKV" | "TS";
    headers: string;
    threads: number;
    savePath: string;
    encryptionType?: string;
    resolution?: string;
    fileSize?: number;
    totalSegments?: number;
    coverUrl?: string;
    previewUrl?: string;
    scheduledAt?: string;
    scheduledEnabled?: boolean;
    taskTag?: "NORMAL" | "SCHEDULED";
  }) => boolean | Promise<boolean>;
  defaultSavePath: string;
  defaultFormat: "MP4" | "MKV" | "TS";
  defaultThreads: number;
}

const REFERER_PRESETS = [
  { id: "missav", name: "MissAV", url: "https://missav.ai/", desc: "绕过 MissAV 防盗链" },
  { id: "supjav", name: "SupJAV", url: "https://supjav.com/", desc: "绕过 SupJAV 校验" },
  { id: "custom", name: "自定义 / 无", url: "", desc: "原生直接请求" },
];

const THREAD_OPTIONS = [4, 8, 16, 32, 64];

export function NewTaskModal({
  initialUrl = "",
  initialCandidate,
  onClose,
  onAddTask,
  defaultSavePath,
  defaultFormat,
  defaultThreads,
}: NewTaskModalProps) {
  const [url, setUrl] = useState(initialUrl);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"MP4" | "MKV" | "TS">(defaultFormat || "MP4");
  const [threads, setThreads] = useState<number>(defaultThreads || 16);
  const [savePath, setSavePath] = useState(defaultSavePath);
  const [coverUrl, setCoverUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [headersText, setHeadersText] = useState(
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\nReferer: https://missav.ai\nCookie: ",
  );
  const [selectedRefererPreset, setSelectedRefererPreset] = useState<string>("missav");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [cmdCopied, setCmdCopied] = useState(false);
  const [isSelectingFolder, setIsSelectingFolder] = useState(false);

  // 定时下载状态
  const [scheduledEnabled, setScheduledEnabled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState<string>("");
  const [scheduledTime, setScheduledTime] = useState<string>("");

  // 同步外部传入的 initialUrl
  useEffect(() => {
    if (initialUrl) setUrl(initialUrl);
  }, [initialUrl]);

  // 从候选对象回填
  useEffect(() => {
    if (!initialCandidate) return;
    setUrl(initialCandidate.url);
    setName(initialCandidate.name);
    setCoverUrl(initialCandidate.coverUrl || "");
    setPreviewUrl(initialCandidate.previewUrl || "");
    if (initialCandidate.pageUrl) {
      try {
        const origin = new URL(initialCandidate.pageUrl).origin;
        setHeadersText(
          `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\nReferer: ${initialCandidate.pageUrl}\nOrigin: ${origin}\nCookie: `,
        );
        setSelectedRefererPreset("custom");
      } catch {
        // 保留原设置
      }
    }
  }, [initialCandidate]);

  // 监听 ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // 尝试从 URL 或文本提取番号
  const extractedCode = useMemo(() => {
    return extractVideoCode(name) || extractVideoCode(url);
  }, [name, url]);

  const handleApplyExtractedCode = () => {
    if (extractedCode) {
      setName(extractedCode);
    }
  };

  // 快捷从剪贴板读取并填入 URL
  const handlePasteFromClipboard = async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText && clipText.trim()) {
        const trimmed = clipText.trim();
        setUrl(trimmed);
        setErrorMsg("");
        // 若名称为空且提取到了番号，则自动辅助命名
        if (!name.trim()) {
          const code = extractVideoCode(trimmed);
          if (code) setName(code);
        }
      }
    } catch {
      // 无法访问剪贴板时忽略
    }
  };

  // 选择原生文件夹
  const handleChooseFolder = async () => {
    if (isSelectingFolder) return;
    setIsSelectingFolder(true);
    try {
      const selected = await trpc.dialog.selectFolder.query({
        currentPath: savePath || defaultSavePath,
      });
      if (selected) {
        setSavePath(selected);
      }
    } catch (err) {
      console.error("Failed to select folder", err);
    } finally {
      setIsSelectingFolder(false);
    }
  };

  // 切换 Referer 源
  const handleSelectRefererPreset = (presetId: string) => {
    setSelectedRefererPreset(presetId);
    const preset = REFERER_PRESETS.find((p) => p.id === presetId);
    if (!preset || !preset.url) {
      setHeadersText(
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\nCookie: ",
      );
      return;
    }
    setHeadersText(
      `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\nReferer: ${preset.url}\nCookie: `,
    );
  };

  // 定时快捷时间
  const applyPresetTime = (presetFn: () => Date) => {
    const d = presetFn();
    const pad = (n: number) => String(n).padStart(2, "0");
    setScheduledDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    setScheduledTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  };

  // 生成命令行预览
  const safeName = (name.trim() || extractedCode || "未命名任务").replace(/[\\/:*?"<>|]/g, "_");
  const decryptFlag =
    format === "MP4"
      ? " --mp4-real-time-decryption"
      : format === "MKV"
        ? " --mkv-real-time-decryption"
        : "";
  const commandPreview = `N_m3u8DL-RE.exe "${url || "<HLS_URL>"}" --save-dir "${savePath || "./"}" --save-name "${safeName}" --thread-count ${threads} --auto-select${decryptFlag} --check-segments-count true`;

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(commandPreview);
      setCmdCopied(true);
      setTimeout(() => setCmdCopied(false), 1800);
    } catch {
      // 忽略
    }
  };

  // 提交
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setErrorMsg("请填写 HLS / M3U8 播放流地址或媒体直链");
      return;
    }
    if (
      !trimmedUrl.toLowerCase().includes(".m3u8") &&
      !trimmedUrl.toLowerCase().includes("/video") &&
      !trimmedUrl.toLowerCase().startsWith("http") &&
      !trimmedUrl.includes("#EXTM3U")
    ) {
      setErrorMsg("检测到非常规播放流地址，请确认 URL 是否属于可解析的 HLS/M3U8 源");
      return;
    }

    const finalName =
      name.trim() || extractedCode || `下载任务_${Date.now().toString().slice(-6)}`;

    // 解析定时时间
    let scheduledAt: string | undefined;
    if (scheduledEnabled && scheduledDate && scheduledTime) {
      const [y, m, d] = scheduledDate.split("-").map(Number);
      const [hh, mm] = scheduledTime.split(":").map(Number);
      if (y && m && d && !Number.isNaN(hh) && !Number.isNaN(mm)) {
        const at = new Date(y, m - 1, d, hh, mm, 0, 0);
        scheduledAt = at.toISOString();
      }
    }

    const shouldClose = await onAddTask({
      name: finalName,
      url: trimmedUrl,
      format,
      headers: parseHeadersText(headersText),
      threads,
      savePath,
      coverUrl: coverUrl.trim() || undefined,
      previewUrl: previewUrl.trim() || undefined,
      scheduledAt,
      scheduledEnabled: scheduledEnabled,
      taskTag: scheduledEnabled && scheduledAt ? "SCHEDULED" : "NORMAL",
    });

    if (shouldClose !== false) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-sm anim-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-2xl overflow-hidden anim-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部 Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-accent-500/10 dark:bg-accent-500/20 p-2.5 rounded-xl border border-accent-500/20">
              <Download className="w-5 h-5 text-accent-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-1 tracking-wide flex items-center gap-2">
                新建下载任务
                <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-accent-500/15 text-accent-500 dark:text-accent-300 border border-accent-500/20">
                  N_m3u8DL-RE 引擎
                </span>
              </h3>
              <p className="text-[11px] text-text-3 mt-0.5">
                支持 HLS / M3U8 分片嗅探、实时解密与多线程急速合并
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="p-1.5 rounded-lg text-text-3 hover:text-text-1 hover:bg-accent-500/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 主体滚动表单 */}
        <form
          onSubmit={handleSubmit}
          className="p-6 overflow-y-auto space-y-5 flex-1 text-xs select-none"
        >
          {/* 1. M3U8 播放流地址 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-text-1 flex items-center gap-1.5">
                <span>媒体流地址 (URL)</span>
                <span className="text-accent-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  className="text-[11px] font-medium text-accent-500 hover:text-accent-600 dark:text-accent-400 flex items-center gap-1 transition cursor-pointer"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  <span>粘贴剪贴板</span>
                </button>
                {url && (
                  <button
                    type="button"
                    onClick={() => setUrl("")}
                    className="text-[11px] text-text-3 hover:text-text-1 transition cursor-pointer"
                  >
                    清空
                  </button>
                )}
              </div>
            </div>

            <div className="relative">
              <textarea
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (errorMsg) setErrorMsg("");
                }}
                rows={2}
                placeholder="请粘贴以 .m3u8 结尾的播放地址或媒体流链接..."
                className="w-full bg-white/70 dark:bg-slate-800/80 border border-hairline hover:border-accent-500/50 focus:border-accent-500 rounded-2xl px-3.5 py-2.5 text-xs font-mono text-text-1 placeholder-text-3/60 focus:outline-none focus:ring-2 focus:ring-accent-500/20 transition leading-relaxed resize-none shadow-sm"
                required
              />
              {url.toLowerCase().includes(".m3u8") && (
                <div className="absolute right-3 bottom-2.5 flex items-center gap-1 text-[10px] font-mono text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-md border border-emerald-500/20">
                  <Check className="w-3 h-3" /> M3U8 协议识别
                </div>
              )}
            </div>
          </div>

          {/* 2. 视频名称与番号智能识别 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-text-1 flex items-center gap-1">
                <span>任务命名 / 番号</span>
              </label>
              {extractedCode && extractedCode !== name && (
                <button
                  type="button"
                  onClick={handleApplyExtractedCode}
                  className="text-[11px] font-medium text-pink-500 hover:text-pink-600 dark:text-pink-400 flex items-center gap-1 transition cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>识别到番号: {extractedCode} (填入)</span>
                </button>
              )}
            </div>
            <div className="relative flex items-center">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={extractedCode ? `建议番号: ${extractedCode}` : "不填则自动按流标题或时间戳命名"}
                className="w-full bg-white/70 dark:bg-slate-800/80 border border-hairline hover:border-accent-500/50 focus:border-accent-500 rounded-2xl px-3.5 py-2.5 text-xs text-text-1 placeholder-text-3/60 focus:outline-none focus:ring-2 focus:ring-accent-500/20 transition shadow-sm"
              />
            </div>
          </div>

          {/* 3. 保存路径选择器 */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-text-1 flex items-center justify-between">
              <span>保存目录</span>
              <span className="text-[10px] text-text-3 font-normal">下载完成后将存放于该文件夹</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                placeholder="/Users/xxx/Downloads"
                className="flex-1 bg-white/70 dark:bg-slate-800/80 border border-hairline hover:border-accent-500/50 focus:border-accent-500 rounded-2xl px-3.5 py-2 text-xs font-mono text-text-1 placeholder-text-3/60 focus:outline-none focus:ring-2 focus:ring-accent-500/20 transition shadow-sm truncate"
              />
              <button
                type="button"
                onClick={handleChooseFolder}
                disabled={isSelectingFolder}
                className="px-3.5 py-2 rounded-2xl bg-surface-2 hover:bg-black/10 dark:hover:bg-white/10 border border-hairline text-xs font-medium text-text-2 hover:text-text-1 flex items-center gap-1.5 transition cursor-pointer shrink-0 disabled:opacity-50"
              >
                <FolderOpen className="w-4 h-4 text-accent-500" />
                <span>浏览</span>
              </button>
            </div>
          </div>

          {/* 4. 关键配置卡片网格：格式切换、线程控制 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
            {/* 封装格式 */}
            <div className="p-3.5 rounded-2xl bg-surface-2/60 dark:bg-slate-800/50 border border-hairline space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-1 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-accent-500" />
                  <span>封装格式</span>
                </span>
                <span className="text-[10px] text-text-3 font-mono">
                  {format === "MP4" ? "兼容性最佳" : format === "MKV" ? "无损保留多音轨" : "切片实时流"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(["MP4", "MKV", "TS"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setFormat(fmt)}
                    className={`py-1.5 rounded-xl font-bold text-xs transition cursor-pointer text-center ${
                      format === fmt
                        ? "bg-accent-500 text-white shadow-sm shadow-accent-500/20"
                        : "bg-surface-1 dark:bg-slate-800 text-text-2 hover:text-text-1 hover:bg-black/5 dark:hover:bg-white/5 border border-hairline"
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* 并发线程数 */}
            <div className="p-3.5 rounded-2xl bg-surface-2/60 dark:bg-slate-800/50 border border-hairline space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-1 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-accent-500" />
                  <span>并发下载线程</span>
                </span>
                <span className="text-[10px] font-mono-num font-bold text-accent-500">
                  {threads} 线程
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {THREAD_OPTIONS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setThreads(t)}
                    className={`flex-1 py-1.5 rounded-xl font-mono text-[11px] font-bold transition cursor-pointer text-center ${
                      threads === t
                        ? "bg-accent-500 text-white shadow-sm shadow-accent-500/20"
                        : "bg-surface-1 dark:bg-slate-800 text-text-2 hover:text-text-1 hover:bg-black/5 dark:hover:bg-white/5 border border-hairline"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 5. 防盗链 Referer 快捷选择 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-text-1 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-accent-500" />
                <span>防盗链 Referer 来源</span>
              </label>
              <span className="text-[10px] text-text-3">防 403 权限被拒</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {REFERER_PRESETS.map((p) => {
                const isSelected = selectedRefererPreset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectRefererPreset(p.id)}
                    className={`p-2.5 rounded-2xl border text-left transition-all cursor-pointer relative ${
                      isSelected
                        ? "border-accent-500/60 bg-accent-500/10 text-text-1 ring-1 ring-accent-500/30"
                        : "border-hairline bg-surface-2/40 hover:bg-surface-2 text-text-2 hover:text-text-1"
                    }`}
                  >
                    <div className="font-bold text-xs flex items-center justify-between">
                      <span>{p.name}</span>
                      {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-accent-500" />}
                    </div>
                    <div className="text-[10px] text-text-3 truncate mt-0.5">{p.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 6. 定时预约下载卡片 */}
          <div className="rounded-2xl border border-hairline overflow-hidden bg-surface-2/40 dark:bg-slate-800/40">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-accent-500" />
                <span className="text-xs font-bold text-text-1">预约定时下载</span>
                <span className="text-[10px] text-text-3">非高峰期错峰下载</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={scheduledEnabled}
                  onChange={(e) => setScheduledEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-black/15 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-500" />
              </label>
            </div>

            {scheduledEnabled && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-hairline/60 bg-surface-1/50 dark:bg-slate-900/40">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-text-3 block mb-1">执行日期</span>
                    <input
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      className="w-full bg-white dark:bg-slate-800 border border-hairline rounded-xl px-3 py-1.5 text-xs font-mono text-text-1 focus:outline-none focus:border-accent-500 transition"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-text-3 block mb-1">执行时刻</span>
                    <input
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      className="w-full bg-white dark:bg-slate-800 border border-hairline rounded-xl px-3 py-1.5 text-xs font-mono text-text-1 focus:outline-none focus:border-accent-500 transition"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-text-3 mr-1">快捷预设:</span>
                  {[
                    {
                      label: "10 分钟后",
                      fn: () => {
                        const d = new Date();
                        d.setMinutes(d.getMinutes() + 10);
                        return d;
                      },
                    },
                    {
                      label: "1 小时后",
                      fn: () => {
                        const d = new Date();
                        d.setHours(d.getHours() + 1);
                        return d;
                      },
                    },
                    {
                      label: "今晚 22:00",
                      fn: () => {
                        const d = new Date();
                        d.setHours(22, 0, 0, 0);
                        if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
                        return d;
                      },
                    },
                    {
                      label: "明早 08:00",
                      fn: () => {
                        const d = new Date();
                        d.setDate(d.getDate() + 1);
                        d.setHours(8, 0, 0, 0);
                        return d;
                      },
                    },
                  ].map(({ label, fn }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => applyPresetTime(fn)}
                      className="text-[10px] font-medium px-2 py-1 rounded-lg bg-surface-2 hover:bg-accent-500/15 hover:text-accent-500 border border-hairline transition cursor-pointer text-text-2"
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {scheduledDate && scheduledTime && (
                  <div className="text-[10px] text-accent-500 font-mono flex items-center gap-1.5 pt-1">
                    <Clock className="w-3 h-3" />
                    <span>
                      将于 {new Date(`${scheduledDate}T${scheduledTime}`).toLocaleString()} 自动启动
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 7. 高级网络与封面定制（折叠手风琴） */}
          <div className="rounded-2xl border border-hairline overflow-hidden bg-surface-2/40 dark:bg-slate-800/40">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-text-3" />
                <span className="text-xs font-bold text-text-1">高级定制选项</span>
                <span className="text-[10px] text-text-3">HTTP Headers、封面与视频预览</span>
              </span>
              {showAdvanced ? (
                <ChevronUp className="w-4 h-4 text-text-3" />
              ) : (
                <ChevronDown className="w-4 h-4 text-text-3" />
              )}
            </button>

            {showAdvanced && (
              <div className="p-4 border-t border-hairline space-y-3.5 bg-surface-1/40 dark:bg-slate-900/40">
                {/* Headers */}
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-text-2 block">
                    自定义 HTTP Headers (一行一个，英文冒号分隔)
                  </span>
                  <textarea
                    value={headersText}
                    onChange={(e) => setHeadersText(e.target.value)}
                    rows={3}
                    className="w-full bg-white dark:bg-slate-800 border border-hairline rounded-xl p-2.5 text-[10px] font-mono text-text-1 focus:outline-none focus:border-accent-500 leading-relaxed"
                    placeholder="User-Agent: Mozilla/5.0...&#10;Referer: https://...&#10;Cookie: ..."
                  />
                </div>

                {/* 封面与预览链接 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold text-text-2 block">封面图 URL</span>
                    <input
                      type="text"
                      value={coverUrl}
                      onChange={(e) => setCoverUrl(e.target.value)}
                      placeholder="https://.../cover.jpg"
                      className="w-full bg-white dark:bg-slate-800 border border-hairline rounded-xl px-3 py-1.5 text-[10px] font-mono text-text-1 focus:outline-none focus:border-accent-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold text-text-2 block">预览视频 URL</span>
                    <input
                      type="text"
                      value={previewUrl}
                      onChange={(e) => setPreviewUrl(e.target.value)}
                      placeholder="https://.../preview.mp4"
                      className="w-full bg-white dark:bg-slate-800 border border-hairline rounded-xl px-3 py-1.5 text-[10px] font-mono text-text-1 focus:outline-none focus:border-accent-500"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 8. 仿 macOS 终端引擎预览 */}
          <div className="rounded-2xl border border-hairline overflow-hidden bg-slate-950 text-slate-200 shadow-inner">
            <div className="flex items-center justify-between px-3.5 py-2 bg-slate-900 border-b border-slate-800">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                <span className="text-[10px] font-mono font-medium text-slate-400 ml-2">
                  核心终端指令预览
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopyCommand}
                className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-white transition cursor-pointer"
              >
                {cmdCopied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>复制命令</span>
                  </>
                )}
              </button>
            </div>
            <div className="p-3 text-[10.5px] font-mono leading-relaxed text-slate-300 break-all select-all max-h-20 overflow-y-auto">
              {commandPreview}
            </div>
          </div>

          {/* 错误提示 */}
          {errorMsg && (
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </form>

        {/* 底部操作 Footer */}
        <div className="px-6 py-4 bg-surface-2 border-t border-hairline flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 text-text-3">
            <Download className="w-4 h-4 text-accent-500" />
            <span className="text-[10px]">任务将自动推入 N_m3u8DL-RE 调度器</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<Download className="w-3.5 h-3.5" />}
              onClick={() => handleSubmit()}
            >
              立即加入下载队列
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
