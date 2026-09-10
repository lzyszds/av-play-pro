import React, { useEffect, useRef, useState } from "react";
import { Tooltip } from "../common/Tooltip";
import { Button } from "../common/Button";
import { Toggle as ToggleSwitch } from "../common/Toggle";
import { NumberControl } from "../common/NumberControl";
import {
  X,
  Folder,
  Save,
  Cpu,
  Globe,
  Palette,
  Bell,
  Download,
  Info,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Cloud,
  UploadCloud,
  DownloadCloud,
  Key,
  RefreshCw,
  Eye,
  EyeOff,
  ShieldCheck,
  Database,
  Check,
  Heart,
  Archive,
  GitCompareArrows,
  FlaskConical,
  ArrowUp,
  ArrowDown,
  MinusCircle,
  PlusCircle,
  CheckCheck,
  Trophy,
} from "lucide-react";
import { trpc } from "../../lib/trpc";
import { wallpaperThumbUrl } from "../../lib/wallpaper";
import type {
  AppSettings,
  CloseAction,
  DownloadBackground,
  LoaderStyle,
  PlayerLayout,
  ThemeMode,
} from "../../pages/download/types";
import { CoverLoader } from "../CoverLoader";
import { SnapshotLibraryModal } from "./SnapshotLibraryModal";

type TabKey =
  "storage" | "network" | "appearance" | "notification" | "health" | "sync";
const DOWNLOAD_BACKGROUNDS: DownloadBackground[] = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
];
// 选择卡片 / 实时预览只需极低分辨率：原图 3840~6000px 的整幅壁纸缩到 100px 卡片
// 仍会被浏览器全量解码（单张 20MP+ 位图），统一走 wallpaper.ts 的缩略档（1280px）
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
  const [playerLayout, setPlayerLayout] = useState<PlayerLayout>(
    settings.playerLayout ?? "classic",
  );
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
  const [privacyImageMode, setPrivacyImageMode] = useState(
    settings.privacyImageMode ?? false,
  );
  const [autoArousalOnPlay, setAutoArousalOnPlay] = useState(
    settings.autoArousalOnPlay ?? true,
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
  const [downloadBgVisible, setDownloadBgVisible] = useState(
    settings.downloadBgVisible ?? true,
  );
  const [downloadBgOpacity, setDownloadBgOpacity] = useState(
    settings.downloadBgOpacity ?? 42,
  );
  const [downloadBgDim, setDownloadBgDim] = useState(
    settings.downloadBgDim ?? 0,
  );
  const [achievementToast, setAchievementToast] = useState(
    settings.achievementToast ?? true,
  );
  const [uiZoom, setUiZoom] = useState(settings.uiZoom ?? 100);
  const [maxConcurrentTasks, setMaxConcurrentTasks] = useState(
    settings.maxConcurrentTasks ?? 3,
  );
  const [thumbQueueConcurrency, setThumbQueueConcurrency] = useState(
    settings.thumbQueueConcurrency ?? 2,
  );
  const [health, setHealth] = useState<any | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const loadHealth = async () => {
    setHealthLoading(true);
    try {
      const data = await trpc.library.health.query({
        rootPath: videoPath,
        tempPath,
      });
      setHealth(data);
    } catch (err: any) {
      onAddSystemLog(`健康状态读取失败: ${err?.message || err}`, "ERROR");
    } finally {
      setHealthLoading(false);
    }
  };

  const openHealthPath = async (targetPath: string) => {
    if (
      !targetPath ||
      targetPath.includes("不存在") ||
      targetPath.includes("无法读取")
    )
      return;
    try {
      const res = await trpc.system.openPath.mutate({ path: targetPath });
      if (!res.success) {
        onAddSystemLog(`打开路径失败: ${res.error || targetPath}`, "ERROR");
      }
    } catch (err: any) {
      onAddSystemLog(`打开路径异常: ${err?.message || err}`, "ERROR");
    }
  };

  const [cloudSyncEndpoint, setCloudSyncEndpoint] = useState(
    settings.cloudSyncEndpoint || "https://avplay-sync.1024327189.workers.dev",
  );
  const [cloudSyncSecret, setCloudSyncSecret] = useState(
    settings.cloudSyncSecret || "MySecretToken_2026",
  );
  const [cloudSyncAutoSync, setCloudSyncAutoSync] = useState(
    settings.cloudSyncAutoSync ?? true,
  );
  const [cloudSyncLastSync, setCloudSyncLastSync] = useState(
    settings.cloudSyncLastSync || "",
  );
  const [newsEndpoint, setNewsEndpoint] = useState(settings.newsEndpoint || "");
  const [newsApiKey, setNewsApiKey] = useState(settings.newsApiKey || "");

  useEffect(() => {
    if (settings.cloudSyncLastSync) {
      setCloudSyncLastSync(settings.cloudSyncLastSync);
    }
  }, [settings.cloudSyncLastSync]);

  useEffect(() => {
    if (settings.cloudSyncAutoSync !== undefined) {
      setCloudSyncAutoSync(settings.cloudSyncAutoSync);
    }
  }, [settings.cloudSyncAutoSync]);
  // 鉴权密钥明文直接显示，无需遮掩
  const [showSecret, setShowSecret] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [confirmPull, setConfirmPull] = useState(false);
  const [showSnapshotLibrary, setShowSnapshotLibrary] = useState(false);
  const [syncDiff, setSyncDiff] = useState<any | null>(null);
  const [syncDiffLoading, setSyncDiffLoading] = useState(false);
  const [syncDiffError, setSyncDiffError] = useState("");

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await trpc.sync.testConnection.mutate({
        endpoint: cloudSyncEndpoint,
        secretKey: cloudSyncSecret,
      });
      if (res.success) {
        setTestResult({
          success: true,
          message: `连接成功 (延迟 ${res.latencyMs}ms)`,
        });
        onAddSystemLog(
          `Cloudflare Worker 连通正常，延迟: ${res.latencyMs}ms`,
          "SUCCESS",
        );
      } else {
        setTestResult({
          success: false,
          message: res.error || "连接测试失败",
        });
        onAddSystemLog(`Cloudflare Worker 连通失败: ${res.error}`, "ERROR");
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || String(err),
      });
      onAddSystemLog(`云同步测试异常: ${err?.message || err}`, "ERROR");
    } finally {
      setTestingConnection(false);
    }
  };

  const handlePushToCloud = async () => {
    if (!cloudSyncSecret.trim()) {
      setPushResult({
        success: false,
        message: "请先输入访问密码 (SYNC_SECRET)",
      });
      return;
    }
    setPushing(true);
    setPushResult(null);
    try {
      const res = await trpc.sync.pushToCloud.mutate({
        endpoint: cloudSyncEndpoint,
        secretKey: cloudSyncSecret,
      });
      if (res.success) {
        setPushResult({
          success: true,
          message: `备份成功！共 ${res.stats?.videoCount ?? 0} 部影片记录，${res.stats?.timelineCount ?? 0} 条打点`,
        });
        setCloudSyncLastSync(res.updatedAt || new Date().toISOString());
        onAddSystemLog(
          "已成功将本地全量数据与设置备份至 Cloudflare KV",
          "SUCCESS",
        );
      } else {
        setPushResult({
          success: false,
          message: res.error || "备份失败",
        });
        onAddSystemLog(`云端备份失败: ${res.error}`, "ERROR");
      }
    } catch (err: any) {
      setPushResult({
        success: false,
        message: err?.message || String(err),
      });
      onAddSystemLog(`云端备份异常: ${err?.message || err}`, "ERROR");
    } finally {
      setPushing(false);
    }
  };

  const handlePullFromCloud = async () => {
    if (!cloudSyncSecret.trim()) {
      setPullResult({
        success: false,
        message: "请先输入访问密码 (SYNC_SECRET)",
      });
      return;
    }
    setPulling(true);
    setPullResult(null);
    setConfirmPull(false);
    try {
      const res = await trpc.sync.pullFromCloud.mutate({
        endpoint: cloudSyncEndpoint,
        secretKey: cloudSyncSecret,
      });
      if (res.success) {
        setPullResult({
          success: true,
          message: `恢复成功！旧数据已自动安全镜像备份至 backups 目录`,
        });
        setCloudSyncLastSync(res.updatedAt || new Date().toISOString());
        onAddSystemLog(
          `已从 Cloudflare KV 恢复云端数据，旧数据已安全备份`,
          "SUCCESS",
        );
      } else {
        setPullResult({
          success: false,
          message: res.error || "恢复失败",
        });
        onAddSystemLog(`从云端恢复失败: ${res.error}`, "ERROR");
      }
    } catch (err: any) {
      setPullResult({
        success: false,
        message: err?.message || String(err),
      });
      onAddSystemLog(`云端恢复异常: ${err?.message || err}`, "ERROR");
    } finally {
      setPulling(false);
    }
  };

  const handlePreviewSyncDiff = async () => {
    if (!cloudSyncSecret.trim()) {
      setSyncDiffError("请先输入访问密码 (SYNC_SECRET)");
      return;
    }
    setSyncDiffLoading(true);
    setSyncDiffError("");
    setSyncDiff(null);
    try {
      const res = await trpc.sync.previewSyncDiff.query({
        endpoint: cloudSyncEndpoint,
        secretKey: cloudSyncSecret,
      });
      if (!res.success) {
        setSyncDiffError(res.error || "演练预览失败");
        onAddSystemLog(`同步演练预览失败: ${res.error}`, "ERROR");
      } else {
        setSyncDiff(res);
        onAddSystemLog(
          `同步演练场: 本次预览为只读，未写入任何数据。可推送 ${res.summary?.pushAdd + res.summary?.pushUpdate} 项，需拉取 ${res.summary?.pullAdd + res.summary?.pullUpdate} 项`,
          "INFO",
        );
      }
    } catch (err: any) {
      setSyncDiffError(err?.message || String(err));
      onAddSystemLog(`同步演练异常: ${err?.message || err}`, "ERROR");
    } finally {
      setSyncDiffLoading(false);
    }
  };

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
      privacyImageMode,
      maxConcurrentTasks: Math.max(1, Math.min(20, maxConcurrentTasks || 1)),
      thumbQueueConcurrency: Math.max(
        1,
        Math.min(50, thumbQueueConcurrency || 1),
      ),
      cloudSyncEndpoint: cloudSyncEndpoint.trim(),
      cloudSyncSecret: cloudSyncSecret.trim(),
      cloudSyncAutoSync,
      cloudSyncLastSync,
      newsEndpoint: newsEndpoint.trim(),
      newsApiKey: newsApiKey.trim(),
      autoArousalOnPlay,
      playerLayout,
      downloadBgVisible,
      downloadBgOpacity,
      downloadBgDim,
      achievementToast,
      uiZoom,
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

  const tabs: Array<{ key: TabKey; label: string; icon: any }> = [
    { key: "storage", label: "存储路径", icon: Folder },
    { key: "network", label: "网络与插件", icon: Globe },
    { key: "appearance", label: "个性化", icon: Palette },
    { key: "notification", label: "通知", icon: Bell },
    { key: "sync", label: "云端同步", icon: Cloud },
    { key: "health", label: "健康状态", icon: Activity },
  ];

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollTimerRef = useRef<number | null>(null);

  const handleContentScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.classList.add("is-scrolling");
    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
    }
    scrollTimerRef.current = window.setTimeout(() => {
      el.classList.remove("is-scrolling");
    }, 160);
  };

  const tabBtnClass = (active: boolean) =>
    `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
      active
        ? "bg-accent-500/10 text-accent-700 dark:text-accent-400 font-bold"
        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100/50 dark:hover:bg-slate-800/50"
    }`;

  const segBtnClass = (active: boolean) =>
    `px-3 py-2 text-[11px] font-bold rounded-lg border transition cursor-pointer ${
      active
        ? "border-accent-500/40 bg-accent-500/10 text-accent-600 dark:text-accent-400"
        : "border-hairline bg-surface-1 text-text-2 hover:border-hairline-strong hover:text-text-1"
    }`;

  // 旧内联 Toggle（on/onToggle）→ 统一公共 Toggle（checked/onChange）
  const Toggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
    <ToggleSwitch checked={on} onChange={() => onToggle()} />
  );

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 anim-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col h-[600px] anim-scale-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-accent-500/10 dark:bg-accent-500/20 p-2.5 rounded-xl border border-accent-500/20">
              <Cpu className="w-5 h-5 text-accent-500" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-text-1 tracking-wide">
                系统核心配置
              </h2>
              <p className="text-[11px] text-text-3 mt-0.5">
                配置运行环境及本地媒体库路径
              </p>
            </div>
          </div>
          <Tooltip content="关闭设置 (Esc)" placement="bottom">
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭设置"
              className="p-1.5 rounded-lg text-text-3 hover:text-text-1 hover:bg-accent-500/10 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </Tooltip>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden bg-slate-100/50 dark:bg-slate-900/50 border-r ">
          {/* Sidebar */}
          <div className="w-48 border-slate-100 dark:border-slate-800 p-3 flex flex-col gap-1 shrink-0">
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
          <div
            ref={scrollRef}
            onScroll={handleContentScroll}
            className="settings-scroll flex-1 p-6 overflow-y-auto"
          >
            {activeTab === "storage" && (
              <div className="space-y-5">
                <div className="flex items-center gap-2 pb-2 border-b border-hairline">
                  <h3 className="text-xs font-bold text-text-1 tracking-wide uppercase">
                    媒体存储路径
                  </h3>
                </div>

                <div className="p-3.5 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/10 rounded-xl text-[11px] text-text-2 leading-relaxed">
                  <span className="font-bold text-amber-700 dark:text-amber-400">
                    目录结构说明:
                  </span>{" "}
                  每个视频存放在独立子文件夹中，包含以下文件：
                  <div className="flex gap-1.5 mt-2">
                    {["video.mp4", "cover.jpg", "preview.mp4"].map((f) => (
                      <code
                        key={f}
                        className="text-[10px] bg-surface-2 border border-hairline px-2 py-0.5 text-accent-600 dark:text-accent-400 font-mono rounded"
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
                <div className="flex items-center gap-2 pb-2 border-b border-hairline">
                  <h3 className="text-xs font-bold text-text-1 tracking-wide uppercase">
                    网络与插件
                  </h3>
                </div>

                <div className="p-4 bg-surface-1 border border-hairline rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-text-1">
                        启用网络代理
                      </h4>
                      <p className="text-[10px] text-text-3 mt-0.5">
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
                        className="w-full bg-surface-2 border border-hairline rounded-lg px-3 py-2 text-xs font-mono text-text-1 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition"
                        placeholder="http://127.0.0.1:7890"
                      />
                    </div>
                  )}
                </div>

                {/* 下载速度限制 */}
                <div className="p-4 bg-surface-1 border border-hairline rounded-xl space-y-2">
                  <div>
                    <h4 className="text-xs font-bold text-text-1">
                      全局下载速度限制
                    </h4>
                    <p className="text-[10px] text-text-3 mt-0.5">
                      传给 N_m3u8DL-RE 的{" "}
                      <code className="font-mono">--max-speed</code> 参数。空 =
                      不限速。
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={speedLimit}
                      onChange={(e) => setSpeedLimit(e.target.value)}
                      placeholder="例: 5M / 512K / 留空不限速"
                      className="flex-1 bg-surface-2 border border-hairline rounded-lg px-3 py-2 text-xs font-mono text-text-1 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition"
                    />
                    {["", "1M", "5M", "10M"].map((preset) => (
                      <button
                        key={preset || "off"}
                        type="button"
                        onClick={() => setSpeedLimit(preset)}
                        className={`px-2.5 text-[10px] font-bold rounded-lg border transition cursor-pointer ${
                          speedLimit === preset
                            ? "border-accent-500/40 bg-accent-500/10 text-accent-600 dark:text-accent-400"
                            : "border-hairline bg-surface-1 text-text-2 hover:bg-surface-2"
                        }`}
                      >
                        {preset || "不限"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 并发下载数 */}
                <div className="p-4 bg-surface-1 border border-hairline rounded-xl space-y-2">
                  <div>
                    <h4 className="text-xs font-bold text-text-1">
                      最大并发下载数
                    </h4>
                    <p className="text-[10px] text-text-3 mt-0.5">
                      关闭"队列下载"后，同时下载的任务数上限。建议
                      2–4，过高会占带宽与磁盘 IO。
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
                      className="w-24 bg-surface-2 border border-hairline rounded-lg px-3 py-2 text-xs font-mono text-text-1 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition"
                    />
                    {[1, 2, 3, 5, 8].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setMaxConcurrentTasks(preset)}
                        className={`px-2.5 py-2 text-[10px] font-bold rounded-lg border transition cursor-pointer ${
                          maxConcurrentTasks === preset
                            ? "border-accent-500/40 bg-accent-500/10 text-accent-600 dark:text-accent-400"
                            : "border-hairline bg-surface-1 text-text-2 hover:bg-surface-2"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 刻度图修复并发数 */}
                <div className="p-4 bg-surface-1 border border-hairline rounded-xl space-y-2">
                  <div>
                    <h4 className="text-xs font-bold text-text-1">
                      刻度图修复并发数
                    </h4>
                    <p className="text-[10px] text-text-3 mt-0.5">
                      后台同时跑几个刻度图生成任务。每个任务都要解码视频，太高会占
                      CPU/GPU 导致播放卡顿。建议 2–3。
                    </p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={thumbQueueConcurrency}
                      onChange={(e) =>
                        setThumbQueueConcurrency(parseInt(e.target.value) || 1)
                      }
                      className="w-24 bg-surface-2 border border-hairline rounded-lg px-3 py-2 text-xs font-mono text-text-1 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition"
                    />
                    {[1, 2, 3, 4, 6, 10, 20, 50].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setThumbQueueConcurrency(preset)}
                        className={`px-2.5 py-2 text-[10px] font-bold rounded-lg border transition cursor-pointer ${
                          thumbQueueConcurrency === preset
                            ? "border-accent-500/40 bg-accent-500/10 text-accent-600 dark:text-accent-400"
                            : "border-hairline bg-surface-1 text-text-2 hover:bg-surface-2"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-surface-1 border border-hairline rounded-xl flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-text-1 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      M3U8 自动嗅探插件
                    </div>
                    <p className="text-[10px] text-text-3 mt-1 leading-relaxed">
                      协助在 Chrome / Edge 中无缝抓包及嗅探流媒体地址。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleInstallChromeExtension}
                    disabled={isInstallingExtension}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-surface-1 border border-hairline text-xs text-accent-600 dark:text-accent-400 hover:bg-accent-500/10 hover:border-accent-500/40 disabled:opacity-60 disabled:cursor-not-allowed font-bold rounded-lg transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {isInstallingExtension ? "打开中..." : "导入向导"}
                  </button>
                </div>

                <div className="p-4 bg-surface-1 border border-hairline rounded-xl space-y-3">
                  <div>
                    <h4 className="text-xs font-bold text-text-1">
                      云端影视资讯服务
                    </h4>
                    <p className="mt-0.5 text-[10px] text-text-3">
                      填入部署后的 News Worker 地址；客户端仅使用只读密钥。
                    </p>
                  </div>
                  <input
                    type="text"
                    value={newsEndpoint}
                    onChange={(e) => setNewsEndpoint(e.target.value)}
                    placeholder="https://avplay-news.your-subdomain.workers.dev"
                    className="w-full rounded-lg border-hairline bg-surface-2 px-3 py-2 text-xs font-mono text-text-1 focus:border-accent-500 focus:outline-none"
                  />
                  <input
                    type="password"
                    value={newsApiKey}
                    onChange={(e) => setNewsApiKey(e.target.value)}
                    placeholder="CLIENT_TOKEN（若服务配置了）"
                    className="w-full rounded-lg border-hairline bg-surface-2 px-3 py-2 text-xs font-mono text-text-1 focus:border-accent-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {activeTab === "appearance" && (
              <div className="space-y-5">
                <div className="flex items-center gap-2 pb-2 border-b border-hairline">
                  <h3 className="text-xs font-bold text-text-1 tracking-wide uppercase">
                    外观与提示
                  </h3>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-text-2 block">
                    播放页布局
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { v: "zero", l: "零界面放映", d: "边缘唤出操作与片库" },
                        {
                          v: "capsule",
                          l: "Aero 胶囊",
                          d: "Rose Noir 悬浮胶囊与抽屉",
                        },
                        { v: "classic", l: "经典右栏", d: "播放器 + 完整片库" },
                      ] as Array<{ v: PlayerLayout; l: string; d: string }>
                    ).map(({ v, l, d }) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setPlayerLayout(v)}
                        className={`rounded-xl border p-3 text-left transition cursor-pointer ${
                          playerLayout === v
                            ? "border-accent-400 bg-accent-500/10 text-accent-600 dark:text-accent-300"
                            : "border-hairline bg-surface-1 text-text-2 hover:border-accent-400/60"
                        }`}
                      >
                        <span className="block text-[11px] font-bold">{l}</span>
                        <span className="mt-1 block text-[10px] text-text-3">
                          {d}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-text-2 block">
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
                  <label className="text-[11px] font-bold text-text-2 block">
                    界面缩放
                  </label>
                  <NumberControl
                    label="全局缩放"
                    value={uiZoom}
                    min={85}
                    max={120}
                    step={5}
                    suffix="%"
                    onChange={setUiZoom}
                  />
                  <p className="text-[10px] text-text-3">
                    对整窗缩放，保存后生效；100% 为系统默认大小
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-text-2 block">
                    隐私屏保
                  </label>
                  <div className="flex items-center justify-between p-3.5 bg-surface-1 border border-hairline rounded-xl mb-2.5">
                    <div>
                      <div className="text-xs font-bold text-text-1 flex items-center gap-1.5">
                        <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500" />
                        视频开播自动开启私密计时
                      </div>
                      <p className="text-[10px] text-text-3 mt-0.5">
                        无需每次手动点击，视频开始播放即自动启动计时并对齐进度，结束后自动存入战报
                      </p>
                    </div>
                    <Toggle
                      on={autoArousalOnPlay}
                      onToggle={() => setAutoArousalOnPlay(!autoArousalOnPlay)}
                    />
                  </div>

                  <div className="flex items-center justify-between p-3.5 bg-surface-1 border border-hairline rounded-xl mb-2.5">
                    <div>
                      <div className="text-xs font-bold text-text-1 flex items-center gap-1.5">
                        <EyeOff className="w-3.5 h-3.5 text-amber-500" />
                        隐私模式（隐藏全部图片）
                      </div>
                      <p className="text-[10px] text-text-3 mt-0.5">
                        常驻生效：封面、预览与所有图片用加载动画占位，适合有人共屏时长时间使用
                      </p>
                    </div>
                    <Toggle
                      on={privacyImageMode}
                      onToggle={() => setPrivacyImageMode(!privacyImageMode)}
                    />
                  </div>

                  <div className="flex items-center justify-between p-3.5 bg-surface-1 border border-hairline rounded-xl">
                    <div>
                      <div className="text-xs font-bold text-text-1">
                        自动遮挡下载内容
                      </div>
                      <p className="text-[10px] text-text-3 mt-0.5">
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
                            ? "border-accent-500/50 ring-2 ring-accent-500/30"
                            : "border-hairline hover:border-hairline-strong"
                        }`}
                        title={`背景 ${bg}`}
                      >
                        <img
                          src={wallpaperThumbUrl(bg)}
                          alt={`背景 ${bg}`}
                          decoding="async"
                          loading="lazy"
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
                  <div className="relative mt-3 overflow-hidden rounded-xl border-hairline bg-slate-950 shadow-lg [content-visibility:auto] [contain-intrinsic-size:auto_120px]">
                    <img
                      src={wallpaperThumbUrl(downloadBackground)}
                      alt="当前壁纸预览"
                      decoding="async"
                      className="h-28 w-full object-cover"
                      style={{
                        filter: `blur(${Math.min(privacyScreenBlur, 12)}px)`,
                        opacity: Math.max(
                          0.32,
                          privacyScreenImageOpacity / 100,
                        ),
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/20 to-transparent" />
                    <div className="absolute inset-x-3 bottom-2 flex items-end justify-between text-white">
                      <div>
                        <div className="text-[10px] font-bold tracking-[0.2em] text-white/80">
                          WALLPAPER SCENE
                        </div>
                        <div className="mt-0.5 text-[9px] text-white/50">
                          屏保 / 空态 / 加载层共用预览
                        </div>
                      </div>
                      <span className="rounded-full border border-white/20 bg-black/25 px-2 py-1 text-[9px] text-white/65">
                        实时
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border-hairline bg-surface-1 p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div>
                        <div className="text-[11px] font-bold text-text-2">
                          下载页主背景（当前壁纸）
                        </div>
                        <p className="text-[10px] text-text-3 mt-0.5">
                          调节下载管理页整幅壁纸的浓度与暗化；关闭后为纯色简洁背景
                        </p>
                      </div>
                      <Toggle
                        on={downloadBgVisible}
                        onToggle={() =>
                          setDownloadBgVisible(!downloadBgVisible)
                        }
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <NumberControl
                        label="图片浓度"
                        value={downloadBgOpacity}
                        min={0}
                        max={100}
                        step={1}
                        suffix="%"
                        onChange={setDownloadBgOpacity}
                      />
                      <NumberControl
                        label="暗化强度"
                        value={downloadBgDim}
                        min={0}
                        max={100}
                        step={1}
                        suffix="%"
                        onChange={setDownloadBgDim}
                      />
                    </div>
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
                    <div className="flex min-w-38 items-center justify-between gap-3 rounded-lg border-hairline bg-surface-1 px-3 py-2">
                      <span className="text-[10px] font-bold text-text-2">
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
                  <label className="text-[11px] font-bold text-text-2 block">
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

                <div className="space-y-2 [content-visibility:auto] [contain-intrinsic-size:auto_320px]">
                  <label className="text-[11px] font-bold text-text-2 block">
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
                            ? "border-accent-500/40 ring-1 ring-accent-500/30"
                            : "border-hairline hover:border-hairline-strong"
                        }`}
                      >
                        <div className="relative w-full h-16 bg-slate-900">
                          <CoverLoader variant={v} />
                        </div>
                        <div
                          className={`px-2 py-1 text-[10px] font-bold text-center ${
                            loaderStyle === v
                              ? "bg-accent-500/10 text-accent-600 dark:text-accent-400"
                              : "bg-surface-1 text-text-2"
                          }`}
                        >
                          {l}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "notification" && (
              <div className="space-y-5">
                <div className="flex items-center gap-2 pb-2 border-b border-hairline">
                  <h3 className="text-xs font-bold text-text-1 tracking-wide uppercase">
                    通知与提醒
                  </h3>
                </div>

                <div className="flex items-center justify-between p-3.5 bg-surface-1 border border-hairline rounded-xl">
                  <div>
                    <div className="text-xs font-bold text-text-1">
                      下载状态系统通知
                    </div>
                    <p className="text-[10px] text-text-3 mt-0.5">
                      任务完成或失败时通过系统横幅通知
                    </p>
                  </div>
                  <Toggle
                    on={notifyOnComplete}
                    onToggle={() => setNotifyOnComplete(!notifyOnComplete)}
                  />
                </div>

                <div className="flex items-center justify-between p-3.5 bg-surface-1 border border-hairline rounded-xl">
                  <div>
                    <div className="text-xs font-bold text-text-1">
                      完成声音提醒
                    </div>
                    <p className="text-[10px] text-text-3 mt-0.5">
                      下载任务结束时播放 assets/tips.mp3
                    </p>
                  </div>
                  <Toggle
                    on={notifySound}
                    onToggle={() => setNotifySound(!notifySound)}
                  />
                </div>

                <div className="flex items-center justify-between p-3.5 bg-surface-1 border border-hairline rounded-xl">
                  <div>
                    <div className="text-xs font-bold text-text-1 flex items-center gap-1.5">
                      <Trophy className="w-3.5 h-3.5 text-amber-500" />
                      成就解锁跳杯提示
                    </div>
                    <p className="text-[10px] text-text-3 mt-0.5">
                      关闭后成就仍正常解锁与记录，只是不再弹跳杯横幅
                    </p>
                  </div>
                  <Toggle
                    on={achievementToast}
                    onToggle={() => setAchievementToast(!achievementToast)}
                  />
                </div>
              </div>
            )}

            {activeTab === "sync" && (
              <div className="space-y-5">
                {/* 标题说明区 */}
                <div className="flex items-center justify-between gap-3 pb-2 border-b border-hairline">
                  <div>
                    <h3 className="text-xs font-bold text-text-1 tracking-wide uppercase flex items-center gap-1.5">
                      <Cloud className="w-3.5 h-3.5 text-amber-500" />
                      Cloudflare Workers + KV 云端同步
                    </h3>
                    <p className="text-[11px] text-text-3 mt-0.5">
                      全球边缘无服务器存储，随时将观影记录、打点书签及配置安全同步
                    </p>
                  </div>
                  {cloudSyncLastSync && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full font-medium shrink-0">
                      上次同步: {new Date(cloudSyncLastSync).toLocaleString()}
                    </span>
                  )}
                </div>

                {/* 服务配置卡片 */}
                <div className="rounded-xl border-hairline bg-surface-2 p-4 space-y-3.5">
                  {/* Worker 端点 */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-text-2 flex items-center justify-between">
                      <span>Worker 同步服务地址 (Endpoint)</span>
                      <span className="text-[10px] font-normal text-text-3">
                        已自动连接你的 Cloudflare Worker
                      </span>
                    </label>
                    <input
                      type="text"
                      value={cloudSyncEndpoint}
                      onChange={(e) => setCloudSyncEndpoint(e.target.value)}
                      placeholder="https://avplay-sync.1024327189.workers.dev"
                      className="w-full px-3 py-2 bg-surface-2 border border-hairline rounded-lg text-xs font-mono text-text-1 focus:outline-none focus:border-accent-500"
                    />
                  </div>

                  {/* 访问密码 SYNC_SECRET */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-text-2 block">
                      访问鉴权密钥 (SYNC_SECRET)
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showSecret ? "text" : "password"}
                          value={cloudSyncSecret}
                          onChange={(e) => setCloudSyncSecret(e.target.value)}
                          placeholder="输入你在 Cloudflare Worker 环境变量配置的 SYNC_SECRET"
                          className="w-full pl-3 pr-9 py-2 bg-surface-2 border border-hairline rounded-lg text-xs font-mono text-text-1 focus:outline-none focus:border-accent-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecret(!showSecret)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3 hover:text-accent-500 cursor-pointer"
                          title={showSecret ? "隐藏密码" : "显示密码"}
                        >
                          {showSecret ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={handleTestConnection}
                        disabled={
                          testingConnection || !cloudSyncEndpoint.trim()
                        }
                        className="px-3 py-2 rounded-lg bg-surface-2 border border-hairline text-text-2 hover:bg-accent-500/10 hover:text-accent-500 text-xs font-bold transition flex items-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            testingConnection
                              ? "animate-spin text-amber-500"
                              : ""
                          }`}
                        />
                        {testingConnection ? "测试中..." : "测试连接"}
                      </button>
                    </div>

                    {/* 测试结果提示 */}
                    {testResult && (
                      <div
                        className={`flex items-center gap-1.5 text-xs p-2 rounded-lg ${
                          testResult.success
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                        }`}
                      >
                        {testResult.success ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 shrink-0" />
                        )}
                        <span>{testResult.message}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 自动化备份开关卡片 */}
                <div className="flex items-center justify-between p-3.5 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 dark:border-amber-500/30 rounded-xl transition">
                  <div className="space-y-0.5 max-w-[80%]">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-text-1 flex items-center gap-1.5">
                        <UploadCloud className="w-3.5 h-3.5 text-amber-500" />
                        应用启动与退出时自动备份
                      </span>
                      <span className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold px-1.5 py-0.5 rounded">
                        全自动静默
                      </span>
                    </div>
                    <p className="text-[11px] text-text-2 leading-relaxed">
                      开启后，每次进入应用时、彻底退出应用前或最小化到托盘时，系统都会在后台自动静默将观影记录、打点书签与成就殿堂推送到
                      Cloudflare KV，彻底告别手动备份。
                    </p>
                  </div>
                  <Toggle
                    on={cloudSyncAutoSync}
                    onToggle={() => {
                      const next = !cloudSyncAutoSync;
                      setCloudSyncAutoSync(next);
                      onSaveSettings({
                        ...settings,
                        cloudSyncAutoSync: next,
                        cloudSyncEndpoint: cloudSyncEndpoint.trim(),
                        cloudSyncSecret: cloudSyncSecret.trim(),
                      });
                      onAddSystemLog(
                        `已${next ? "开启" : "关闭"}应用启动与退出自动备份`,
                        "INFO",
                      );
                    }}
                  />
                </div>

                {/* 同步与备份操作区 */}
                <div className="grid grid-cols-2 gap-3.5">
                  {/* 备份到云端 */}
                  <div className="rounded-xl border-hairline bg-surface-1 p-4 flex flex-col justify-between space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs font-bold text-text-1">
                        <UploadCloud className="w-4 h-4 text-amber-500" />
                        <span>备份数据到云端 (Push)</span>
                      </div>
                      <p className="text-[11px] text-text-3 leading-relaxed">
                        将当前播放历史、统计数据、打点书签及配置打包推送到
                        Cloudflare KV 存储。
                      </p>
                    </div>

                    {pushResult && (
                      <div
                        className={`text-[11px] p-2 rounded-lg ${
                          pushResult.success
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                        }`}
                      >
                        {pushResult.message}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handlePushToCloud}
                      disabled={pushing || pulling || !cloudSyncSecret.trim()}
                      className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer shadow-sm shadow-amber-500/10"
                    >
                      <UploadCloud
                        className={`w-3.5 h-3.5 ${pushing ? "animate-bounce" : ""}`}
                      />
                      {pushing ? "正在打包并上传..." : "立即备份到云端"}
                    </button>
                  </div>

                  {/* 从云端恢复 */}
                  <div className="rounded-xl border-hairline bg-surface-1 p-4 flex flex-col justify-between space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs font-bold text-text-1">
                        <DownloadCloud className="w-4 h-4 text-sky-500" />
                        <span>从云端恢复数据 (Pull)</span>
                      </div>
                      <p className="text-[11px] text-text-3 leading-relaxed">
                        从云端拉取已保存的观影数据。覆盖前系统会自动在本地安全归档一份旧数据。
                      </p>
                    </div>

                    {pullResult && (
                      <div
                        className={`text-[11px] p-2 rounded-lg ${
                          pullResult.success
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                        }`}
                      >
                        {pullResult.message}
                      </div>
                    )}

                    {confirmPull ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmPull(false)}
                          className="flex-1 py-2 bg-surface-2 border border-hairline hover:bg-accent-500/10 text-text-2 rounded-lg text-xs font-semibold cursor-pointer"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={handlePullFromCloud}
                          disabled={pulling}
                          className="flex-1 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-xs font-bold cursor-pointer"
                        >
                          {pulling ? "恢复中..." : "确定覆盖恢复"}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmPull(true)}
                        disabled={pushing || pulling || !cloudSyncSecret.trim()}
                        className="w-full py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer shadow-sm shadow-sky-500/10"
                      >
                        <DownloadCloud
                          className={`w-3.5 h-3.5 ${pulling ? "animate-bounce" : ""}`}
                        />
                        从云端拉取恢复
                      </button>
                    )}
                  </div>
                </div>

                {/* 同步演练场 (B111)：同步前只读预览本地与云端差异 */}
                <div className="rounded-xl border-hairline bg-surface-1 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 text-xs font-bold text-text-1">
                        <FlaskConical className="w-4 h-4 text-teal-500" />
                        <span>同步演练场（只读预览差异）</span>
                        <span className="text-[10px] bg-teal-500/15 text-teal-700 dark:text-teal-300 font-semibold px-1.5 py-0.5 rounded">
                          可撤销
                        </span>
                      </div>
                      <p className="text-[11px] text-text-3 leading-relaxed">
                        同步前先展示本地与云端差异，本次预览不会写入任何数据。手动推送前与云端恢复前，系统都会自动生成可回滚快照。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handlePreviewSyncDiff}
                      disabled={syncDiffLoading || !cloudSyncSecret.trim()}
                      className="px-3 py-2 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold transition flex items-center gap-1.5 shrink-0 disabled:opacity-40 cursor-pointer shadow-sm shadow-teal-500/10"
                    >
                      <GitCompareArrows
                        className={`w-3.5 h-3.5 ${syncDiffLoading ? "animate-spin" : ""}`}
                      />
                      {syncDiffLoading
                        ? "计算中..."
                        : syncDiff
                          ? "重新演练"
                          : "开始演练"}
                    </button>
                  </div>

                  {syncDiffError && (
                    <div className="flex items-center gap-1.5 text-xs p-2.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{syncDiffError}</span>
                    </div>
                  )}

                  {syncDiff && !syncDiffError && (
                    <>
                      {!syncDiff.hasCloud && (
                        <div className="flex items-center gap-1.5 text-xs p-2.5 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                          <Info className="w-4 h-4 shrink-0" />
                          <span>云端暂无数据，本地数据可全部推送到云端。</span>
                        </div>
                      )}
                      {syncDiff.hasCloud && (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="p-2.5 rounded-lg bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                                <ArrowUp className="w-3.5 h-3.5" />
                                推送 (本地 → 云端)
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-mono">
                                  新增 {syncDiff.summary?.pushAdd ?? 0}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 font-mono">
                                  更新 {syncDiff.summary?.pushUpdate ?? 0}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-3 font-mono">
                                  一致 {syncDiff.summary?.pushKeep ?? 0}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-300 font-mono">
                                  移除 {syncDiff.summary?.pushRemove ?? 0}
                                </span>
                              </div>
                            </div>
                            <div className="p-2.5 rounded-lg bg-sky-500/5 dark:bg-sky-500/10 border border-sky-500/20 space-y-1">
                              <div className="flex items-center gap-1.5 text-[11px] font-bold text-sky-600 dark:text-sky-400">
                                <ArrowDown className="w-3.5 h-3.5" />
                                拉取 (云端 → 本地)
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-mono">
                                  需拉取 {syncDiff.summary?.pullAdd ?? 0}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 font-mono">
                                  更新 {syncDiff.summary?.pullUpdate ?? 0}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-3 font-mono">
                                  一致 {syncDiff.summary?.pullKeep ?? 0}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-300 font-mono">
                                  仅本地 {syncDiff.summary?.pullLocalOnly ?? 0}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                            {syncDiff.items?.map((item: any) => {
                              const pushCfg: Record<
                                string,
                                { label: string; cls: string }
                              > = {
                                add: {
                                  label: "推送新增",
                                  cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/20",
                                },
                                update: {
                                  label: "推送更新",
                                  cls: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/20",
                                },
                                keep: {
                                  label: "一致",
                                  cls: "bg-surface-2 text-text-3 border-hairline",
                                },
                                remove: {
                                  label: "云端清理",
                                  cls: "bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/20",
                                },
                              };
                              const pullCfg: Record<
                                string,
                                { label: string; cls: string }
                              > = {
                                add: {
                                  label: "拉取新增",
                                  cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/20",
                                },
                                update: {
                                  label: "拉取更新",
                                  cls: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/20",
                                },
                                keep: {
                                  label: "一致",
                                  cls: "bg-surface-2 text-text-3 border-hairline",
                                },
                                localOnly: {
                                  label: "仅本地",
                                  cls: "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/20",
                                },
                              };
                              const p =
                                pushCfg[item.pushAction] || pushCfg.keep;
                              const l =
                                pullCfg[item.pullAction] || pullCfg.keep;
                              return (
                                <div
                                  key={item.key}
                                  className="flex items-center gap-2 p-2.5 rounded-lg border-hairline bg-surface-1"
                                >
                                  <span className="text-[11px] font-bold text-text-2 w-20 shrink-0 truncate">
                                    {item.label}
                                  </span>
                                  <span
                                    className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold shrink-0 ${p.cls}`}
                                  >
                                    {p.label}
                                  </span>
                                  <span
                                    className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold shrink-0 ${l.cls}`}
                                  >
                                    {l.label}
                                  </span>
                                  <span className="text-[10px] text-text-3 font-mono truncate">
                                    {item.equal
                                      ? "完全一致"
                                      : item.keySummary
                                        ? `${item.keySummary.changed} 变化 / +${item.keySummary.added} / -${item.keySummary.removed}`
                                        : `${item.localBytes ?? 0}B → ${item.cloudBytes ?? 0}B`}
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          {syncDiff.cloudUpdatedAt && (
                            <div className="text-[10px] text-text-3">
                              云端最近更新:{" "}
                              {new Date(
                                syncDiff.cloudUpdatedAt,
                              ).toLocaleString()}
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* 私有档案快照库入口 (B108) */}
                <div className="flex items-center justify-between p-3.5 bg-violet-500/5 dark:bg-violet-500/10 border border-violet-500/20 rounded-xl transition">
                  <div className="space-y-0.5 max-w-[80%]">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-text-1 flex items-center gap-1.5">
                        <Archive className="w-3.5 h-3.5 text-violet-500" />
                        私有档案快照库
                      </span>
                    </div>
                    <p className="text-[11px] text-text-2 leading-relaxed">
                      本地可命名、可加密、可预览差异的快照，随时一键回滚。手动推送前与云端恢复前也会自动生成快照。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSnapshotLibrary(true)}
                    className="px-3 py-2 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold transition flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm shadow-violet-500/10"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    打开快照库
                  </button>
                </div>

                {/* 安全机制说明 */}
                <div className="rounded-xl border-hairline bg-surface-2 p-3.5 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-text-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    <span>安全保障与数据覆盖说明</span>
                  </div>
                  <ul className="text-[11px] text-text-2 space-y-1 list-disc list-inside">
                    <li>
                      <span className="font-medium text-text-2">
                        防误触双重保障：
                      </span>
                      每次从云端拉取时，当前机器现有的数据都会自动复制到{" "}
                      <code className="font-mono text-amber-600 dark:text-amber-400">
                        userData/backups/
                      </code>{" "}
                      中。
                    </li>
                    <li>
                      <span className="font-medium text-text-2">
                        本地路径保护：
                      </span>
                      恢复云端数据时，会自动保留当前机器设置的本地视频库路径与临时目录，不会破坏两台电脑不同的盘符设置。
                    </li>
                    <li>
                      <span className="font-medium text-text-2">
                        数据范围：
                      </span>
                      包含播放统计与观看时长 (
                      <code className="font-mono text-[10px]">stats.json</code>
                      )、视频打点书签 (
                      <code className="font-mono text-[10px]">
                        timeline.json
                      </code>
                      ) 与基础偏好。
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {activeTab === "health" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-3 pb-2 border-b border-hairline">
                  <h3 className="text-xs font-bold text-text-1 tracking-wide uppercase">
                    健康状态页
                  </h3>
                  <button
                    type="button"
                    onClick={loadHealth}
                    disabled={healthLoading}
                    className="px-3 py-1.5 rounded-lg bg-accent-500 text-white text-[11px] font-bold disabled:opacity-50 cursor-pointer"
                  >
                    {healthLoading ? "检查中..." : "立即检查"}
                  </button>
                </div>

                {!health && (
                  <div className="rounded-xl border-hairline bg-surface-1 p-4 text-[12px] text-text-2">
                    点击“立即检查”读取视频目录、临时目录、用户数据、统计文件和磁盘空间状态。
                  </div>
                )}

                {health && (
                  <div className="space-y-2">
                    {health.checks.map((check: any) => {
                      const Icon =
                        check.status === "ok"
                          ? CheckCircle2
                          : check.status === "warn"
                            ? AlertTriangle
                            : XCircle;
                      const color =
                        check.status === "ok"
                          ? "text-emerald-500"
                          : check.status === "warn"
                            ? "text-amber-500"
                            : "text-rose-500";
                      return (
                        <button
                          type="button"
                          key={check.label}
                          onClick={() => openHealthPath(check.detail)}
                          className="w-full text-left flex items-start gap-3 rounded-xl border-hairline bg-surface-1 px-3 py-2.5 hover:border-amber-300 dark:hover:border-amber-700 hover:bg-amber-50/40 dark:hover:bg-amber-500/5 transition cursor-pointer"
                          title="打开此路径"
                        >
                          <Icon className={`w-4 h-4 mt-0.5 ${color}`} />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-text-1">
                              {check.label}
                            </div>
                            <div className="text-[10px] text-text-3 break-all">
                              {check.detail}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    <div className="pt-2 text-[10px] text-text-3">
                      App {health.appVersion} · UserData: {health.userData}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface-2 border-t border-hairline flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 text-text-3">
            <Info className="w-4 h-4" />
            <span className="text-[10px]">基于 N_m3u8DL-RE 流媒体核心引擎</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="md" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              size="md"
              type="submit"
              icon={<Save className="w-3.5 h-3.5" />}
            >
              保存配置
            </Button>
          </div>
        </div>
      </form>

      {showSnapshotLibrary && (
        <SnapshotLibraryModal
          onClose={() => setShowSnapshotLibrary(false)}
          onAddSystemLog={onAddSystemLog}
        />
      )}
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
      <label className="text-[11px] font-bold text-text-2 block">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-surface-2 border border-hairline rounded-lg px-3 py-2 text-xs font-mono text-text-1 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition"
          placeholder="请输入路径..."
        />
        <button
          type="button"
          onClick={onPick}
          title="浏览并选择本地目录"
          aria-label="浏览目录"
          className="px-3 bg-surface-2 hover:bg-accent-500/10 border border-hairline rounded-lg transition cursor-pointer flex items-center justify-center"
        >
          <Folder className="w-4 h-4 text-text-2" />
        </button>
      </div>
    </div>
  );
}
