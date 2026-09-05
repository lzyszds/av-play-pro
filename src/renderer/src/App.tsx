import React, { useState, useEffect, useCallback, useRef } from "react";
import { TitleBar, type Page } from "./components/TitleBar";
import { GlobalConsole } from "./components/GlobalConsole";
import { ThumbnailQueueWidget } from "./components/ThumbnailQueueWidget";
import { SettingsPanel } from "./components/download/SettingsPanel";
import { thumbnailQueue } from "./lib/thumbnailQueue";
import { DownloadPage } from "./pages/DownloadPage";
import { PlayerPage } from "./pages/PlayerPage";
import { WebPage } from "./pages/WebPage";
import { StatsPage } from "./pages/StatsPage";
import { CommandCenterPage } from "./pages/CommandCenterPage";
import { IntelPage } from "./pages/IntelPage";
import { StarMapPage } from "./pages/StarMapPage";
import { MosaicPage } from "./pages/MosaicPage";
import { RssPage } from "./pages/RssPage";
import { ActorsPage } from "./pages/ActorsPage";
import { DiscoverPage } from "./pages/DiscoverPage";
import { ScraperWebview } from "./components/ScraperWebview";
import { AchievementToast } from "./components/achievements/AchievementToast";
import { trpc } from "./lib/trpc";
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
  lastPage: "player",
  cloudSyncEndpoint: "https://avplay-sync.1024327189.workers.dev",
  cloudSyncSecret: "MySecretToken_2026",
  cloudSyncLastSync: "",
  cloudSyncAutoSync: true,
  autoArousalOnPlay: true,
};

// 合法的页面 key，用于校验持久化的 lastPage
const VALID_PAGES: Page[] = [
  "download",
  "discover",
  "player",
  "web",
  "stats",
  "command",
  "starmap",
  "intel",
  "mosaic",
  "rss",
  "actors",
];

function applyLoaderStyle(style: AppSettings["loaderStyle"]): void {
  document.documentElement.dataset.loader = style;
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
  const [currentPage, setCurrentPage] = useState<Page>("player");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemLogs, setSystemLogs] = useState<
    Array<{ text: string; level: string; time: string }>
  >([]);
  // 全局控制台日志
  const [logs, setLogs] = useState<LogMessage[]>([]);
  // 「立即查看」目标
  const [pendingPlayName, setPendingPlayName] = useState<string | null>(null);
  // 演员详情页打开目标（从卡片演员点击触发）
  const [pendingActor, setPendingActor] = useState<string | null>(null);
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
      void trpc.logger.write.mutate({ level, scope, message }).catch(() => {});
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
          .catch(() => {});
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

  // Loader 样式
  useEffect(() => {
    applyLoaderStyle(settings.loaderStyle ?? "eq");
  }, [settings.loaderStyle]);

  // 设置变更落盘（防抖 500ms）
  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = window.setTimeout(() => {
      void trpc.storage.saveSettings.mutate(
        settings as unknown as Record<string, unknown>,
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [settings, settingsLoaded]);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#f4f6f9] text-slate-600 dark:bg-slate-950 dark:text-slate-300 overflow-hidden select-none">
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
          />
        </div>
        {currentPage === "player" && (
          <PlayerPage
            videoPath={settings.video_path}
            onAddSystemLog={addLog}
            pendingPlayName={pendingPlayName}
            onConsumePendingPlay={() => setPendingPlayName(null)}
            onActiveVideoChange={(name) => {
              currentPlayingFolderRef.current = name;
            }}
            onOpenActor={(name) => {
              setPendingActor(name);
              setCurrentPage("actors");
            }}
          />
        )}
        {currentPage === "discover" && (
          <DiscoverPage onAddSystemLog={addLog} />
        )}
        {currentPage === "web" && <WebPage onAddSystemLog={addLog} />}
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

        {currentPage === "intel" && (
          <IntelPage videoPath={settings.video_path} onAddSystemLog={addLog} />
        )}
        {currentPage === "starmap" && (
          <StarMapPage videoPath={settings.video_path} onAddSystemLog={addLog} />
        )}
        {currentPage === "mosaic" && (
          <MosaicPage videoPath={settings.video_path} onAddSystemLog={addLog} />
        )}
        {currentPage === "rss" && (
          <RssPage videoPath={settings.video_path} onAddSystemLog={addLog} />
        )}
        {currentPage === "actors" && (
          <ActorsPage
            videoPath={settings.video_path}
            onAddSystemLog={addLog}
            onPlayVideo={(name) => {
              setPendingPlayName(name);
              setCurrentPage("player");
            }}
            initialActorName={pendingActor}
            onConsumeInitialActor={() => setPendingActor(null)}
          />
        )}
      </div>

      {/* 常驻隐藏抓取 webview（用于过盾抓取 missav 列表） */}
      <ScraperWebview />

      {/* 刻度图后台队列浮窗 */}
      <ThumbnailQueueWidget />

      {/* 全局控制台 */}
      {settings.consoleOpen && (
        <GlobalConsole
          logs={logs}
          setLogs={setLogs}
          height={settings.consoleHeight}
          onHeightChange={(h) =>
            setSettings((s) => ({ ...s, consoleHeight: h }))
          }
          onClose={() => setSettings((s) => ({ ...s, consoleOpen: false }))}
        />
      )}

      {/* 全局设置面板（从 TitleBar 设置按钮打开） */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center anim-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <div className="anim-pop-in" style={{ width: "100%", maxWidth: 680 }}>
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
          </div>
        </div>
      )}

      {/* 全局成就解锁跳杯提示 */}
      <AchievementToast />
    </div>
  );
}
