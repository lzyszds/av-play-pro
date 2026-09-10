import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { TitleBar, type Page } from "./components/TitleBar";
import { GlobalConsole } from "./components/GlobalConsole";
import { ThumbnailQueueWidget } from "./components/ThumbnailQueueWidget";
import { SettingsPanel } from "./components/download/SettingsPanel";
import { FirstRunGuide } from "./components/download/FirstRunGuide";
import { thumbnailQueue } from "./lib/thumbnailQueue";
import { DownloadPage } from "./pages/DownloadPage";
import { PlayerPage } from "./pages/PlayerPage";
import { WebPage, type WebCandidate } from "./pages/WebPage";
import { StatsPage } from "./pages/StatsPage";
import { CommandCenterPage } from "./pages/CommandCenterPage";
import { DiscoverPage } from "./pages/DiscoverPage";
import { NewsPage } from "./pages/NewsPage";
import { ScraperWebview } from "./components/ScraperWebview";
import { AchievementToast } from "./components/achievements/AchievementToast";
import { trpc } from "./lib/trpc";
import { wallpaperScreenUrl } from "./lib/wallpaper";
import {
  setPrivacyCoverLoaderMode,
  refreshPrivacyLoaderStyle,
} from "./lib/privacyCoverLoader";
import type { AppSettings, LogMessage } from "./pages/download/types";

const DEFAULT_SETTINGS: AppSettings = {
  video_path: "",
  temp_path: "",
  defaultFormat: "MP4",
  defaultThreads: 16,
  maxConcurrentTasks: Infinity,
  thumbQueueConcurrency: 4,
  autoMerge: true,
  proxyUrl: "",
  nm3u8dlPath: "N_m3u8DL-RE.exe",
  theme: "system",
  closeAction: "ask",
  notifyOnComplete: true,
  notifySound: true,
  consoleOpen: false,
  consoleHeight: 220,
  globalSpeedLimit: "",
  loaderStyle: "eq",
  downloadBackground: "1",
  privacyScreenEnabled: true,
  privacyScreenIdleSeconds: 60,
  privacyScreenOnBlur: true,
  privacyScreenBlur: 8,
  privacyScreenImageOpacity: 42,
  privacyScreenChangeSeconds: 10,
  privacyImageMode: false,
  lastPage: "player",
  cloudSyncEndpoint: "https://avplay-sync.1024327189.workers.dev",
  cloudSyncSecret: "MySecretToken_2026",
  cloudSyncLastSync: "",
  cloudSyncAutoSync: true,
  newsEndpoint: "https://avplay-news.1024327189.workers.dev",
  newsApiKey: "Aa395878870",
  autoArousalOnPlay: true,
  playerLayout: "classic",
  downloadBgVisible: true,
  downloadBgOpacity: 42,
  downloadBgDim: 0,
  achievementToast: true,
  uiZoom: 100,
};

// 合法的页面 key，用于校验持久化的 lastPage
const VALID_PAGES: Page[] = [
  "download",
  "discover",
  "player",
  "web",
  "stats",
  "command",
  "news",
];

const SETTINGS_CACHE_KEY = "avplay:cached_settings";

function getCachedSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          maxConcurrentTasks: Infinity,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

function syncSettingsCache(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

function applyLoaderStyle(style: AppSettings["loaderStyle"]): void {
  document.documentElement.dataset.loader = style;
}

function applyWallpaperScene(background: AppSettings["downloadBackground"]): void {
  // 全局壁纸/加载遮罩走分级档：按窗口实际像素需要选 HD(2560) 或原图，避免常驻解码 4K~6K
  document.documentElement.style.setProperty(
    "--app-wallpaper-image",
    `url("${wallpaperScreenUrl(background ?? "1")}")`,
  );
}

function applyTheme(mode: AppSettings["theme"]): void {
  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

export default function App() {
  const initialSettings = useMemo(() => getCachedSettings(), []);
  const [currentPage, setCurrentPage] = useState<Page>(() => {
    if (
      initialSettings.lastPage &&
      VALID_PAGES.includes(initialSettings.lastPage as Page)
    ) {
      return initialSettings.lastPage as Page;
    }
    return "player";
  });
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // B207 首次运行体检向导：仅在本地没有任何设置文件（全新安装）时自动弹出一次
  const [showWizard, setShowWizard] = useState(false);
  const emptySettingsRef = useRef(false);
  const [systemLogs, setSystemLogs] = useState<
    Array<{ text: string; level: string; time: string }>
  >([]);
  // 全局控制台日志
  const [logs, setLogs] = useState<LogMessage[]>([]);
  // 「立即查看」目标
  const [pendingPlayName, setPendingPlayName] = useState<string | null>(null);
  // 发现页「一键播放」的在线流（m3u8/mp4）
  const [pendingStream, setPendingStream] = useState<{
    url: string;
    name?: string;
    referer?: string;
  } | null>(null);
  const [incomingDownloadCandidate, setIncomingDownloadCandidate] = useState<{
    id: string;
    title: string;
    mediaUrl: string;
    coverUrl?: string;
    previewUrl?: string;
    pageUrl?: string;
  } | null>(null);
  // 私密计时器
  const [arousalActive, setArousalActive] = useState(false);
  const [arousalElapsed, setArousalElapsed] = useState(0);
  const arousalStartRef = useRef<number | null>(null);
  // 当前正在播放的视频文件夹（PlayerPage 报告）
  const currentPlayingFolderRef = useRef<string | null>(null);

  // 统一的 addLog：同时写入标题栏 ticker 和底部控制台
  const addLog = useCallback(
    (
      text: string,
      level: "INFO" | "WARNING" | "SUCCESS" | "ERROR" = "INFO",
    ) => {
      const now = new Date();
      const time = now.toLocaleTimeString("zh-CN", { hour12: false });
      setSystemLogs((prev) => [...prev.slice(-200), { text, level, time }]);
      setLogs((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: time,
          level,
          text,
        },
      ]);
    },
    [],
  );

  // 全局错误捕获 → 转发到主进程 electron-log
  useEffect(() => {
    const forward = (
      level: "error" | "warn",
      scope: string,
      message: string,
    ) => {
      void trpc.logger.write.mutate({ level, scope, message }).catch(() => { });
    };
    const onError = (e: ErrorEvent) => {
      forward(
        "error",
        "window.onerror",
        `${e.message} @${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack || ""}`,
      );
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason: any = e.reason;
      forward("error", "unhandledrejection", reason?.stack || String(reason));
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // 主进程日志 1:1 桥（logger.attachMainLogBridge → IPC → 底部 GlobalConsole）
  useEffect(() => {
    const unlisten = window.electronAPI?.mainLog?.onEntry?.((entry) => {
      if (!entry?.text) return;
      const time = new Date(entry.time || Date.now()).toLocaleTimeString(
        "zh-CN",
        { hour12: false },
      );
      const level = (
        ["INFO", "SUCCESS", "WARNING", "ERROR", "DEBUG"].includes(
          entry.level,
        )
          ? entry.level
          : "INFO"
      ) as LogMessage["level"];
      setLogs((prev) => {
        const next = [
          ...prev,
          {
            id: `main-${entry.time}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: time,
            level,
            text: entry.text,
          },
        ];
        return next.length > 2000 ? next.slice(-1800) : next;
      });
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // 加载设置 + 默认路径兜底
  useEffect(() => {
    let disposed = false;
    Promise.all([
      trpc.storage.getSettings.query().catch(() => ({})),
      trpc.system.getDefaultPaths.query().catch(() => ({
        video_path: "",
        temp_path: "",
      })),
    ])
      .then(([saved, defaults]) => {
        if (disposed) return;
        emptySettingsRef.current =
          !saved || typeof saved !== "object" || Object.keys(saved).length === 0;
        const savedPartial = saved as Partial<AppSettings>;
        const merged: AppSettings = {
          ...DEFAULT_SETTINGS,
          ...savedPartial,
          // 并发上限：不限制（若老配置仍有数值，覆盖成 Infinity）
          maxConcurrentTasks: Infinity,
        };
        if (!merged.video_path?.trim()) merged.video_path = defaults.video_path;
        if (!merged.temp_path?.trim()) merged.temp_path = defaults.temp_path;
        setSettings(merged);
        syncSettingsCache(merged);
        // 恢复上次所在页面（校验合法后）
        if (
          merged.lastPage &&
          VALID_PAGES.includes(merged.lastPage as Page)
        ) {
          setCurrentPage(merged.lastPage as Page);
        }
      })
      .finally(() => {
        if (!disposed) setSettingsLoaded(true);
      });

    return () => {
      disposed = true;
    };
  }, []);

  // 记录当前页面 → 持久化（重启后恢复）。走既有的防抖落盘逻辑。
  useEffect(() => {
    if (!settingsLoaded) return;
    setSettings((s) => (s.lastPage === currentPage ? s : { ...s, lastPage: currentPage }));
  }, [currentPage, settingsLoaded]);

  // B207：全新安装时自动打开一次环境体检向导
  useEffect(() => {
    if (settingsLoaded && emptySettingsRef.current && !showWizard) {
      setShowWizard(true);
    }
  }, [settingsLoaded, showWizard]);

  // B205：接收托盘命令（快速开页 / 打开设置 / 开关日志控制台）
  useEffect(() => {
    const off =
      window.electronAPI?.app?.onTrayCommand?.((cmd) => {
        if (!cmd) return;
        if (cmd.type === "navigate" && typeof cmd.page === "string") {
          if (VALID_PAGES.includes(cmd.page as Page)) {
            setCurrentPage(cmd.page as Page);
          }
        } else if (cmd.type === "open-settings") {
          setSettingsOpen(true);
        } else if (cmd.type === "toggle-console") {
          setSettings((s) => ({ ...s, consoleOpen: !s.consoleOpen }));
        }
      }) ?? (() => { });
    return off;
  }, []);

  // 把 addLog 注入刻度图队列
  useEffect(() => {
    thumbnailQueue.setLogger(addLog);
  }, [addLog]);

  // 同步并发数到刻度图队列
  useEffect(() => {
    thumbnailQueue.setConcurrency(settings.thumbQueueConcurrency ?? 4);
  }, [settings.thumbQueueConcurrency]);

  // 私密计时：实时秒数 + 切换逻辑
  useEffect(() => {
    if (!arousalActive) return;
    const tick = () => {
      if (arousalStartRef.current != null) {
        setArousalElapsed(
          Math.floor((Date.now() - arousalStartRef.current) / 1000),
        );
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [arousalActive]);

  const handleToggleArousal = useCallback(() => {
    if (arousalActive) {
      const start = arousalStartRef.current;
      const end = Date.now();
      const durationSec = start ? Math.floor((end - start) / 1000) : 0;
      arousalStartRef.current = null;
      setArousalActive(false);
      setArousalElapsed(0);
      if (durationSec >= 1) {
        const mm = String(Math.floor(durationSec / 60)).padStart(2, "00");
        const ss = String(durationSec % 60).padStart(2, "00");
        addLog(`💗 私密计时结束：本次 ${mm}:${ss}`, "SUCCESS");
        void trpc.stats.recordArousal
          .mutate({
            startedAt: new Date(start!).toISOString(),
            endedAt: new Date(end).toISOString(),
            durationSec,
            videoFolder: currentPlayingFolderRef.current,
          })
          .catch(() => { });
      }
    } else {
      arousalStartRef.current = Date.now();
      setArousalElapsed(0);
      setArousalActive(true);
      addLog("💗 私密计时已开启", "INFO");
    }
  }, [arousalActive, addLog]);

  // 允许回溯补录时间（例如已经看了5分钟、15分钟才想起来开启）
  const handleAdjustArousal = useCallback((retroactiveSeconds = 0) => {
    const now = Date.now();
    const newStart = now - retroactiveSeconds * 1000;
    arousalStartRef.current = newStart;
    setArousalElapsed(retroactiveSeconds);
    setArousalActive(true);
    if (retroactiveSeconds > 0) {
      const mm = Math.floor(retroactiveSeconds / 60);
      addLog(`💗 私密计时已启动（已追溯回推 ${mm} 分钟前开始）`, "INFO");
    } else {
      addLog("💗 私密计时已启动", "INFO");
    }
  }, [addLog]);

  // 视频开播时自动开启私密计时
  useEffect(() => {
    const onVideoPlaying = (e: Event) => {
      const detail = (e as CustomEvent<{ url?: string; currentTime?: number }>).detail;
      if (settings.autoArousalOnPlay !== false && !arousalActive) {
        const offsetSec =
          detail?.currentTime && detail.currentTime > 5
            ? Math.floor(detail.currentTime)
            : 0;
        arousalStartRef.current = Date.now() - offsetSec * 1000;
        setArousalElapsed(offsetSec);
        setArousalActive(true);
        addLog(
          offsetSec > 0
            ? `💗 检测到视频播放，已自动开启私密计时（已对齐视频播放进度 ${offsetSec}秒）`
            : "💗 检测到视频开播，已自动开启私密计时",
          "INFO",
        );
      }
    };
    window.addEventListener("avplay:video-playing", onVideoPlaying);
    return () => window.removeEventListener("avplay:video-playing", onVideoPlaying);
  }, [settings.autoArousalOnPlay, arousalActive, addLog]);

  // 监听主进程发来的自动云端备份状态更新（启动自动备份、定时备份、托盘隐藏备份等）
  useEffect(() => {
    const unlisten = window.electronAPI?.sync?.onSyncStatus?.((data: any) => {
      if (data?.updatedAt) {
        setSettings((s) => ({ ...s, cloudSyncLastSync: data.updatedAt }));
        const timeStr = new Date(data.updatedAt).toLocaleTimeString();
        if (data.reason === "startup") {
          addLog(`☁️ 云端同步：进入应用自动备份成功 (${timeStr})`, "SUCCESS");
        } else if (data.reason === "interval") {
          addLog(`☁️ 云端同步：定时自动备份成功 (${timeStr})`, "SUCCESS");
        } else if (data.reason === "tray_hide") {
          addLog(`☁️ 云端同步：后台自动备份成功 (${timeStr})`, "SUCCESS");
        }
      }
    });
    return () => {
      unlisten?.();
    };
  }, [addLog]);

  // 主题
  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings.theme]);

  // 隐私模式：隐藏全部图片/内联背景图/视频预览，全部用「封面加载动画」占位
  useEffect(() => {
    const on = settings.privacyImageMode === true;
    document.documentElement.classList.toggle("privacy-image-mode", on);
    setPrivacyCoverLoaderMode(on);
    return () => {
      if (on) setPrivacyCoverLoaderMode(false);
    };
  }, [settings.privacyImageMode]);

  // Loader 样式
  useEffect(() => {
    applyLoaderStyle(settings.loaderStyle ?? "eq");
    // 隐私模式开启时，占位层动画实时跟随封面加载动画样式切换
    if (settings.privacyImageMode) refreshPrivacyLoaderStyle();
  }, [settings.loaderStyle, settings.privacyImageMode]);

  // 让设置里选中的壁纸成为加载、空态等全局场景的共同视觉来源。
  useEffect(() => {
    applyWallpaperScene(settings.downloadBackground ?? "1");
  }, [settings.downloadBackground]);

  // 全局界面缩放：经主进程 webContents.setZoomFactor 生效（设置里 85%–120%）
  useEffect(() => {
    if (!settingsLoaded) return;
    const pct = Math.max(85, Math.min(120, settings.uiZoom ?? 100));
    const setZoom = window.electronAPI?.app?.setZoom;
    if (setZoom) void setZoom(pct / 100);
  }, [settings.uiZoom, settingsLoaded]);

  // 设置变更落盘（防抖 500ms，localStorage 缓存即时同步保障刷新无闪烁）
  useEffect(() => {
    if (!settingsLoaded) return;
    syncSettingsCache(settings);
    const timer = window.setTimeout(() => {
      void trpc.storage.saveSettings.mutate(
        settings as unknown as Record<string, unknown>,
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [settings, settingsLoaded]);

  return (
    <div className="h-screen w-screen flex flex-col bg-canvas text-text-2 overflow-hidden select-none">
      <TitleBar
        currentPage={currentPage}
        onPageChange={(page) => setCurrentPage(page)}
        systemLogs={systemLogs}
        notifySound={settings.notifySound}
        onToggleSound={() =>
          setSettings((s) => ({ ...s, notifySound: !s.notifySound }))
        }
        theme={settings.theme}
        onCycleTheme={() =>
          setSettings((s) => ({
            ...s,
            theme:
              s.theme === "system"
                ? "light"
                : s.theme === "light"
                  ? "dark"
                  : "system",
          }))
        }
        consoleOpen={settings.consoleOpen}
        onToggleConsole={() =>
          setSettings((s) => ({ ...s, consoleOpen: !s.consoleOpen }))
        }
        arousalActive={arousalActive}
        arousalElapsed={arousalElapsed}
        onToggleArousal={handleToggleArousal}
        onAdjustArousal={handleAdjustArousal}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* 页面内容区 */}
      <div className="flex-1 min-h-0 overflow-hidden anim-fade-in-up">
        <div className={currentPage === "download" ? "h-full" : "hidden"}>
          <DownloadPage
            active={currentPage === "download"}
            settings={settings}
            onSettingsChange={setSettings}
            onAddSystemLog={addLog}
            logs={logs}
            setLogs={setLogs}
            addLog={addLog}
            onPlayCompletedTask={(task) => {
              setPendingPlayName(task.name);
              setCurrentPage("player");
            }}
            incomingCandidate={incomingDownloadCandidate}
            onIncomingCandidateConsumed={() => setIncomingDownloadCandidate(null)}
          />
        </div>
        <div className={currentPage === "player" ? "h-full" : "hidden"}>
          {settingsLoaded ? (
            <PlayerPage
              active={currentPage === "player"}
              videoPath={settings.video_path}
              layout={settings.playerLayout ?? "classic"}
              onAddSystemLog={addLog}
              pendingPlayName={pendingPlayName}
              onConsumePendingPlay={() => setPendingPlayName(null)}
              pendingStream={pendingStream}
              onConsumePendingStream={() => setPendingStream(null)}
              onActiveVideoChange={(name) => {
                currentPlayingFolderRef.current = name;
              }}
              onLayoutChange={(l) => {
                setSettings((s) => {
                  const updated = { ...s, playerLayout: l };
                  syncSettingsCache(updated);
                  return updated;
                });
              }}
            />
          ) : (
            <div className="w-full h-full bg-[#050506]" />
          )}
        </div>
        {currentPage === "discover" && (
          <DiscoverPage
            onAddSystemLog={addLog}
            onPlayStream={(stream) => {
              setPendingStream(stream);
              setCurrentPage("player");
            }}
          />
        )}
        {currentPage === "web" && (
          <WebPage
            onAddSystemLog={addLog}
            onCreateDownload={(candidate: WebCandidate) => {
              setIncomingDownloadCandidate({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                title: candidate.code ? `${candidate.code} ${candidate.title}` : candidate.title,
                mediaUrl: candidate.mediaUrl,
                coverUrl: candidate.coverUrl || undefined,
                previewUrl: candidate.previewUrl || undefined,
                pageUrl: candidate.pageUrl,
              });
              setCurrentPage("download");
              addLog(`已将网页候选带入下载任务：${candidate.title}`, "SUCCESS");
            }}
          />
        )}
        {currentPage === "news" && <NewsPage endpoint={settings.newsEndpoint} apiKey={settings.newsApiKey} videoPath={settings.video_path} onAddSystemLog={addLog} />}
        {currentPage === "stats" && (
          <StatsPage videoPath={settings.video_path} onAddSystemLog={addLog} />
        )}
        {currentPage === "command" && (
          <CommandCenterPage
            videoPath={settings.video_path}
            tempPath={settings.temp_path}
            onAddSystemLog={addLog}
            onPlayVideo={(name) => {
              setPendingPlayName(name);
              setCurrentPage("player");
            }}
            onNavigate={(page) => setCurrentPage(page as Page)}
          />
        )}

      </div>

      {/* 常驻隐藏抓取 webview（用于过盾抓取 missav 列表） */}
      <ScraperWebview />

      {/* 刻度图后台队列浮窗 */}
      <ThumbnailQueueWidget />

      {/* 全局控制台：悬浮覆盖层，不再挤压页面内容 */}
      {settings.consoleOpen && (
        <div className="fixed inset-x-0 bottom-0 z-[70] pointer-events-none">
          <div className="pointer-events-auto overflow-hidden rounded-t-2xl shadow-[0_-8px_40px_rgba(0,0,0,0.45)] border border-hairline">
            <GlobalConsole
              logs={logs}
              setLogs={setLogs}
              height={settings.consoleHeight}
              onHeightChange={(h) =>
                setSettings((s) => ({ ...s, consoleHeight: h }))
              }
              onClose={() => setSettings((s) => ({ ...s, consoleOpen: false }))}
            />
          </div>
        </div>
      )}

      {/* 全局设置面板（从 TitleBar 设置按钮打开） */}
      {showWizard && (
        <FirstRunGuide
          settings={settings}
          onSettingsChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
          onDone={() => {
            setShowWizard(false);
            addLog("首次运行体检完成，欢迎使用 AVPlayPro", "SUCCESS");
          }}
          onClose={() => {
            setShowWizard(false);
          }}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onSaveSettings={(next) => {
            // 保存时保证 maxConcurrentTasks 保持无上限（若用户手动设了值，也尊重；0 / 空 / 负数 → Infinity）
            const merged: AppSettings = {
              ...next,
              maxConcurrentTasks:
                next.maxConcurrentTasks && next.maxConcurrentTasks > 0
                  ? next.maxConcurrentTasks
                  : Infinity,
            };
            setSettings(merged);
            setSettingsOpen(false);
          }}
          onAddSystemLog={addLog}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* 全局成就解锁跳杯提示 */}
      <AchievementToast enabled={settings.achievementToast !== false} />
    </div>
  );
}
