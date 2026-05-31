import React, { useState, useEffect, useCallback } from "react";
import { TitleBar } from "./components/TitleBar";
import { GlobalConsole } from "./components/GlobalConsole";
import { DownloadPage } from "./pages/DownloadPage";
import { PlayerPage } from "./pages/PlayerPage";
import { WebPage } from "./pages/WebPage";
import { StatsPage } from "./pages/StatsPage";
import { trpc } from "./lib/trpc";
import type { AppSettings, LogMessage } from "./pages/download/types";

type Page = "download" | "player" | "web" | "stats";

const DEFAULT_SETTINGS: AppSettings = {
  video_path: "",
  temp_path: "",
  defaultFormat: "MP4",
  defaultThreads: 16,
  maxConcurrentTasks: 3,
  autoMerge: true,
  proxyUrl: "",
  nm3u8dlPath: "N_m3u8DL-RE.exe",
  theme: "system",
  closeAction: "ask",
  notifyOnComplete: true,
  notifySound: true,
  consoleOpen: true,
  consoleHeight: 220,
  globalSpeedLimit: "",
};

function applyTheme(mode: AppSettings["theme"]): void {
  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("download");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [systemLogs, setSystemLogs] = useState<
    Array<{ text: string; level: string; time: string }>
  >([]);
  // 全局控制台日志
  const [logs, setLogs] = useState<LogMessage[]>([]);
  // 「立即查看」目标
  const [pendingPlayName, setPendingPlayName] = useState<string | null>(null);

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
    const forward = (level: "error" | "warn", scope: string, message: string) => {
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
        };
        if (!merged.video_path?.trim()) merged.video_path = defaults.video_path;
        if (!merged.temp_path?.trim()) merged.temp_path = defaults.temp_path;
        setSettings(merged);
      })
      .finally(() => {
        if (!disposed) setSettingsLoaded(true);
      });

    return () => {
      disposed = true;
    };
  }, []);

  // 主题
  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings.theme]);

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
    <div className="h-screen w-screen flex flex-col font-sans bg-[#f4f6f9] text-slate-600 dark:bg-slate-950 dark:text-slate-300 overflow-hidden select-none">
      <TitleBar
        currentPage={currentPage}
        onPageChange={setCurrentPage}
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
      />

      {/* 页面内容区 */}
      <div className="flex-1 min-h-0 overflow-hidden anim-fade-in-up">
        <div className={currentPage === "download" ? "h-full" : "hidden"}>
          <DownloadPage
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
          />
        )}
        {currentPage === "web" && <WebPage onAddSystemLog={addLog} />}
        {currentPage === "stats" && (
          <StatsPage
            videoPath={settings.video_path}
            onAddSystemLog={addLog}
          />
        )}
      </div>

      {/* 全局控制台 */}
      {settings.consoleOpen && (
        <GlobalConsole
          logs={logs}
          setLogs={setLogs}
          height={settings.consoleHeight}
          onHeightChange={(h) =>
            setSettings((s) => ({ ...s, consoleHeight: h }))
          }
        />
      )}
    </div>
  );
}
