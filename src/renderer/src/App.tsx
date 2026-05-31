import React, { useState, useEffect } from "react";
import { Header } from "./components/Header";
import { TitleBar } from "./components/TitleBar";
import { DownloadPage } from "./pages/DownloadPage";
import { PlayerPage } from "./pages/PlayerPage";

type Page = "download" | "player";

const DEFAULT_SETTINGS = {
  video_path: "M:\\video\\videos\\",
  temp_path: "M:\\video\\temp\\",
  defaultFormat: "MP4" as const,
  defaultThreads: 16,
  maxConcurrentTasks: 3,
  autoMerge: true,
  proxyUrl: "",
  nm3u8dlPath: "N_m3u8DL-RE.exe",
};

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("download");
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem("avplaypro_settings_v4");
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_SETTINGS;
  });
  const [systemLogs, setSystemLogs] = useState<
    Array<{ text: string; level: string; time: string }>
  >([]);

  useEffect(() => {
    localStorage.setItem("avplaypro_settings_v4", JSON.stringify(settings));
  }, [settings]);

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
      <TitleBar />
      <Header
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        systemLogs={systemLogs}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        {currentPage === "download" && (
          <DownloadPage
            settings={settings}
            onSettingsChange={setSettings}
            onAddSystemLog={addSystemLog}
          />
        )}
        {currentPage === "player" && (
          <PlayerPage
            videoPath={settings.video_path}
            onAddSystemLog={addSystemLog}
          />
        )}
      </div>
    </div>
  );
}
