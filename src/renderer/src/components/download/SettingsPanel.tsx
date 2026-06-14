import React, { useEffect, useState } from "react";
import {
  X,
  Folder,
  Save,
  Cpu,
  Globe,
  Settings as SettingsIcon,
  Download,
  Info,
} from "lucide-react";
import { trpc } from "../../lib/trpc";
import type {
  AppSettings,
  CloseAction,
  DownloadBackground,
  LoaderStyle,
  ThemeMode,
} from "../../pages/download/types";
import { CoverLoader } from "../CoverLoader";

type TabKey = "storage" | "network" | "appearance";
const DOWNLOAD_BACKGROUNDS: DownloadBackground[] = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
];
const LOADER_STYLES: Array<{ v: LoaderStyle; l: string }> = [
  { v: "eq", l: "均衡器" },
  { v: "vinyl", l: "黑胶" },
  { v: "wave", l: "声波" },
  { v: "radar", l: "雷达" },
  { v: "prism", l: "棱镜" },
  { v: "matrix", l: "矩阵" },
  { v: "orbit", l: "星轨" },
  { v: "pulse", l: "脉冲" },
  { v: "scan", l: "扫描" },
];

function normalizeLoaderStyle(value: unknown): LoaderStyle {
  return LOADER_STYLES.some((item) => item.v === value)
    ? (value as LoaderStyle)
    : "eq";
}

export interface SettingsPanelProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
  onClose: () => void;
}

export function SettingsPanel({
  settings,
  onSaveSettings,
  onAddSystemLog,
  onClose,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("storage");
  const [videoPath, setVideoPath] = useState(settings.video_path);
  const [tempPath, setTempPath] = useState(settings.temp_path);
  const [proxyUrl, setProxyUrl] = useState(settings.proxyUrl);
  const [proxyEnabled, setProxyEnabled] = useState(!!settings.proxyUrl?.trim());
  const [speedLimit, setSpeedLimit] = useState(settings.globalSpeedLimit || "");
  const [isInstallingExtension, setIsInstallingExtension] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(settings.theme);
  const [closeAction, setCloseAction] = useState<CloseAction>(
    settings.closeAction,
  );
  const [notifyOnComplete, setNotifyOnComplete] = useState(
    settings.notifyOnComplete,
  );
  const [notifySound, setNotifySound] = useState(settings.notifySound);
  const [loaderStyle, setLoaderStyle] = useState<LoaderStyle>(
    normalizeLoaderStyle(settings.loaderStyle),
  );
  const [downloadBackground, setDownloadBackground] =
    useState<DownloadBackground>(settings.downloadBackground ?? "1");
  const [privacyScreenEnabled, setPrivacyScreenEnabled] = useState(
    settings.privacyScreenEnabled ?? true,
  );
  const [privacyScreenIdleSeconds, setPrivacyScreenIdleSeconds] = useState(
    settings.privacyScreenIdleSeconds ?? 60,
  );
  const [privacyScreenOnBlur, setPrivacyScreenOnBlur] = useState(
    settings.privacyScreenOnBlur ?? true,
  );
  const [privacyScreenBlur, setPrivacyScreenBlur] = useState(
    settings.privacyScreenBlur ?? 8,
  );
  const [privacyScreenImageOpacity, setPrivacyScreenImageOpacity] = useState(
    settings.privacyScreenImageOpacity ?? 42,
  );
  const [privacyScreenChangeSeconds, setPrivacyScreenChangeSeconds] = useState(
    settings.privacyScreenChangeSeconds ?? 10,
  );
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(
    settings.maxConcurrentTasks ?? 3,
  );
  const [thumbQueueConcurrency, setThumbQueueConcurrency] = useState(
    settings.thumbQueueConcurrency ?? 2,
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings({
      ...settings,
      video_path: videoPath,
      temp_path: tempPath,
      proxyUrl: proxyEnabled ? proxyUrl : "",
      globalSpeedLimit: speedLimit.trim(),
      theme,
      closeAction,
      notifyOnComplete,
      notifySound,
      loaderStyle,
      downloadBackground,
      privacyScreenEnabled,
      privacyScreenIdleSeconds,
      privacyScreenOnBlur,
      privacyScreenBlur,
      privacyScreenImageOpacity,
      privacyScreenChangeSeconds,
      maxConcurrentTasks: Math.max(1, Math.min(20, maxConcurrentTasks || 1)),
      thumbQueueConcurrency: Math.max(1, Math.min(8, thumbQueueConcurrency || 1)),
    });
    onAddSystemLog("Electron 核心: 系统配置已更新。", "SUCCESS");
  };

  const handleSelectFolder = async (
    setter: (val: string) => void,
    label: string,
    currentPath: string,
  ) => {
    try {
      const selected = await trpc.dialog.selectFolder.query({ currentPath });
      if (selected) {
        setter(selected);
        onAddSystemLog(`已将 [${label}] 路径设置为 ${selected}`, "SUCCESS");
      }
    } catch (err) {
      onAddSystemLog(`选择文件夹失败: ${err}`, "ERROR");
    }
  };

  const handleInstallChromeExtension = async () => {
    setIsInstallingExtension(true);
    try {
      const result = await trpc.extension.installToChrome.mutate({});
      if (!result.success) throw new Error("Chrome extension import failed");
      onAddSystemLog(
        `已打开 Chrome 扩展页，并复制插件路径: ${result.extensionPath}`,
        "SUCCESS",
      );
      onAddSystemLog(
        "插件路径已复制，进入扩展页后打开开发者模式并加载已解压的扩展程序。",
        "INFO",
      );
      await trpc.window.focus.mutate();
      await new Promise((r) => setTimeout(r, 150));
      window.alert(
        "已进入 Chrome 扩展页面。\n\n请点击左上角的“加载已解压的扩展程序”按钮。\n\n插件目录路径已经复制到剪贴板，选择文件夹时直接粘贴即可。",
      );
    } catch (err: any) {
      onAddSystemLog(`导入 Chrome 插件失败: ${err?.message || err}`, "ERROR");
    } finally {
      setIsInstallingExtension(false);
    }
  };

  const tabs: Array<{ key: TabKey; label: string; icon: typeof Folder }> = [
    { key: "storage", label: "存储路径", icon: Folder },
    { key: "network", label: "网络与插件", icon: Globe },
    { key: "appearance", label: "个性化与通知", icon: SettingsIcon },
  ];

  const tabBtnClass = (active: boolean) =>
    `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
      active
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold"
        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100/50 dark:hover:bg-slate-800/50"
    }`;

  const segBtnClass = (active: boolean) =>
    `px-3 py-2 text-[11px] font-bold rounded-lg border transition cursor-pointer ${
      active
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
    }`;

  const Toggle = ({
    on,
    onToggle,
  }: {
    on: boolean;
    onToggle: () => void;
  }) => (
    <button
      type="button"
      onClick={onToggle}
      className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${
        on ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-700"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
          on ? "translate-x-4" : ""
        }`}
      />
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 anim-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col h-[600px] anim-scale-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500/10 dark:bg-amber-500/20 p-2.5 rounded-xl border border-amber-500/20">
              <Cpu className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 tracking-wide">
                系统核心配置
              </h2>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                配置运行环境及本地媒体库路径
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 bg-slate-50/50 dark:bg-slate-900/50 border-r border-slate-100 dark:border-slate-800 p-3 flex flex-col gap-1 shrink-0">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={tabBtnClass(activeTab === key)}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto bg-white dark:bg-slate-900">
            {activeTab === "storage" && (
              <div className="space-y-5">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 tracking-wide uppercase">
                    媒体存储路径
                  </h3>
                </div>

                <div className="p-3.5 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/10 rounded-xl text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  <span className="font-bold text-amber-700 dark:text-amber-400">
                    目录结构说明:
                  </span>{" "}
                  每个视频存放在独立子文件夹中，包含以下文件：
                  <div className="flex gap-1.5 mt-2">
                    {["video.mp4", "cover.jpg", "preview.mp4"].map((f) => (
                      <code
                        key={f}
                        className="text-[10px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-amber-700 dark:text-amber-400 font-mono rounded"
                      >
                        {f}
                      </code>
                    ))}
                  </div>
                </div>

                <PathInput
                  label="视频存放目录 (子文件夹结构)"
                  value={videoPath}
                  onChange={setVideoPath}
                  onPick={() =>
                    handleSelectFolder(setVideoPath, "视频目录", videoPath)
                  }
                />
                <PathInput
                  label="下载临时目录"
                  value={tempPath}
                  onChange={setTempPath}
                  onPick={() =>
                    handleSelectFolder(setTempPath, "临时目录", tempPath)
                  }
                />
              </div>
            )}

            {activeTab === "network" && (
              <div className="space-y-5">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 tracking-wide uppercase">
                    网络与插件
                  </h3>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800/80 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        启用网络代理
                      </h4>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                        支持 HTTP / HTTPS / SOCKS5 协议
                      </p>
                    </div>
                    <Toggle
                      on={proxyEnabled}
                      onToggle={() => setProxyEnabled(!proxyEnabled)}
                    />
                  </div>
                  {proxyEnabled && (
                    <div className="pt-1.5">
                      <input
                        type="text"
                        value={proxyUrl}
                        onChange={(e) => setProxyUrl(e.target.value)}
                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-300 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
                        placeholder="http://127.0.0.1:7890"
                      />
                    </div>
                  )}
                </div>

                {/* 下载速度限制 */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800/80 rounded-xl space-y-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      全局下载速度限制
                    </h4>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                      传给 N_m3u8DL-RE 的 <code className="font-mono">--max-speed</code> 参数。空 = 不限速。
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={speedLimit}
                      onChange={(e) => setSpeedLimit(e.target.value)}
                      placeholder="例: 5M / 512K / 留空不限速"
                      className="flex-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-300 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
                    />
                    {["", "1M", "5M", "10M"].map((preset) => (
                      <button
                        key={preset || "off"}
                        type="button"
                        onClick={() => setSpeedLimit(preset)}
                        className={`px-2.5 text-[10px] font-bold rounded-lg border transition cursor-pointer ${
                          speedLimit === preset
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                        }`}
                      >
                        {preset || "不限"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 并发下载数 */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800/80 rounded-xl space-y-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      最大并发下载数
                    </h4>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                      关闭"队列下载"后，同时下载的任务数上限。建议 2–4，过高会占带宽与磁盘 IO。
                    </p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={maxConcurrentTasks}
                      onChange={(e) =>
                        setMaxConcurrentTasks(parseInt(e.target.value) || 1)
                      }
                      className="w-24 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-300 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
                    />
                    {[1, 2, 3, 5, 8].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setMaxConcurrentTasks(preset)}
                        className={`px-2.5 py-2 text-[10px] font-bold rounded-lg border transition cursor-pointer ${
                          maxConcurrentTasks === preset
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 刻度图修复并发数 */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800/80 rounded-xl space-y-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      刻度图修复并发数
                    </h4>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                      后台同时跑几个刻度图生成任务。每个任务都要解码视频，太高会占 CPU/GPU 导致播放卡顿。建议 2–3。
                    </p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={thumbQueueConcurrency}
                      onChange={(e) =>
                        setThumbQueueConcurrency(parseInt(e.target.value) || 1)
                      }
                      className="w-24 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-300 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
                    />
                    {[1, 2, 3, 4, 6].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setThumbQueueConcurrency(preset)}
                        className={`px-2.5 py-2 text-[10px] font-bold rounded-lg border transition cursor-pointer ${
                          thumbQueueConcurrency === preset
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800/80 rounded-xl flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      M3U8 自动嗅探插件
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 leading-relaxed">
                      协助在 Chrome / Edge 中无缝抓包及嗅探流媒体地址。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleInstallChromeExtension}
                    disabled={isInstallingExtension}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-500/10 text-xs text-amber-700 dark:text-amber-400 border border-slate-200 dark:border-slate-700 hover:border-amber-200 disabled:opacity-60 disabled:cursor-not-allowed font-bold rounded-lg transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {isInstallingExtension ? "打开中..." : "导入向导"}
                  </button>
                </div>
              </div>
            )}

            {activeTab === "appearance" && (
              <div className="space-y-5">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 tracking-wide uppercase">
                    外观与提示
                  </h3>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">
                    界面主题样式
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { v: "system", l: "跟随系统" },
                        { v: "light", l: "浅色" },
                        { v: "dark", l: "深色" },
                      ] as Array<{ v: ThemeMode; l: string }>
                    ).map(({ v, l }) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setTheme(v)}
                        className={segBtnClass(theme === v)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">
                    隐私屏保
                  </label>
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800/80 rounded-xl">
                    <div>
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        自动遮挡下载内容
                      </div>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                        空闲或窗口失焦时使用屏保遮住任务名、封面和路径
                      </p>
                    </div>
                    <Toggle
                      on={privacyScreenEnabled}
                      onToggle={() =>
                        setPrivacyScreenEnabled(!privacyScreenEnabled)
                      }
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {DOWNLOAD_BACKGROUNDS.map((bg) => (
                      <button
                        key={bg}
                        type="button"
                        onClick={() => setDownloadBackground(bg)}
                        className={`relative aspect-video overflow-hidden rounded-lg border transition cursor-pointer ${
                          downloadBackground === bg
                            ? "border-amber-500/50 ring-2 ring-amber-500/30"
                            : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                        }`}
                        title={`背景 ${bg}`}
                      >
                        <img
                          src={`./${bg}.webp`}
                          alt={`背景 ${bg}`}
                          className="h-full w-full object-cover"
                        />
                        <span
                          className={`absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-mono text-white backdrop-blur-sm ${
                            downloadBackground === bg ? "bg-amber-500/90" : ""
                          }`}
                        >
                          {bg}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="space-y-2 pt-2">
                    <NumberControl
                      label="空闲触发"
                      value={privacyScreenIdleSeconds}
                      min={5}
                      max={300}
                      step={5}
                      suffix="s"
                      onChange={setPrivacyScreenIdleSeconds}
                    />
                    <NumberControl
                      label="模糊强度"
                      value={privacyScreenBlur}
                      min={0}
                      max={32}
                      step={1}
                      suffix="px"
                      onChange={setPrivacyScreenBlur}
                    />
                    <NumberControl
                      label="图片透明度"
                      value={privacyScreenImageOpacity}
                      min={0}
                      max={100}
                      step={1}
                      suffix="%"
                      onChange={setPrivacyScreenImageOpacity}
                    />
                    <NumberControl
                      label="切图间隔"
                      value={privacyScreenChangeSeconds}
                      min={3}
                      max={60}
                      step={1}
                      suffix="s"
                      onChange={setPrivacyScreenChangeSeconds}
                    />
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-3">
                    <div className="flex min-w-38 items-center justify-between gap-3 rounded-lg border border-slate-200/70 dark:border-slate-800 bg-white/75 dark:bg-slate-900/75 px-3 py-2">
                      <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400">
                        失焦触发
                      </span>
                      <Toggle
                        on={privacyScreenOnBlur}
                        onToggle={() =>
                          setPrivacyScreenOnBlur(!privacyScreenOnBlur)
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">
                    关闭主窗口行为
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { v: "ask", l: "每次询问" },
                        { v: "tray", l: "最小化到托盘" },
                        { v: "quit", l: "彻底退出" },
                      ] as Array<{ v: CloseAction; l: string }>
                    ).map(({ v, l }) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setCloseAction(v)}
                        className={segBtnClass(closeAction === v)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">
                    封面加载动画
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {LOADER_STYLES.map(({ v, l }) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setLoaderStyle(v)}
                        className={`relative overflow-hidden rounded-lg border transition cursor-pointer ${
                          loaderStyle === v
                            ? "border-amber-500/40 ring-1 ring-amber-500/30"
                            : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                        }`}
                      >
                        <div className="relative w-full h-16 bg-slate-900">
                          <CoverLoader variant={v} />
                        </div>
                        <div
                          className={`px-2 py-1 text-[10px] font-bold text-center ${
                            loaderStyle === v
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                              : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          {l}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800/80 rounded-xl">
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      下载状态系统通知
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                      任务完成或失败时通过系统横幅通知
                    </p>
                  </div>
                  <Toggle
                    on={notifyOnComplete}
                    onToggle={() => setNotifyOnComplete(!notifyOnComplete)}
                  />
                </div>

                <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800/80 rounded-xl">
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      完成声音提醒
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                      下载任务结束时播放 assets/tips.mp3
                    </p>
                  </div>
                  <Toggle
                    on={notifySound}
                    onToggle={() => setNotifySound(!notifySound)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500">
            <Info className="w-4 h-4" />
            <span className="text-[10px]">基于 N_m3u8DL-RE 流媒体核心引擎</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition rounded-lg text-xs font-semibold cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-xs text-white font-bold rounded-lg shadow-sm shadow-amber-500/10 transition cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              保存配置
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function PathInput({
  label,
  value,
  onChange,
  onPick,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onPick: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-300 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition"
          placeholder="请输入路径..."
        />
        <button
          type="button"
          onClick={onPick}
          className="px-3 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition cursor-pointer flex items-center justify-center"
        >
          <Folder className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        </button>
      </div>
    </div>
  );
}

function NumberControl({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const [draftValue, setDraftValue] = useState(value);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  const safeValue = clamp(draftValue);
  const commit = (next: number) => {
    const clamped = clamp(next);
    setDraftValue(clamped);
    onChange(clamped);
  };
  const commitDraft = () => commit(safeValue);

  return (
    <div className="rounded-lg border border-slate-200/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 px-3 py-2.5">
      <div className="grid grid-cols-[84px_32px_1fr_32px] items-center gap-2">
        <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
          {label}
        </span>
        <button
          type="button"
          onClick={() => commit(safeValue - step)}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-bold text-slate-600 dark:text-slate-300 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-500/10 transition"
          aria-label={`${label} 减少`}
        >
          -
        </button>
        <div className="relative">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={safeValue}
            onChange={(e) => setDraftValue(clamp(Number(e.target.value || min)))}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitDraft();
                e.currentTarget.blur();
              }
            }}
            className="h-8 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 pr-9 text-center font-mono text-[12px] font-semibold text-slate-700 dark:text-slate-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">
            {suffix}
          </span>
        </div>
        <button
          type="button"
          onClick={() => commit(safeValue + step)}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-bold text-slate-600 dark:text-slate-300 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-500/10 transition"
          aria-label={`${label} 增加`}
        >
          +
        </button>
      </div>
    </div>
  );
}
