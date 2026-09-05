import React, { useState, useEffect } from "react";
import {
  Trophy,
  Award,
  Crown,
  Moon,
  Bookmark,
  Zap,
  Dices,
  Film,
  ShieldCheck,
  Cloud,
  Flame,
  Package,
  X,
  Sparkles,
} from "lucide-react";

export interface UnlockedAchievement {
  id: string;
  title: string;
  desc: string;
  tier: "bronze" | "silver" | "gold" | "platinum";
  icon?: string;
}

const TIER_CONFIG = {
  bronze: {
    label: "青铜勋章",
    border: "border-amber-700/50",
    bg: "from-amber-950/90 via-slate-900/95 to-stone-900/90",
    glow: "shadow-[0_8px_25px_rgba(180,83,9,0.25)]",
    badge: "bg-amber-800/40 text-amber-300 border-amber-700/60",
    iconColor: "text-amber-500",
  },
  silver: {
    label: "白银勋章",
    border: "border-slate-400/50",
    bg: "from-slate-900/95 via-slate-800/95 to-slate-900/95",
    glow: "shadow-[0_8px_25px_rgba(148,163,184,0.25)]",
    badge: "bg-slate-700/50 text-slate-200 border-slate-500/60",
    iconColor: "text-slate-300",
  },
  gold: {
    label: "黄金荣耀",
    border: "border-amber-400/60",
    bg: "from-amber-950/90 via-slate-950/95 to-yellow-950/90",
    glow: "shadow-[0_8px_30px_rgba(245,158,11,0.35)]",
    badge: "bg-amber-500/20 text-amber-300 border-amber-400/50",
    iconColor: "text-amber-400",
  },
  platinum: {
    label: "白金绝巅",
    border: "border-cyan-400/70",
    bg: "from-cyan-950/90 via-slate-950/95 to-blue-950/90",
    glow: "shadow-[0_10px_35px_rgba(6,182,212,0.4)]",
    badge: "bg-cyan-500/20 text-cyan-300 border-cyan-400/60",
    iconColor: "text-cyan-400",
  },
};

function renderIcon(iconName: string = "Trophy", className = "w-5 h-5") {
  switch (iconName) {
    case "Moon":
      return <Moon className={className} />;
    case "Bookmark":
      return <Bookmark className={className} />;
    case "Zap":
      return <Zap className={className} />;
    case "Dices":
      return <Dices className={className} />;
    case "Film":
      return <Film className={className} />;
    case "ShieldCheck":
      return <ShieldCheck className={className} />;
    case "Cloud":
      return <Cloud className={className} />;
    case "Crown":
      return <Crown className={className} />;
    case "Flame":
      return <Flame className={className} />;
    case "Package":
      return <Package className={className} />;
    default:
      return <Trophy className={className} />;
  }
}

export function triggerAchievementToast(ach: UnlockedAchievement): void {
  window.dispatchEvent(
    new CustomEvent("avplay:achievement-unlocked", { detail: ach }),
  );
}

export const AchievementToast: React.FC = () => {
  const [current, setCurrent] = useState<UnlockedAchievement | null>(null);
  const [queue, setQueue] = useState<UnlockedAchievement[]>([]);

  useEffect(() => {
    const onUnlocked = (e: Event) => {
      const ach = (e as CustomEvent<UnlockedAchievement>).detail;
      if (!ach) return;
      setQueue((prev) => [...prev, ach]);
    };

    window.addEventListener("avplay:achievement-unlocked", onUnlocked);
    return () => {
      window.removeEventListener("avplay:achievement-unlocked", onUnlocked);
    };
  }, []);

  useEffect(() => {
    if (!current && queue.length > 0) {
      const [next, ...rest] = queue;
      setCurrent(next);
      setQueue(rest);
    }
  }, [current, queue]);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => {
      setCurrent(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [current]);

  if (!current) return null;

  const cfg = TIER_CONFIG[current.tier] || TIER_CONFIG.bronze;

  return (
    <div className="fixed bottom-6 right-6 z-[9999] pointer-events-auto max-w-sm w-full animate-in slide-in-from-bottom-5 fade-in duration-300">
      <div
        className={`relative overflow-hidden rounded-xl border bg-gradient-to-r ${cfg.bg} ${cfg.border} ${cfg.glow} p-4 backdrop-blur-2xl shadow-2xl text-white`}
      >
        {/* 金属流光微扫特效 */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-[shimmer_2.5s_infinite] pointer-events-none" />

        <div className="relative flex items-start gap-3.5">
          {/* 左侧发光勋章图标 */}
          <div className="shrink-0 p-2.5 rounded-xl bg-white/10 ring-1 ring-white/20 shadow-inner flex items-center justify-center">
            <div className={`${cfg.iconColor} drop-shadow-[0_0_10px_currentColor]`}>
              {renderIcon(current.icon, "w-6 h-6")}
            </div>
          </div>

          {/* 中间文字详情 */}
          <div className="flex-1 min-w-0 pr-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-400/95 flex items-center gap-1">
                <Sparkles className="w-3 h-3 animate-spin" />
                ACHIEVEMENT UNLOCKED
              </span>
              <span
                className={`text-[9px] px-1.5 py-0.2 rounded border font-semibold ${cfg.badge}`}
              >
                {cfg.label}
              </span>
            </div>
            <h4 className="text-sm font-bold text-white tracking-tight truncate drop-shadow-sm">
              {current.title}
            </h4>
            <p className="text-[11px] text-slate-300/90 leading-tight mt-0.5 line-clamp-2">
              {current.desc}
            </p>
          </div>

          {/* 右上关闭按钮 */}
          <button
            type="button"
            onClick={() => setCurrent(null)}
            className="shrink-0 text-slate-400 hover:text-white p-1 rounded-md hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
