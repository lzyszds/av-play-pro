/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "../lib/trpc";
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
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TaskStatus =
  | "PENDING"
  | "PARSING"
  | "DOWNLOADING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED";

interface DownloadTask {
  id: string;
  name: string;
  url: string;
  status: TaskStatus;
  totalSize: number;
  progress: number;
  speed: number;
  fileSize: number;
  downloadedSize: number;
  totalSegments: number;
  downloadedSegments: number;
  format: "MP4" | "MKV" | "TS";
  headers: string;
  savePath: string;
  threads: number;
  creationTime: string;
  logs: string[];
  encryptionType?: string;
  resolution?: string;
  coverUrl?: string;
  previewUrl?: string;
}

interface LogMessage {
  id: string;
  timestamp: string;
  level: "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "DEBUG";
  text: string;
}

interface AppSettings {
  video_path: string;
  temp_path: string;
  defaultFormat: "MP4" | "MKV" | "TS";
  defaultThreads: number;
  maxConcurrentTasks: number;
  autoMerge: boolean;
  proxyUrl: string;
  nm3u8dlPath: string;
}

interface DownloadPageProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
}

/* ------------------------------------------------------------------ */
/*  Utility helpers                                                     */
/* ------------------------------------------------------------------ */

function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (
    parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " + sizes[i]
  );
}

// 从任务名提取番号，生成封面 URL（通过 CDN 代理）
function getCoverUrlFromName(name: string): string | undefined {
  const match = name.match(/[A-Z]{2,6}-\d{3,5}/i);
  if (!match) return undefined;
  const code = match[0].toLowerCase();
  return `cdn://fourhoi.com/${code}-uncensored-leak/cover-n.jpg`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return "0 KB/s";
  const mbs = bytesPerSec / (1024 * 1024);
  if (mbs >= 1) return `${mbs.toFixed(2)} MB/s`;
  return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
}

function parseHeadersText(text: string): string {
  if (!text.trim()) return "{}";
  const obj: Record<string, string> = {};
  text.split("\n").forEach((line) => {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.substring(0, idx).trim();
      const value = line.substring(idx + 1).trim();
      if (key && value) obj[key] = value;
    }
  });
  return JSON.stringify(obj);
}

function generateN3u8DLCommand(task: DownloadTask): string {
  const parts: string[] = [];
  parts.push('"N_m3u8DL-RE.exe"');
  parts.push(`"${task.url}"`);
  if (task.savePath) parts.push(`--save-dir "${task.savePath}"`);
  if (task.name)
    parts.push(`--save-name "${task.name.replace(/[\\/:*?"<>|]/g, "_")}"`);
  if (task.format === "MP4") {
    parts.push("--auto-select");
    parts.push("--mp4-real-time-decryption");
  } else if (task.format === "MKV") {
    parts.push("--auto-select");
    parts.push("--mkv-real-time-decryption");
  } else {
    parts.push("--auto-select");
  }
  if (task.threads) parts.push(`--thread-count ${task.threads}`);
  if (task.headers) {
    try {
      const h = JSON.parse(task.headers);
      Object.entries(h).forEach(([k, v]) => {
        if (k && v) parts.push(`--headers "${k}: ${v}"`);
      });
    } catch {
      task.headers.split("\n").forEach((l) => {
        const t = l.trim();
        if (t && t.includes(":")) parts.push(`--headers "${t}"`);
      });
    }
  }
  parts.push("--check-segments-count true");
  parts.push("--log-level info");
  return parts.join(" ");
}

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */

function getStatusBadge(status: TaskStatus) {
  switch (status) {
    case "DOWNLOADING":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] bg-amber-500/90 text-slate-950 px-2 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-900 animate-pulse" />
          下载中
        </span>
      );
    case "PAUSED":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] bg-slate-900/80 text-slate-200 px-2 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          已暂停
        </span>
      );
    case "COMPLETED":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-500/90 text-white px-2 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
          <CheckCircle2 className="w-3 h-3" />
          已完成
        </span>
      );
    case "PARSING":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] bg-sky-500/90 text-white px-2 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          解析中
        </span>
      );
    case "FAILED":
      return (
        <span className="inline-flex items-center gap-1 text-[10px] bg-rose-500/90 text-white px-2 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
          <AlertCircle className="w-3 h-3" />
          失败
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-[10px] bg-slate-900/70 text-slate-200 px-2 py-0.5 rounded font-mono font-bold backdrop-blur-sm">
          等待中
        </span>
      );
  }
}

/* ================================================================== */
/*  NewTaskModal                                                       */
/* ================================================================== */

interface NewTaskModalProps {
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
  }) => void;
  defaultSavePath: string;
  defaultFormat: "MP4" | "MKV" | "TS";
  defaultThreads: number;
}

const REFERER_PRESETS = [
  { name: "missav.ai", url: "https://missav.ai/", icon: "M" },
  { name: "supjav.com", url: "https://supjav.com/", icon: "S" },
];

function NewTaskModal({
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

  const handleSubmit = (e: React.FormEvent) => {
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
    onAddTask({
      name: finalName,
      url: url.trim(),
      format,
      headers: parseHeadersText(headersText),
      threads,
      savePath,
      coverUrl: coverUrl.trim() || undefined,
      previewUrl: previewUrl.trim() || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/20 flex justify-end">
      <div className="bg-white border-l border-slate-200 w-full max-w-[420px] text-slate-600 overflow-hidden shadow-2xl flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-2">
            <div className="bg-amber-100 p-2 rounded-lg border border-amber-200">
              <Plus className="w-4 h-4 text-amber-700" />
            </div>
            <div>
              <h3 className="text-xs font-bold font-sans text-slate-800 tracking-wider">
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
              快速设置 Referer 源
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
            <p className="text-[10px] text-black mt-1.5">
              点击选择 Referer 源，用于绕过防盗链验证
            </p>
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

                  {/* 线程数 & 输出格式 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-black font-semibold block mb-1">
                        下载线程数：{threads}
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={32}
                        value={threads}
                        onChange={(e) => setThreads(Number(e.target.value))}
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="text-black font-semibold block mb-1">
                        输出格式
                      </label>
                      <div className="flex gap-1">
                        {(["MP4", "MKV", "TS"] as const).map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setFormat(f)}
                            className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                              format === f
                                ? "border-amber-500 bg-amber-500 text-slate-950"
                                : "border-slate-200 bg-white text-slate-500 hover:border-amber-300"
                            }`}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Headers */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-black font-semibold">
                        定制 HTTP 协议头 (一行一个, 英文冒号分隔)
                      </label>
                      <span className="text-[10px] text-black font-mono">
                        User-Agent / Cookie / Origin
                      </span>
                    </div>
                    <textarea
                      value={headersText}
                      onChange={(e) => setHeadersText(e.target.value)}
                      rows={3}
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
                    <Shield className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
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
                core-engine-preview
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
                    <Copy className="w-3 h-3" /> copy
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
            className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-bold transition rounded-lg text-xs cursor-pointer"
          >
            创建任务
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  SettingsPanel                                                      */
/* ================================================================== */

interface SettingsPanelProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
  onClose: () => void;
}

function SettingsPanel({
  settings,
  onSaveSettings,
  onAddSystemLog,
  onClose,
}: SettingsPanelProps) {
  const [videoPath, setVideoPath] = useState(settings.video_path);
  const [tempPath, setTempPath] = useState(settings.temp_path);
  const [proxyUrl, setProxyUrl] = useState(settings.proxyUrl);
  const [showProxy, setShowProxy] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings({
      ...settings,
      video_path: videoPath,
      temp_path: tempPath,
      proxyUrl,
    });
    onAddSystemLog("Electron 核心: 系统配置已更新。", "SUCCESS");
  };

  const handleSelectFolder = async (
    setter: (val: string) => void,
    label: string,
    currentPath: string,
  ) => {
    try {
      const selected = await trpc.dialog.selectFolder.query({
        currentPath,
      });
      if (selected) {
        setter(selected);
        onAddSystemLog(`已将 [${label}] 路径设置为 ${selected}`, "SUCCESS");
      }
    } catch (err) {
      onAddSystemLog(`选择文件夹失败: ${err}`, "ERROR");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/20 flex items-center justify-center p-4 text-slate-600 font-sans">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Title */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-50 p-2 rounded-lg border border-indigo-100">
              <Cpu className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-sm font-sans font-extrabold text-slate-800 tracking-wider">
                系统核心配置
              </h2>
              <p className="text-[10px] text-black mt-0.5">
                配置 N_m3u8DL-RE 运行环境及本地媒体库路径
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

        <form
          onSubmit={handleSubmit}
          className="p-6 overflow-y-auto space-y-6 bg-white"
        >
          {/* Paths */}
          <div className="space-y-5">
            <h3 className="text-xs font-bold text-slate-700 border-l-2 border-amber-500 pl-2 tracking-wide">
              媒体存储路径
            </h3>

            <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-[11px] text-slate-500">
              <span className="font-bold text-amber-700">目录结构说明:</span>{" "}
              每个视频存放在独立子文件夹中，包含：
              <code className="ml-1 text-[10px] bg-white border border-amber-100 px-1.5 py-0.5 text-amber-700 font-mono rounded">
                video.mp4
              </code>
              <code className="ml-1 text-[10px] bg-white border border-amber-100 px-1.5 py-0.5 text-amber-700 font-mono rounded">
                cover.jpg
              </code>
              <code className="ml-1 text-[10px] bg-white border border-amber-100 px-1.5 py-0.5 text-amber-700 font-mono rounded">
                preview.mp4
              </code>
            </div>

            {/* Video Path */}
            <div>
              <label className="text-xs font-semibold text-black block mb-1.5">
                视频存放目录（子文件夹结构）
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={videoPath}
                  onChange={(e) => setVideoPath(e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 focus:outline-none focus:border-amber-500 transition"
                  placeholder="M:\video\videos\"
                />
                <button
                  type="button"
                  onClick={() =>
                    handleSelectFolder(setVideoPath, "视频目录", videoPath)
                  }
                  className="p-2 bg-white hover:bg-slate-50 rounded-lg border border-slate-200 transition cursor-pointer"
                >
                  <Folder className="w-3.5 h-3.5 text-amber-400" />
                </button>
              </div>
            </div>

            {/* Temp Path */}
            <div>
              <label className="text-xs font-semibold text-black block mb-1.5">
                下载临时目录
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tempPath}
                  onChange={(e) => setTempPath(e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 focus:outline-none focus:border-amber-500 transition"
                  placeholder="M:\video\temp\"
                />
                <button
                  type="button"
                  onClick={() =>
                    handleSelectFolder(setTempPath, "临时目录", tempPath)
                  }
                  className="p-2 bg-white hover:bg-slate-50 rounded-lg border border-slate-200 transition cursor-pointer"
                >
                  <Folder className="w-3.5 h-3.5 text-amber-400" />
                </button>
              </div>
            </div>
          </div>

          {/* Proxy */}
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setShowProxy(!showProxy)}
              className="flex items-center gap-2 text-xs font-bold text-slate-700 border-l-2 border-amber-500 pl-2 tracking-wide w-full text-left cursor-pointer"
            >
              {showProxy ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              网络与代理
              <span className="text-[10px] text-black font-normal">
                （可选）
              </span>
            </button>

            {showProxy && (
              <div className="pl-4 pt-2">
                <div>
                  <label className="text-xs font-semibold text-black block mb-1.5 flex items-center justify-between">
                    <span>代理服务器地址</span>
                    <span className="text-[10px] text-amber-400 font-semibold">
                      支持 HTTP/SOCKS5
                    </span>
                  </label>
                  <input
                    type="text"
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 focus:outline-none focus:border-amber-500 transition placeholder-slate-400"
                    placeholder="https://127.0.0.1:7890"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Warning */}
          <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-3">
            <AlertWarn className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-[11px] text-slate-500 leading-normal font-sans">
              <span className="font-extrabold text-amber-700">
                核心运行说明:
              </span>{" "}
              本系统通过封装{" "}
              <code className="text-[10px] bg-white border border-amber-100 px-1.5 py-0.5 text-amber-700 font-mono rounded font-bold mx-1">
                N_m3u8DL-RE
              </code>{" "}
              实现自动化流媒体处理。所有合并操作由工具原生完成，确保最高质量与稳定性。
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-500 border border-slate-200 transition rounded-lg text-xs font-semibold cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-6 py-2 bg-amber-500 hover:bg-amber-600 text-xs text-slate-950 font-bold rounded-lg shadow-sm transition cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              保存配置
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TaskCard                                                           */
/* ================================================================== */

interface TaskCardProps {
  task: DownloadTask;
  isSelected: boolean;
  copiedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onTriggerPauseResume: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onCopyCommand: (e: React.MouseEvent, task: DownloadTask) => void;
}

function TaskCard({
  task,
  isSelected,
  copiedTaskId,
  onSelectTask,
  onTriggerPauseResume,
  onDeleteTask,
  onCopyCommand,
}: TaskCardProps) {
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const handleEnter = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(true), 250);
  };

  const handleLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovered(false);
  };

  const handleVideoReady = () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      el.currentTime = 0;
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      /* noop */
    }
  };

  const showPreview = hovered && !!task.previewUrl;

  return (
    <div
      onClick={() => onSelectTask(task.id)}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className={`group relative flex flex-col bg-white rounded-xl border overflow-hidden cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${
        isSelected
          ? "border-amber-500 ring-2 ring-amber-500/30"
          : "border-slate-200 shadow-sm"
      }`}
    >
      {/* Cover / Preview */}
      <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
        {task.coverUrl || getCoverUrlFromName(task.name) ? (
          <img
            src={task.coverUrl || getCoverUrlFromName(task.name)}
            alt={task.name}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={(e) => {
              // 加载失败时隐藏图片，显示占位符
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
            <Film className="w-10 h-10 text-slate-600" />
          </div>
        )}

        {showPreview && (
          <video
            ref={videoRef}
            src={task.previewUrl}
            muted
            loop
            playsInline
            preload="auto"
            onLoadedData={handleVideoReady}
            className="absolute inset-0 w-full h-full object-cover animate-[fadeIn_0.3s_ease] bg-black"
          />
        )}

        <div className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />
        <div className="absolute top-2 left-2 z-10">
          {getStatusBadge(task.status)}
        </div>

        <div className="absolute top-2 right-2 z-10 flex gap-1">
          <span className="text-[9px] bg-black/60 text-white px-1.5 py-0.5 font-mono rounded backdrop-blur-sm">
            {task.format}
          </span>
          {task.resolution && (
            <span className="text-[9px] bg-black/60 text-amber-300 px-1.5 py-0.5 font-mono rounded backdrop-blur-sm">
              {task.resolution}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {task.status !== "COMPLETED" && (
          <div className="absolute bottom-0 left-0 right-0 z-10">
            {task.status === "DOWNLOADING" && (
              <div className="flex items-center justify-between px-2 pb-1 text-[9px] font-mono text-white drop-shadow">
                <span>{task.progress.toFixed(1)}%</span>
                <span>{formatSpeed(task.speed)}</span>
              </div>
            )}
            <div className="w-full bg-black/40 h-1">
              <div
                className="bg-gradient-to-r from-amber-400 to-amber-500 h-1 transition-all duration-300"
                style={{ width: `${task.progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Info + Actions */}
      <div className="flex flex-col gap-1.5 p-3">
        <div
          className="font-semibold text-[13px] text-slate-800 truncate group-hover:text-amber-700 transition-colors"
          title={task.name}
        >
          {task.name}
        </div>
        <div
          className="text-[10px] font-mono text-black truncate tracking-tight"
          title={task.url}
        >
          {task.url}
        </div>

        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-2 text-[10px] text-black font-mono min-w-0">
            <span className="truncate">
              {task.totalSize > 0
                ? `${formatBytes(task.downloadedSize)} / ${formatBytes(task.totalSize)}`
                : task.fileSize > 0
                  ? formatBytes(task.fileSize)
                  : "未知大小"}
            </span>
            {task.encryptionType && task.encryptionType !== "NONE" && (
              <span className="text-slate-500">* {task.encryptionType}</span>
            )}
          </div>

          <div
            className="flex items-center gap-1.5 text-black flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => onCopyCommand(e, task)}
              className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 hover:bg-amber-50 hover:text-amber-700 transition cursor-pointer"
              title="复制 N_m3u8DL-RE 调取指令"
            >
              {copiedTaskId === task.id ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>

            {task.status === "COMPLETED" ? (
              <button
                className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-emerald-600 hover:bg-emerald-50 transition cursor-pointer"
                title="已完成"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={() => onTriggerPauseResume(task.id)}
                className={`p-1.5 rounded-lg bg-slate-50 border border-slate-200 transition cursor-pointer ${
                  task.status === "DOWNLOADING"
                    ? "text-amber-600 hover:bg-amber-50"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                }`}
                title={task.status === "DOWNLOADING" ? "暂停下载" : "继续下载"}
                disabled={task.status === "FAILED"}
              >
                {task.status === "DOWNLOADING" ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-current" />
                )}
              </button>
            )}

            <button
              onClick={() => onDeleteTask(task.id)}
              className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
              title="删除任务"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  DownloadPage (main export)                                         */
/* ================================================================== */

export function DownloadPage({
  settings,
  onSettingsChange,
  onAddSystemLog,
}: DownloadPageProps) {
  /* ---- state ---- */
  const [tasks, setTasks] = useState<DownloadTask[]>(() => {
    try {
      const saved = localStorage.getItem("avplaypro_tasks_v4");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });
  const [logs, setLogs] = useState<LogMessage[]>(() => {
    try {
      const saved = localStorage.getItem("avplaypro_logs_v4");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeSubTab, setActiveSubTab] = useState<"console" | "metadata">(
    "console",
  );
  const [logFilter, setLogFilter] = useState<
    "ALL" | "INFO" | "SUCCESS" | "WARNING" | "ERROR"
  >("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedTaskCmd, setCopiedTaskCmd] = useState(false);

  const activeDownloadId = useRef<string | null>(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const scrollRef = useRef<HTMLDivElement>(null);

  /* ---- persist ---- */
  useEffect(() => {
    localStorage.setItem("avplaypro_tasks_v4", JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem("avplaypro_logs_v4", JSON.stringify(logs));
  }, [logs]);

  /* ---- auto-scroll ---- */
  useEffect(() => {
    if (autoScroll && scrollRef.current && activeSubTab === "console") {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, activeSubTab, autoScroll]);

  /* ---- helpers ---- */
  const addLog = useCallback(
    (
      text: string,
      level: "INFO" | "WARNING" | "SUCCESS" | "ERROR" = "INFO",
    ) => {
      const newLog: LogMessage = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString([], {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        level,
        text,
      };
      setLogs((prev) => [...prev, newLog]);
    },
    [],
  );

  /* ---- download progress listener (IPC 事件推送) ---- */
  useEffect(() => {
    let disposed = false;

    // 监听主进程推送的下载进度事件
    // 解析 N_m3u8DL-RE 输出中的速度和大小信息
    // 格式: "58/1591 3.65% 121.64MB/3.26GB 12.85MBps 00:04:41"
    const parseProgressInfo = (
      line: string,
    ): {
      percent: number | null;
      speed: number | null;
      downloadedSize: number | null;
      totalSize: number | null;
      downloadedSegments: number | null;
      totalSegments: number | null;
    } => {
      const result: {
        percent: number | null;
        speed: number | null;
        downloadedSize: number | null;
        totalSize: number | null;
        downloadedSegments: number | null;
        totalSegments: number | null;
      } = {
        percent: null,
        speed: null,
        downloadedSize: null,
        totalSize: null,
        downloadedSegments: null,
        totalSegments: null,
      };

      // 解析片段: "58/1591"
      const segMatch = line.match(/(\d+)\/(\d+)/);
      if (segMatch) {
        result.downloadedSegments = parseInt(segMatch[1]);
        result.totalSegments = parseInt(segMatch[2]);
      }

      // 解析百分比: "3.65%"
      const pctMatch = line.match(/(\d+\.?\d*)%/);
      if (pctMatch) {
        result.percent = parseFloat(pctMatch[1]);
      }

      // 解析大小: "121.64MB/3.26GB"
      const sizeMatch = line.match(
        /([\d.]+)\s*(B|KB|MB|GB|TB)\/([\d.]+)\s*(B|KB|MB|GB|TB)/,
      );
      if (sizeMatch) {
        result.downloadedSize = parseSizeToBytes(
          parseFloat(sizeMatch[1]),
          sizeMatch[2],
        );
        result.totalSize = parseSizeToBytes(
          parseFloat(sizeMatch[3]),
          sizeMatch[4],
        );
      }

      // 解析速度: "12.85MBps"
      const speedMatch = line.match(/([\d.]+)\s*(B|KB|MB|GB|TB)ps/);
      if (speedMatch) {
        result.speed = parseSizeToBytes(
          parseFloat(speedMatch[1]),
          speedMatch[2],
        );
      }

      return result;
    };

    const parseSizeToBytes = (value: number, unit: string): number => {
      const units: Record<string, number> = {
        B: 1,
        KB: 1024,
        MB: 1048576,
        GB: 1073741824,
        TB: 1099511627776,
      };
      return value * (units[unit] || 1);
    };

    const handleProgress = (
      _event: any,
      data: {
        line: string;
        percent: number | null;
        done: boolean;
        success: boolean;
      },
    ) => {
      if (disposed) return;
      const { line, percent, done, success } = data;
      const id = activeDownloadId.current;

      // 解析速度和大小
      const info = parseProgressInfo(line);

      // 如果有活动下载任务，更新任务日志
      if (id) {
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== id) return t;
            const taskLogs = line ? [...t.logs, line].slice(-200) : t.logs;
            if (done) {
              return {
                ...t,
                status: success ? "COMPLETED" : "FAILED",
                progress: success ? 100 : t.progress,
                speed: 0,
                logs: taskLogs,
              };
            }
            return {
              ...t,
              progress:
                info.percent != null
                  ? info.percent
                  : percent != null
                    ? percent
                    : t.progress,
              speed: info.speed != null ? info.speed : t.speed,
              downloadedSize:
                info.downloadedSize != null
                  ? info.downloadedSize
                  : t.downloadedSize,
              totalSize: info.totalSize != null ? info.totalSize : t.totalSize,
              downloadedSegments:
                info.downloadedSegments != null
                  ? info.downloadedSegments
                  : t.downloadedSegments,
              totalSegments:
                info.totalSegments != null
                  ? info.totalSegments
                  : t.totalSegments,
              logs: taskLogs,
            };
          }),
        );
      }

      // 封面/预览下载日志（没有活动任务时）显示到系统日志
      if (!id && line.includes("封面/预览")) {
        addLog(
          line,
          line.includes("✅")
            ? "SUCCESS"
            : line.includes("❌")
              ? "ERROR"
              : "INFO",
        );
      }

      // 下载完成处理
      if (done && id) {
        const finished = activeDownloadId.current;
        activeDownloadId.current = null;
        addLog(
          success
            ? "下载任务已完成并合并。"
            : `下载任务结束（任务 ${finished ?? ""}）。`,
          success ? "SUCCESS" : "WARNING",
        );

        // 下载完成后自动下载封面和预览
        if (success && finished) {
          const task = tasksRef.current.find((t) => t.id === finished);
          if (task) {
            // 从任务名提取番号（如 "TENN-046" 或 "SSIS-001"）
            const codeMatch = task.name.match(/[A-Z]{2,6}-\d{3,5}/i);
            const videoCode = codeMatch
              ? codeMatch[0].toUpperCase()
              : task.name.split(" ")[0];

            addLog(
              `正在下载封面和预览视频: ${task.name} (番号: ${videoCode})...`,
              "INFO",
            );
            const taskDir =
              task.savePath.replace(/[\/\\]$/, "") +
              "\\" +
              task.name.replace(/[\\/:*?"<>|]/g, "_");
            trpc.download.downloadCoverPreview.mutate({
              id: videoCode, // 使用番号而非 task.id
              name: task.name,
              saveDir: taskDir,
            });
          }
        }
      }
    };

    // 使用 IPC 事件监听（tRPC subscription 在 electron-trpc 中支持有限）
    const unlisten =
      window.electronAPI?.download?.onProgress?.(handleProgress) || (() => {});

    return () => {
      disposed = true;
      unlisten();
    };
  }, [addLog]);

  /* ---- add new task ---- */
  const handleAddNewTask = useCallback(
    (data: any) => {
      const newTask: DownloadTask = {
        id: `task-${Date.now()}`,
        name: data.name,
        url: data.url,
        status: "PENDING",
        progress: 0,
        speed: 0,
        totalSize: 0,
        downloadedSegments: 0,
        downloadedSize: 0,
        totalSegments: data.totalSegments || 100,
        fileSize: data.fileSize || 0,
        format: data.format,
        threads: data.threads,
        savePath: data.savePath,
        headers: data.headers,
        creationTime: new Date().toISOString(),
        encryptionType: data.encryptionType,
        resolution: data.resolution,
        coverUrl: data.coverUrl || undefined,
        previewUrl: data.previewUrl || undefined,
        logs: [`[系统] 任务已创建。目标地址: ${data.url}`],
      };

      setTasks((prev) => [newTask, ...prev]);
      setSelectedTaskId(newTask.id);
      addLog(
        `已添加新下载任务: ${newTask.name} | URL: ${newTask.url} | 格式: ${newTask.format} | 保存: ${newTask.savePath}`,
        "SUCCESS",
      );

      // auto-start
      setTimeout(() => {
        setTasks((prev) => {
          const task = prev.find((t) => t.id === newTask.id);
          if (task && task.status === "PENDING") {
            handleTriggerPauseResume(newTask.id);
          }
          return prev;
        });
      }, 800);
    },
    [addLog],
  );

  /* ---- pause / resume ---- */
  const handleTriggerPauseResume = useCallback(
    (id: string) => {
      // prevent duplicate: if another task is active, reject
      if (activeDownloadId.current && activeDownloadId.current !== id) {
        addLog(
          "⚠️ 已有其他下载任务在运行，请先停止当前任务再启动新任务",
          "WARNING",
        );
        return;
      }

      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const isResuming = t.status === "PAUSED" || t.status === "PENDING";

          if (isResuming) {
            // 只有当任务正在下载且 activeDownloadId 匹配时才跳过
            // 暂停的任务可以重新启动
            if (
              t.status === "DOWNLOADING" &&
              activeDownloadId.current === t.id
            ) {
              console.log("任务正在下载中，跳过重复启动");
              return t;
            }

            activeDownloadId.current = t.id;
            console.log(`[DownloadPage] 启动下载任务: ${t.id}`);

            // 每个任务创建独立文件夹: {savePath}/{任务名}/
            const taskDir =
              t.savePath.replace(/[\/\\]$/, "") +
              "\\" +
              t.name.replace(/[\\/:*?"<>|]/g, "_");

            trpc.download.start
              .mutate({
                url: t.url,
                saveDir: taskDir,
                saveName: "video", // 固定文件名为 video.mp4
                format: t.format,
                threads: t.threads,
                headers: t.headers,
                tmpDir: settings.temp_path,
              })
              .catch((err: any) => {
                addLog(`下载启动失败: ${err?.message || err}`, "ERROR");
                if (activeDownloadId.current === t.id) {
                  activeDownloadId.current = null;
                }
                setTasks((cur) =>
                  cur.map((x) =>
                    x.id === id ? { ...x, status: "FAILED" } : x,
                  ),
                );
              });
          } else if (t.status === "DOWNLOADING") {
            console.log(`[DownloadPage] 停止下载任务: ${t.id}`);
            trpc.download.stop.mutate();
            activeDownloadId.current = null;
          }

          return {
            ...t,
            status: isResuming ? "DOWNLOADING" : "PAUSED",
            logs: [
              ...t.logs,
              `[操作] 任务已${isResuming ? "开始/恢复" : "手动暂停"}。`,
            ],
          };
        }),
      );
    },
    [addLog, settings.temp_path],
  );

  /* ---- delete task ---- */
  const handleDeleteTask = useCallback(
    (id: string) => {
      const task = tasks.find((t) => t.id === id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      if (selectedTaskId === id) setSelectedTaskId(null);
      addLog(`🗑️ 任务已删除: ${task?.name || id}，临时文件已清理`, "WARNING");

      // 清理 temp 临时文件
      if (task) {
        trpc.download.cleanupTemp.mutate({
          saveDir: task.savePath,
          saveName: task.name,
          tmpDir: settings.temp_path,
        });
      }
    },
    [selectedTaskId, addLog, tasks, settings.temp_path],
  );

  /* ---- bulk actions ---- */
  const handleStartAll = useCallback(() => {
    setTasks((prev) =>
      prev.map((t) =>
        t.status === "PAUSED" || t.status === "PENDING"
          ? { ...t, status: "DOWNLOADING" }
          : t,
      ),
    );
    addLog("▶️ 操作: 已尝试启动全部队列中的待下载任务", "INFO");
  }, [addLog]);

  const handlePauseAll = useCallback(() => {
    setTasks((prev) =>
      prev.map((t) =>
        t.status === "DOWNLOADING" ? { ...t, status: "PAUSED" } : t,
      ),
    );
    addLog("⏸️ 操作: 已暂停全部活动下载任务", "WARNING");
  }, [addLog]);

  const handleClearCompleted = useCallback(() => {
    setTasks((prev) => {
      const completedCount = prev.filter(
        (t) => t.status === "COMPLETED",
      ).length;
      addLog(
        `🧹 操作: 已清理全部已完成的历史记录 (共 ${completedCount} 条)`,
        "INFO",
      );
      return prev.filter((t) => t.status !== "COMPLETED");
    });
  }, [addLog]);

  /* ---- copy command ---- */
  const handleCopyCommand = useCallback(
    (e: React.MouseEvent, task: DownloadTask) => {
      e.stopPropagation();
      const command = generateN3u8DLCommand(task);
      navigator.clipboard.writeText(command);
      setCopiedTaskId(task.id);
      addLog(`任务 [${task.name}] 的命令已复制到剪贴板。`, "SUCCESS");
      setTimeout(() => setCopiedTaskId(null), 2000);
    },
    [addLog],
  );

  /* ---- derived (必须在所有回调之前定义) ---- */
  const selectedTask: DownloadTask | null =
    tasks.find((t) => t.id === selectedTaskId) ?? null;
  const filteredTasks = tasks.filter(
    (t) =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.url.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleCopySelectedCommand = useCallback(() => {
    if (!selectedTask) return;
    const command = generateN3u8DLCommand(selectedTask);
    navigator.clipboard.writeText(command);
    setCopiedTaskCmd(true);
    addLog(`任务 [${selectedTask.name}] 的命令行参数已复制。`, "SUCCESS");
    setTimeout(() => setCopiedTaskCmd(false), 2000);
  }, [selectedTask, addLog]);

  /* ---- save settings ---- */
  const handleSaveSettings = useCallback(
    (newSettings: AppSettings) => {
      onSettingsChange(newSettings);
      setShowSettingsModal(false);
    },
    [onSettingsChange],
  );
  const filteredLogs = logs.filter((log) =>
    logFilter === "ALL" ? true : log.level === logFilter,
  );

  const getLogLevelColor = (level: string) => {
    switch (level) {
      case "SUCCESS":
        return "text-emerald-700";
      case "WARNING":
        return "text-amber-700 font-semibold";
      case "ERROR":
        return "text-rose-700 font-semibold";
      case "DEBUG":
        return "text-sky-700";
      default:
        return "text-slate-600";
    }
  };

  const getLogLevelLabel = (level: string) => {
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
  };

  /* ---- render ---- */
  return (
    <div className="h-full flex flex-col min-h-0">
      {/* ====== LEFT: Task List ====== */}
      <div className="flex-1 overflow-y-auto p-6 min-h-[200px] bg-[#f4f6f9]">
        {/* Queue Control Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-500">
              当前任务队列 ({tasks.length})
            </span>
            {tasks.filter((t) => t.status === "DOWNLOADING").length > 0 && (
              <span className="text-[10px] bg-amber-100 text-amber-700 rounded-full px-2.5 py-0.5 font-mono font-bold">
                {tasks.filter((t) => t.status === "DOWNLOADING").length}{" "}
                任务下载中
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative mr-2">
              <input
                type="text"
                placeholder="搜索任务/链接..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-40 sm:w-48 bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:w-56 focus:border-amber-500 transition-all font-sans shadow-sm"
              />
              <Search className="w-3.5 h-3.5 text-black absolute left-2.5 top-2.5" />
            </div>

            <button
              onClick={() => setShowNewTaskModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-xs text-slate-950 font-bold rounded-lg transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              新建任务
            </button>

            <button
              onClick={handleStartAll}
              className="px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-[11px] text-slate-600 font-semibold rounded-lg transition cursor-pointer"
            >
              全部开始
            </button>

            <button
              onClick={handlePauseAll}
              className="px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-[11px] text-slate-600 font-semibold rounded-lg transition cursor-pointer"
            >
              全部暂停
            </button>

            {tasks.some((t) => t.status === "COMPLETED") && (
              <button
                onClick={handleClearCompleted}
                className="px-2.5 py-1.5 bg-white hover:bg-rose-50 border border-rose-200 text-[11px] text-rose-600 font-semibold rounded-lg transition cursor-pointer"
                title="从列表中清空已完成任务"
              >
                清空已完成
              </button>
            )}

            <button
              onClick={() => setShowSettingsModal(true)}
              className="px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-[11px] text-slate-600 font-semibold rounded-lg transition cursor-pointer"
              title="系统设置"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Task Grid */}
        {filteredTasks.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm py-16 text-center text-black text-xs">
            <div className="flex flex-col items-center justify-center gap-3">
              <FileVideo className="w-8 h-8 text-slate-300" />
              <div>
                <p className="font-semibold text-slate-600">
                  {searchTerm ? "未找到符合搜索条件的项目" : "当前暂无活动任务"}
                </p>
                <p className="text-[10px] text-black mt-1">
                  {searchTerm
                    ? "试着更改关键字"
                    : '点击右上方 "+ 新建任务" 派发你的第一个 M3U8 下载流'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {filteredTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                isSelected={selectedTaskId === task.id}
                copiedTaskId={copiedTaskId}
                onSelectTask={setSelectedTaskId}
                onTriggerPauseResume={handleTriggerPauseResume}
                onDeleteTask={handleDeleteTask}
                onCopyCommand={handleCopyCommand}
              />
            ))}
          </div>
        )}
      </div>

      {/* ====== RIGHT: Diagnostics / Detail Panel ====== */}
      <div className="h-58 bg-white flex flex-col shrink-0 select-text border-t border-slate-200 text-slate-600 font-mono">
        {/* Sub-tabs header */}
        <div className="flex items-center justify-between gap-2 px-3 bg-slate-50 border-b border-slate-100 text-xs overflow-x-auto">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setActiveSubTab("console")}
              className={`flex items-center gap-1.5 px-4 py-2 border-b-2 text-xs transition font-semibold cursor-pointer whitespace-nowrap ${
                activeSubTab === "console"
                  ? "border-amber-500 text-slate-800 bg-white"
                  : "border-transparent text-black hover:text-slate-600"
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-amber-500" />
              控制台日志
            </button>

            <button
              onClick={() => setActiveSubTab("metadata")}
              className={`flex items-center gap-1.5 px-4 py-2 border-b-2 transition font-semibold cursor-pointer whitespace-nowrap ${
                activeSubTab === "metadata"
                  ? "border-amber-500 text-slate-800 bg-white"
                  : "border-transparent text-black hover:text-slate-600"
              }`}
            >
              <Code className="w-3.5 h-3.5 text-sky-500" />
              选中详情
            </button>
          </div>

          <div className="flex items-center gap-2.5 text-[10px] shrink-0">
            {activeSubTab === "console" ? (
              <>
                <div className="flex items-center gap-1 bg-white px-2 py-0.5 rounded-lg border border-slate-200">
                  <span className="text-black">过滤:</span>
                  <select
                    value={logFilter}
                    onChange={(e) =>
                      setLogFilter(e.target.value as typeof logFilter)
                    }
                    className="bg-transparent text-slate-600 focus:outline-none cursor-pointer font-sans"
                  >
                    <option value="ALL">全部</option>
                    <option value="INFO">消息</option>
                    <option value="SUCCESS">成功</option>
                    <option value="WARNING">警告</option>
                    <option value="ERROR">错误</option>
                  </select>
                </div>

                <label className="flex items-center gap-1.5 text-black cursor-pointer">
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
                  className="p-1.5 rounded-lg text-black hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                  title="清空当前日志显示"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              selectedTask && (
                <span className="text-[10px] bg-white text-slate-500 px-2.5 py-0.5 rounded-full select-none border border-slate-200 font-mono">
                  当前任务 ID: {selectedTask.id}
                </span>
              )
            )}
          </div>
        </div>

        {/* Panel body */}
        <div className="flex flex-1 overflow-y-auto bg-white relative">
          {/* Console logs */}
          {activeSubTab === "console" && (
            <div
              ref={scrollRef}
              className="h-full flex-1 overflow-y-auto space-y-1 text-[10.5px] leading-relaxed select-text bg-[#f6f8fa] p-4"
            >
              {filteredLogs.length === 0 ? (
                <div className="text-black text-center py-6">
                  暂无诊断消息。执行下载操作时，日志数据将在此实时刷新。
                </div>
              ) : (
                filteredLogs.map((log, index) => (
                  <div
                    key={log.id + index}
                    className="flex gap-2.5 items-start font-mono"
                  >
                    <span className="text-black font-extralight shrink-0">
                      [{log.timestamp}]
                    </span>
                    <span className="text-black text-[10px] bg-white border border-slate-200 px-1.5 rounded select-none shrink-0">
                      {getLogLevelLabel(log.level)}
                    </span>
                    <span
                      className={`${getLogLevelColor(log.level)} break-all`}
                    >
                      {log.text}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Metadata detail */}
          {activeSubTab === "metadata" && (
            <div className="h-full overflow-y-auto space-y-3 text-xs p-4">
              {selectedTask ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2 text-slate-600">
                    <div>
                      <span className="text-black">视频名称:</span>{" "}
                      <span className="text-slate-600 font-bold">
                        {selectedTask.name}
                      </span>
                    </div>
                    <div className="break-all">
                      <span className="text-black">HLS 请求地址:</span>{" "}
                      <span className="text-amber-700 text-[11px] focus:select-all font-mono">
                        {selectedTask.url}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-black">合并文件格式:</span>{" "}
                        <span className="text-emerald-700 font-bold ml-1">
                          {selectedTask.format}
                        </span>
                      </div>
                      <div>
                        <span className="text-black">下载速度:</span>{" "}
                        <span className="text-amber-700 font-bold ml-1">
                          {formatSpeed(selectedTask.speed)}
                        </span>
                      </div>
                      <div>
                        <span className="text-black">文件大小:</span>{" "}
                        <span className="text-amber-700 font-bold ml-1">
                          {selectedTask.totalSize > 0
                            ? `${formatBytes(selectedTask.downloadedSize)} / ${formatBytes(selectedTask.totalSize)}`
                            : selectedTask.fileSize > 0
                              ? formatBytes(selectedTask.fileSize)
                              : "计算中..."}
                        </span>
                      </div>
                      <div>
                        <span className="text-black">片段进度:</span>{" "}
                        <span className="text-emerald-700 font-bold ml-1">
                          {selectedTask.downloadedSegments > 0 &&
                          selectedTask.totalSegments > 0
                            ? `${selectedTask.downloadedSegments} / ${selectedTask.totalSegments}`
                            : `${selectedTask.progress.toFixed(1)}%`}
                        </span>
                      </div>
                      <div>
                        <span className="text-black">流加密类型:</span>{" "}
                        <span className="text-purple-700 font-bold ml-1">
                          {selectedTask.encryptionType === "NONE"
                            ? "未加密"
                            : selectedTask.encryptionType || "AES-128"}
                        </span>
                      </div>
                      <div>
                        <span className="text-black">视频流质量:</span>{" "}
                        <span className="text-sky-700 font-bold ml-1">
                          {selectedTask.resolution || "1080p 自适应"}
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-black">持久保存目录:</span>{" "}
                      <span className="text-slate-600 text-[11px] font-mono select-all bg-slate-50 p-1 px-2 rounded-lg inline-block mt-1 border border-slate-200">
                        {selectedTask.savePath}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 bg-slate-50 border border-slate-200 p-4 rounded-xl flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-slate-600 font-sans font-bold text-[10px] flex items-center gap-1.5">
                          <Shield className="w-3.5 h-3.5 text-amber-600" />
                          N_m3u8DL-RE 运行命令封装
                        </span>
                        <button
                          onClick={handleCopySelectedCommand}
                          className="flex items-center gap-1 px-2.5 py-1 bg-white text-amber-700 hover:text-amber-800 rounded-md border border-slate-200 hover:bg-amber-50 transition font-sans text-[10px] cursor-pointer"
                          title="复制终端命令"
                        >
                          {copiedTaskCmd ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              已复制!
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              复制
                            </>
                          )}
                        </button>
                      </div>
                      <p className="text-[10px] leading-relaxed text-black font-sans">
                        可以拷贝此参数字符串在本地桌面安装了 N_m3u8DL-RE &
                        FFmpeg 的终端中执行，效果等同：
                      </p>
                    </div>
                    <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 text-[10px] font-mono text-amber-700 select-all break-all overflow-y-auto max-h-[70px]">
                      {generateN3u8DLCommand(selectedTask)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-black text-center p-4">
                  未选中任何下载任务，请在列表轻点一个任务项目以查看其全栈流元数据信息。
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ====== Modals ====== */}
      {showNewTaskModal && (
        <NewTaskModal
          onClose={() => setShowNewTaskModal(false)}
          onAddTask={handleAddNewTask}
          defaultSavePath={settings.video_path}
          defaultFormat={settings.defaultFormat}
          defaultThreads={settings.defaultThreads}
        />
      )}

      {showSettingsModal && (
        <SettingsPanel
          settings={settings}
          onSaveSettings={handleSaveSettings}
          onAddSystemLog={onAddSystemLog}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
}
