import React from "react";
import { Download, Globe, Minus, Play, Square, Terminal, X } from "lucide-react";
import { trpc } from "../lib/trpc";

type Page = "download" | "player" | "web";

interface TitleBarProps {
  currentPage: Page;
  onPageChange: (page: Page) => void;
  systemLogs: Array<{ text: string; level: string; time: string }>;
}

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;

const pages: Array<{ key: Page; label: string; icon: typeof Download }> = [
  { key: "download", label: "下载管理", icon: Download },
  { key: "player", label: "播放器", icon: Play },
  { key: "web", label: "网页", icon: Globe },
];

export const TitleBar: React.FC<TitleBarProps> = ({
  currentPage,
  onPageChange,
  systemLogs,
}) => {
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
