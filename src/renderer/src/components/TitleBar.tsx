import React, { useState, useRef, useEffect } from "react";
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
  Newspaper,
  Gauge,
  Users,
  Compass,
  Clock,
  RotateCcw,
} from "lucide-react";
import { trpc } from "../lib/trpc";
import type { ThemeMode } from "../pages/download/types";
import { Tooltip } from "./common/Tooltip";

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
  | "actors"
  | "discover";

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
  onAdjustArousal?: (seconds: number) => void;
  onOpenSettings: () => void;
}

function formatArousalTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;

const pages: Array<{
  key: Page;
  label: string;
  desc: string;
  icon: typeof Download;
}> = [
  {
    key: "player",
    label: "播放器",
    desc: "本地影视播控、高能热力波形图与微动切片片库",
    icon: Play,
  },
  {
    key: "download",
    label: "下载管理",
    desc: "M3U8 极速多线程分片下载与任务队列",
    icon: Download,
  },
  {
    key: "discover",
    label: "发现",
    desc: "全网热度排行榜与新鲜番组实时探索",
    icon: Compass,
  },
  {
    key: "actors",
    label: "演员",
    desc: "女优演员档案、参演统计与关联作品",
    icon: Users,
  },
  {
    key: "web",
    label: "网页",
    desc: "内置无痕网页嗅探器与资源捕获",
    icon: Globe,
  },
  {
    key: "command",
    label: "指挥",
    desc: "片库健康度体检、Emby软链接整理与去重修复",
    icon: Gauge,
  },
  {
    key: "stats",
    label: "统计",
    desc: "观影战斗力战报、时段规律与成就荣耀殿堂",
    icon: BarChart3,
  },
  {
    key: "intel",
    label: "情报",
    desc: "发行片商资讯与近期业界动态",
    icon: Newspaper,
  },
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
  onAdjustArousal,
  onOpenSettings,
}) => {
  const [arousalMenu, setArousalMenu] = useState<{ x: number; y: number } | null>(null);
  const arousalMenuRef = useRef<HTMLDivElement | null>(null);
  const ThemeIcon = themeMeta[theme].icon;

  // 关闭右键菜单
  useEffect(() => {
    if (!arousalMenu) return;
    const close = (e: MouseEvent) => {
      if (arousalMenuRef.current?.contains(e.target as Node)) return;
      setArousalMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [arousalMenu]);

  const handleHeartContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setArousalMenu({ x: e.clientX, y: e.clientY });
  };

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
          {pages.map(({ key, label, desc, icon: Icon }) => (
            <Tooltip key={key} content={desc} placement="bottom" delay={180}>
              <button
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
            </Tooltip>
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

      <div className="flex items-center h-full relative" style={noDrag}>
        {/* 私密计时按钮 */}
        <Tooltip
          content={
            arousalActive
              ? `私密计时进行中 · 点击结束并计入战报 (${formatArousalTime(arousalElapsed)}) (右键调整/追溯)`
              : "私密计时（播放视频时默认自动开启，点击立即开启，右键追溯推前）"
          }
          placement="bottom"
          delay={150}
        >
          <button
            type="button"
            onClick={onToggleArousal}
            onContextMenu={handleHeartContextMenu}
            className={`h-full flex items-center gap-1.5 px-2.5 transition cursor-pointer ${
              arousalActive
                ? "bg-rose-600 text-white shadow-sm"
                : "text-slate-400 hover:text-rose-400 hover:bg-slate-800"
            }`}
          >
            <Heart
              className={`w-3.5 h-3.5 ${arousalActive ? "animate-pulse fill-current text-white" : ""}`}
            />
            {arousalActive && (
              <span className="text-[10px] font-mono font-bold tabular-nums">
                {formatArousalTime(arousalElapsed)}
              </span>
            )}
          </button>
        </Tooltip>

        {/* 底部日志控制台 */}
        <Tooltip
          content={consoleOpen ? "隐藏底部实时日志控制台" : "展开底部实时日志控制台"}
          placement="bottom"
        >
          <button
            type="button"
            onClick={onToggleConsole}
            className={`w-9 h-full flex items-center justify-center transition cursor-pointer ${
              consoleOpen
                ? "text-amber-400 bg-slate-800"
                : "text-slate-400 hover:text-amber-400 hover:bg-slate-800"
            }`}
          >
            <TerminalSquare className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        {/* 提示音开关 */}
        <Tooltip
          content={notifySound ? "任务完成提示音：已开启 (点击静音)" : "任务完成提示音：已关闭 (点击开启)"}
          placement="bottom"
        >
          <button
            type="button"
            onClick={onToggleSound}
            className="w-9 h-full flex items-center justify-center text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition cursor-pointer"
          >
            {notifySound ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
          </button>
        </Tooltip>

        {/* 主题切换 */}
        <Tooltip content={`当前外观：${themeMeta[theme].label} (点击切换深/浅/系统)`} placement="bottom">
          <button
            type="button"
            onClick={onCycleTheme}
            className="w-9 h-full flex items-center justify-center text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition cursor-pointer"
          >
            <ThemeIcon className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        {/* 全局设置按钮 */}
        <Tooltip content="偏好设置与 Cloudflare 云端同步" placement="bottom">
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-9 h-full flex items-center justify-center text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition cursor-pointer"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <div className="w-px h-4 bg-slate-700 mx-1" />

        {/* 窗口控制按钮 */}
        <Tooltip content="最小化窗口" placement="bottom">
          <button
            type="button"
            onClick={() => trpc.window.minimize.mutate()}
            className="w-10 h-full flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="最大化 / 还原窗口" placement="bottom">
          <button
            type="button"
            onClick={() => trpc.window.maximize.mutate()}
            className="w-10 h-full flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition cursor-pointer"
          >
            <Square className="w-3 h-3" />
          </button>
        </Tooltip>
        <Tooltip content="关闭应用" placement="bottom">
          <button
            type="button"
            onClick={() => trpc.window.close.mutate()}
            className="w-10 h-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-600 transition cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        {/* 私密计时右键菜单 (追溯补录/调整) */}
        {arousalMenu && (
          <div
            ref={arousalMenuRef}
            style={{
              position: "fixed",
              top: arousalMenu.y + 10,
              left: Math.min(window.innerWidth - 200, arousalMenu.x - 100),
              zIndex: 999999,
            }}
            className="w-48 bg-slate-900 border border-slate-700 rounded-xl p-1.5 shadow-2xl backdrop-blur-xl text-white text-xs animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 border-b border-slate-800 mb-1 flex items-center justify-between">
              <span>私密时间追溯调整</span>
              <Clock className="w-3 h-3 text-rose-400" />
            </div>
            <button
              type="button"
              onClick={() => {
                onAdjustArousal?.((arousalActive ? arousalElapsed : 0) + 300);
                setArousalMenu(null);
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 hover:text-amber-300 transition flex items-center justify-between cursor-pointer"
            >
              <span>推前 5 分钟 (已开始5m)</span>
              <span className="text-[10px] font-mono text-slate-500">+5m</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onAdjustArousal?.((arousalActive ? arousalElapsed : 0) + 900);
                setArousalMenu(null);
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 hover:text-amber-300 transition flex items-center justify-between cursor-pointer"
            >
              <span>推前 15 分钟 (已开始15m)</span>
              <span className="text-[10px] font-mono text-slate-500">+15m</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onAdjustArousal?.((arousalActive ? arousalElapsed : 0) + 1800);
                setArousalMenu(null);
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 hover:text-amber-300 transition flex items-center justify-between cursor-pointer"
            >
              <span>推前 30 分钟 (已开始30m)</span>
              <span className="text-[10px] font-mono text-slate-500">+30m</span>
            </button>
            {arousalActive && (
              <>
                <div className="my-1 border-t border-slate-800" />
                <button
                  type="button"
                  onClick={() => {
                    onAdjustArousal?.(0);
                    setArousalMenu(null);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-rose-400 transition flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>清零重新计时</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
