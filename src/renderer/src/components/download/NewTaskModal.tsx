import React, { useState } from "react";
import {
  Plus,
  Play,
  Pause,
  Trash2,
  Eye,
  FileVideo,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Search,
  Film,
  Terminal,
  Code,
  Settings,
  Trash2 as TrashIcon,
  Shield,
  Download,
  X,
  Folder,
  Save,
  AlertCircle as AlertWarn,
  Cpu,
  ChevronDown,
  ChevronRight,
  Globe,
  Info,
  Clock,
} from "lucide-react";
import { parseHeadersText } from "../../pages/download/utils";

export interface NewTaskModalProps {
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
  { name: "missav.ai", url: "https://missav.ai/", icon: "M" },
  { name: "supjav.com", url: "https://supjav.com/", icon: "S" },
];

export function NewTaskModal({
  onClose,
  onAddTask,
  defaultSavePath,
  defaultFormat,
  defaultThreads,
}: NewTaskModalProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"MP4" | "MKV" | "TS">(defaultFormat);
  const [threads, setThreads] = useState<number>(defaultThreads);
  const [savePath, setSavePath] = useState(defaultSavePath);
  const [coverUrl, setCoverUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [headersText, setHeadersText] = useState(
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\nReferer: https://missav.ai\nCookie: ",
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedRefererIndex, setSelectedRefererIndex] = useState<number>(0);
  const [cmdCopied, setCmdCopied] = useState(false);
  // 定时下载相关状态
  const [scheduledEnabled, setScheduledEnabled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState<string>("");
  const [scheduledTime, setScheduledTime] = useState<string>("");
  // 预设相对时间（10分钟后 / 1小时后 / 今晚22点 / 明天早上8点）
  const applyPreset = (preset: () => Date) => {
    const d = preset();
    const pad = (n: number) => String(n).padStart(2, "0");
    setScheduledDate(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    );
    setScheduledTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  };

  // 命令预览字符串（供预览区展示与复制共用）
  const safeName = (name || "视频标题").replace(/[\\/:*?"<>|]/g, "_");
  const decryptFlag =
    format === "MP4"
      ? " --mp4-real-time-decryption"
      : format === "MKV"
        ? " --mkv-real-time-decryption"
        : "";
  const commandPreview = `N_m3u8DL-RE.exe "${url || "URL"}" --save-dir "${savePath}" --save-name "${safeName}" --thread-count ${threads} --auto-select${decryptFlag} --check-segments-count true`;

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(commandPreview);
      setCmdCopied(true);
      setTimeout(() => setCmdCopied(false), 1500);
    } catch {
      /* 忽略复制失败 */
    }
  };

  const selectRefererPreset = (index: number) => {
    const preset = REFERER_PRESETS[index];
    setSelectedRefererIndex(index);
    setHeadersText(
      `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\nReferer: ${preset.url}\nCookie: `,
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setErrorMsg("请先填写 HLS/M3U8 音视频流地址");
      return;
    }
    if (
      !url.toLowerCase().includes(".m3u8") &&
      !url.toLowerCase().includes("/video") &&
      !url.toLowerCase().startsWith("http") &&
      !url.includes("#EXTM3U")
    ) {
      setErrorMsg(
        "似乎不是一个有效的 HLS/M3U8 播放列表链接，请确认 URL 是否正确",
      );
      return;
    }
    const finalName =
      name.trim() || `视频流_${Date.now().toString().slice(-6)}`;

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
      url: url.trim(),
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
    if (shouldClose !== false) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/20 flex justify-end anim-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white border-l border-slate-200 w-full max-w-105 rounded-2xl text-slate-600 overflow-hidden shadow-2xl flex flex-col h-full anim-slide-right">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-2">
            <div className="bg-amber-100 p-2 rounded-lg border border-amber-200">
              <Plus className="w-4 h-4 text-amber-700" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-800 tracking-wider">
                新建 M3U8 下载任务
              </h3>
              <p className="text-[10px] text-black">
                调用 N_m3u8DL-RE 核心进行定制下载分流
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-black hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form
          onSubmit={handleSubmit}
          className="p-6 overflow-y-scroll space-y-5 flex-1 text-xs bg-white"
        >
          {/* Referer Presets */}
          <div>
            <label className="text-black font-semibold block mb-2">
              Referer 源{" "}
              <span className="text-[10px] text-black/30">
                点击选择 Referer 源，用于绕过防盗链验证
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {REFERER_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => selectRefererPreset(idx)}
                  className={`p-3 rounded-xl border text-left transition-all duration-200 cursor-pointer relative ${
                    selectedRefererIndex === idx
                      ? "border-amber-500 bg-amber-50 text-slate-800 shadow-sm ring-1 ring-amber-500"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:border-amber-300 hover:bg-amber-50/50"
                  }`}
                >
                  {selectedRefererIndex === idx && (
                    <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center">
                      <svg
                        className="w-2.5 h-2.5 text-white"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-6 h-6 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${
                        selectedRefererIndex === idx
                          ? "bg-amber-500"
                          : "bg-slate-400"
                      }`}
                    >
                      {preset.icon}
                    </span>
                    <div>
                      <div
                        className={`font-bold text-[11px] ${selectedRefererIndex === idx ? "text-slate-800" : "text-slate-600"}`}
                      >
                        {preset.name}
                      </div>
                      <div className="text-[9px] text-black truncate font-mono">
                        {preset.url}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-slate-200 my-2" />

          {/* Form Fields */}
          <div className="space-y-3.5">
            {/* URL */}
            <div>
              <label className="text-black font-semibold block mb-1.5">
                M3U8 播放流链接 <span className="text-rose-500">*</span>
              </label>
              <div className="relative flex-1">
                <textarea
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="请粘贴以 index.m3u8 结尾的链接..."
                  className="w-full bg-amber-50/60 border border-amber-200/70 text-slate-800 placeholder-slate-400 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-amber-500 focus:bg-amber-50 transition min-h-20"
                  required
                />
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="text-black font-semibold block mb-1.5">
                保存视频名称
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="不填则使用原始标题命名"
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 rounded-lg px-3 py-2.5 text-xs focus:outline-none focus:border-amber-500 transition"
              />
            </div>

            {/* Scheduled Download */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-black font-semibold flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  定时下载
                </label>
                <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scheduledEnabled}
                    onChange={(e) => setScheduledEnabled(e.target.checked)}
                    className="w-3.5 h-3.5 accent-amber-500 cursor-pointer"
                  />
                  启用
                </label>
              </div>
              <div
                className={`border rounded-xl p-3 space-y-2 transition ${
                  scheduledEnabled
                    ? "border-amber-300 bg-amber-50/70"
                    : "border-slate-200 bg-slate-50/50 opacity-60"
                }`}
              >
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-slate-600 block mb-1 font-semibold">
                      日期
                    </span>
                    <input
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      disabled={!scheduledEnabled}
                      className="w-full bg-white border border-slate-200 text-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] font-mono focus:outline-none focus:border-amber-500 transition disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-600 block mb-1 font-semibold">
                      时间
                    </span>
                    <input
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      disabled={!scheduledEnabled}
                      className="w-full bg-white border border-slate-200 text-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] font-mono focus:outline-none focus:border-amber-500 transition disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
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
                        if (d.getTime() < Date.now())
                          d.setDate(d.getDate() + 1);
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
                      disabled={!scheduledEnabled}
                      onClick={() => {
                        if (!scheduledEnabled) setScheduledEnabled(true);
                        applyPreset(fn);
                      }}
                      className="text-[9.5px] font-semibold px-2 py-1 rounded-md bg-white border border-slate-200 hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50/60 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-slate-700"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {scheduledEnabled && scheduledDate && scheduledTime && (
                  <div className="text-[10px] text-amber-700 font-mono pt-0.5 border-t border-amber-200/60">
                    ⏰ 将于{" "}
                    {new Date(
                      `${scheduledDate}T${scheduledTime}`,
                    ).toLocaleString()}{" "}
                    启动下载
                  </div>
                )}
              </div>
            </div>

            {/* Advanced Toggle */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-amber-50/60 hover:border-amber-300 transition-all cursor-pointer focus:outline-none"
              >
                <span className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-bold text-slate-700">
                    进阶请求头与线程控制
                  </span>
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`}
                />
              </button>

              {showAdvanced && (
                <div className="mt-3.5 space-y-3.5 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  {/* Save directory */}
                  <div>
                    <label className="text-black font-semibold block mb-1">
                      覆盖保存路径
                    </label>
                    <input
                      type="text"
                      value={savePath}
                      onChange={(e) => setSavePath(e.target.value)}
                      placeholder="C:\Downloads\AVPlayPro\"
                      className="w-full bg-white border border-slate-200 text-slate-700 rounded-lg px-3 py-1.5 text-[11px] font-mono focus:outline-none focus:border-amber-500 transition"
                    />
                  </div>

                  {/* Headers */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-black font-semibold">
                        HTTP 协议头 (一行一个, 英文冒号分隔)
                      </label>
                    </div>
                    <textarea
                      value={headersText}
                      onChange={(e) => setHeadersText(e.target.value)}
                      rows={4}
                      className="w-full bg-white border border-slate-200 text-slate-700 font-mono text-[10px] rounded-lg p-2.5 focus:outline-none focus:border-amber-500 leading-relaxed"
                      placeholder={
                        "示例:\nUser-Agent: test-agent\nCookie: token=abcd123"
                      }
                    />
                  </div>

                  {/* Cover URL */}
                  <div>
                    <label className="text-black font-semibold block mb-1">
                      封面图 URL（列表缩略图）
                    </label>
                    <input
                      type="text"
                      value={coverUrl}
                      onChange={(e) => setCoverUrl(e.target.value)}
                      placeholder="https://..../cover.jpg"
                      className="w-full bg-white border border-slate-200 text-slate-700 rounded-lg px-3 py-1.5 text-[11px] font-mono focus:outline-none focus:border-amber-500 transition"
                    />
                  </div>

                  {/* Preview URL */}
                  <div>
                    <label className="text-black font-semibold block mb-1">
                      预览视频 URL（鼠标悬停播放，建议 mp4 短片）
                    </label>
                    <input
                      type="text"
                      value={previewUrl}
                      onChange={(e) => setPreviewUrl(e.target.value)}
                      placeholder="https://..../preview.mp4"
                      className="w-full bg-white border border-slate-200 text-slate-700 rounded-lg px-3 py-1.5 text-[11px] font-mono focus:outline-none focus:border-amber-500 transition"
                    />
                  </div>

                  <div className="flex gap-2 p-2 bg-amber-50 rounded-lg border border-amber-100 text-[9px] text-slate-500 leading-normal">
                    <Shield className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      有些流媒体服务器严格校验{" "}
                      <code className="text-amber-700 bg-white px-1 rounded font-mono border border-amber-100">
                        Referer
                      </code>
                      。若遇到分片下载403错误，请在头部选项重设防盗链来源。
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Command Preview —— core-engine-preview 终端卡片 */}
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
            {/* 标题栏：红黄绿三点 + 标题 + 复制按钮 */}
            <div className="flex items-center justify-between px-3 py-2 bg-slate-100 border-b border-slate-200">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              </div>
              <span className="text-[10px] font-mono font-semibold text-slate-400 tracking-wider">
                核心引擎预览
              </span>
              <button
                type="button"
                onClick={handleCopyCommand}
                className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-amber-600 transition cursor-pointer"
              >
                {cmdCopied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-500" /> 已复制
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" /> 复制
                  </>
                )}
              </button>
            </div>
            {/* 命令内容 */}
            <div className="p-3 text-[10px] font-mono text-black select-all break-all leading-relaxed overflow-y-auto max-h-22">
              {commandPreview}
            </div>
          </div>

          {/* Error */}
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2 font-semibold">
              <span className="font-bold">!</span> {errorMsg}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-500 transition rounded-lg text-xs font-semibold cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-bold transition rounded-lg text-xs cursor-pointer"
          >
            创建任务
          </button>
        </div>
      </div>
    </div>
  );
}
