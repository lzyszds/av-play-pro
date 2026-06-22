import React from "react";
import {
  BarChart3,
  Download,
  Globe,
  Minus,
  Play,
  Square,
  Terminal,
  TerminalSquare,
  X,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  Monitor,
  Heart,
  Settings as SettingsIcon,
  Network,
  Newspaper,
  Grid3X3,
  Rss,
  Gauge,
  Users,
} from "lucide-react";
import { trpc } from "../lib/trpc";
import type { ThemeMode } from "../pages/download/types";

export type Page =
  | "download"
  | "player"
  | "web"
  | "stats"
  | "command"
  | "starmap"
  | "intel"
  | "mosaic"
  | "rss"
  | "actors";

interface TitleBarProps {
  currentPage: Page;
  onPageChange: (page: Page) => void;
  systemLogs: Array<{ text: string; level: string; time: string }>;
  notifySound: boolean;
  onToggleSound: () => void;
  theme: ThemeMode;
  onCycleTheme: () => void;
  consoleOpen: boolean;
  onToggleConsole: () => void;
  arousalActive: boolean;
  arousalElapsed: number;
  onToggleArousal: () => void;
  onOpenSettings: () => void;
}

function formatArousalTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;

const pages: Array<{ key: Page; label: string; icon: typeof Download }> = [
  { key: "download", label: "下载管理", icon: Download },
  { key: "player", label: "播放器", icon: Play },
  { key: "actors", label: "演员", icon: Users },
  { key: "web", label: "网页", icon: Globe },
  { key: "command", label: "指挥", icon: Gauge },
  { key: "stats", label: "统计", icon: BarChart3 },
  { key: "intel", label: "情报", icon: Newspaper },
];

const themeMeta: Record<ThemeMode, { icon: typeof Sun; label: string }> = {
  system: { icon: Monitor, label: "跟随系统" },
  light: { icon: Sun, label: "浅色" },
  dark: { icon: Moon, label: "深色" },
};

export const TitleBar: React.FC<TitleBarProps> = ({
  currentPage,
  onPageChange,
  systemLogs,
  notifySound,
  onToggleSound,
  theme,
  onCycleTheme,
  consoleOpen,
  onToggleConsole,
  arousalActive,
  arousalElapsed,
  onToggleArousal,
  onOpenSettings,
}) => {
  const ThemeIcon = themeMeta[theme].icon;
  return (
    <div
      className="h-9 bg-slate-900 flex items-center justify-between select-none shrink-0"
      style={drag}
    >
      <div className="flex items-center h-full min-w-0">
        <div className="flex items-center gap-2 px-3 shrink-0">
          <img
            src="./logo.png"
            alt="AVPlayPro"
            className="w-4 h-4 rounded-sm object-contain"
          />
          <span className="text-xs text-slate-300 font-medium truncate">
            AVPlayPro
          </span>
        </div>
        <div className="flex items-center gap-1 pl-2" style={noDrag}>
          {pages.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onPageChange(key)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition cursor-pointer ${
                currentPage === key
                  ? "bg-amber-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="flex-1 h-full flex items-center justify-end min-w-0 px-4"
        style={drag}
      >
        {systemLogs.length > 0 && (
          <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 max-w-md truncate">
            <Terminal className="w-3 h-3 text-emerald-500 shrink-0" />
            <span className="truncate">
              {systemLogs[systemLogs.length - 1].text}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center h-full" style={noDrag}>
        <button
          type="button"
          onClick={onToggleArousal}
          title={
            arousalActive
              ? `私密计时进行中（点击结束并记录） · ${formatArousalTime(arousalElapsed)}`
              : "开启私密计时（关闭后记录到统计）"
          }
          className={`h-full flex items-center gap-1.5 px-2.5 transition cursor-pointer ${
            arousalActive
              ? "bg-rose-600 text-white"
              : "text-slate-400 hover:text-rose-400 hover:bg-slate-800"
          }`}
        >
          <Heart
            className={`w-3.5 h-3.5 ${arousalActive ? "animate-pulse fill-current" : ""}`}
          />
          {arousalActive && (
            <span className="text-[10px] font-mono font-bold tabular-nums">
              {formatArousalTime(arousalElapsed)}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onToggleConsole}
          title={consoleOpen ? "隐藏底部控制台" : "显示底部控制台"}
          className={`w-9 h-full flex items-center justify-center transition cursor-pointer ${
            consoleOpen
              ? "text-amber-400 bg-slate-800"
              : "text-slate-400 hover:text-amber-400 hover:bg-slate-800"
          }`}
        >
          <TerminalSquare className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onToggleSound}
          title={
            notifySound ? "提示音已开启 (点击关闭)" : "提示音已关闭 (点击开启)"
          }
          className="w-9 h-full flex items-center justify-center text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition cursor-pointer"
        >
          {notifySound ? (
            <Volume2 className="w-3.5 h-3.5" />
          ) : (
            <VolumeX className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={onCycleTheme}
          title={`主题：${themeMeta[theme].label} (点击切换)`}
          className="w-9 h-full flex items-center justify-center text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition cursor-pointer"
        >
          <ThemeIcon className="w-3.5 h-3.5" />
        </button>
        {/* 全局设置按钮 */}
        <button
          type="button"
          onClick={onOpenSettings}
          title="打开设置面板"
          className="w-9 h-full flex items-center justify-center text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition cursor-pointer"
        >
          <SettingsIcon className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-slate-700 mx-1" />
        <button
          type="button"
          onClick={() => trpc.window.minimize.mutate()}
          className="w-10 h-full flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => trpc.window.maximize.mutate()}
          className="w-10 h-full flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={() => trpc.window.close.mutate()}
          className="w-10 h-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-600 transition cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
