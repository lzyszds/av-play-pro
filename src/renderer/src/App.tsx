import React, { useState, useEffect } from "react";
import { TitleBar } from "./components/TitleBar";
import { DownloadPage } from "./pages/DownloadPage";
import { PlayerPage } from "./pages/PlayerPage";
import { WebPage } from "./pages/WebPage";
import { trpc } from "./lib/trpc";
import type { AppSettings } from "./pages/download/types";

type Page = "download" | "player" | "web";

const DEFAULT_SETTINGS = {
  video_path: "M:\\video\\videos\\",
  temp_path: "M:\\video\\temp\\",
  defaultFormat: "MP4" as const,
  defaultThreads: 16,
  maxConcurrentTasks: 3,
  autoMerge: true,
  proxyUrl: "",
  nm3u8dlPath: "N_m3u8DL-RE.exe",
} satisfies AppSettings;

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("download");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [systemLogs, setSystemLogs] = useState<
    Array<{ text: string; level: string; time: string }>
  >([]);

  useEffect(() => {
    let disposed = false;
    trpc.storage.getSettings
      .query()
      .then((saved) => {
        if (!disposed) {
          setSettings({
            ...DEFAULT_SETTINGS,
            ...(saved as Partial<AppSettings>),
          });
        }
      })
      .finally(() => {
        if (!disposed) setSettingsLoaded(true);
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    void trpc.storage.saveSettings.mutate(
      settings as unknown as Record<string, unknown>,
    );
  }, [settings, settingsLoaded]);

  const addSystemLog = (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => {
    const now = new Date();
    const time = now.toLocaleTimeString("zh-CN", { hour12: false });
    setSystemLogs((prev) => [...prev.slice(-200), { text, level, time }]);
  };

  return (
    <div className="h-screen w-screen flex flex-col font-sans bg-[#f4f6f9] text-slate-600 overflow-hidden select-none">
      <TitleBar
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        systemLogs={systemLogs}
      />
      <div className="flex-1 min-h-0 overflow-hidden anim-fade-in-up">
        <div className={currentPage === "download" ? "h-full" : "hidden"}>
          <DownloadPage
            settings={settings}
            onSettingsChange={setSettings}
            onAddSystemLog={addSystemLog}
          />
        </div>
        {currentPage === "player" && (
          <PlayerPage
            videoPath={settings.video_path}
            onAddSystemLog={addSystemLog}
          />
        )}
        {currentPage === "web" && <WebPage onAddSystemLog={addSystemLog} />}
      </div>
    </div>
  );
}
