import React, { useState, useEffect, useCallback } from "react";
import {
  Trophy,
  Moon,
  Bookmark,
  Zap,
  Dices,
  Film,
  ShieldCheck,
  Cloud,
  Crown,
  Flame,
  Package,
  Lock,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { trpc } from "../../lib/trpc";
import { triggerAchievementToast } from "../achievements/AchievementToast";

export type TierType = "all" | "platinum" | "gold" | "silver" | "bronze";

export interface AchievementItem {
  id: string;
  title: string;
  desc: string;
  tier: "bronze" | "silver" | "gold" | "platinum";
  icon: string;
  target: number;
  unit?: string;
  current?: number;
  unlocked: boolean;
  unlockedAt?: string | null;
}

const TIER_STYLES: Record<
  "bronze" | "silver" | "gold" | "platinum",
  {
    label: string;
    border: string;
    bg: string;
    badge: string;
    iconGlow: string;
    progress: string;
  }
> = {
  bronze: {
    label: "青铜",
    border: "border-amber-800/40 dark:border-amber-800/60",
    bg: "bg-gradient-to-br from-amber-950/20 via-slate-900/40 to-slate-950/80",
    badge: "bg-amber-900/30 text-amber-500 border-amber-800/40",
    iconGlow: "text-amber-600 drop-shadow-[0_0_8px_rgba(217,119,6,0.3)]",
    progress: "from-amber-600 to-amber-700",
  },
  silver: {
    label: "白银",
    border: "border-slate-400/40 dark:border-slate-500/50",
    bg: "bg-gradient-to-br from-slate-800/20 via-slate-900/40 to-slate-950/80",
    badge: "bg-slate-700/30 text-slate-300 border-slate-500/40",
    iconGlow: "text-slate-300 drop-shadow-[0_0_8px_rgba(203,213,225,0.4)]",
    progress: "from-slate-400 to-slate-300",
  },
  gold: {
    label: "黄金",
    border: "border-amber-400/50 dark:border-amber-400/60 shadow-[0_4px_20px_-8px_rgba(245,158,11,0.25)]",
    bg: "bg-gradient-to-br from-amber-950/30 via-slate-900/50 to-slate-950/90",
    badge: "bg-amber-500/20 text-amber-400 border-amber-400/40",
    iconGlow: "text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.6)]",
    progress: "from-amber-500 to-yellow-400",
  },
  platinum: {
    label: "白金绝巅",
    border: "border-cyan-400/60 shadow-[0_4px_25px_-6px_rgba(6,182,212,0.35)] ring-1 ring-cyan-400/30",
    bg: "bg-gradient-to-br from-cyan-950/40 via-slate-900/60 to-blue-950/90",
    badge: "bg-cyan-500/25 text-cyan-300 border-cyan-400/50",
    iconGlow: "text-cyan-400 drop-shadow-[0_0_15px_rgba(6,182,212,0.8)]",
    progress: "from-cyan-400 via-sky-400 to-blue-500",
  },
};

function renderAchievementIcon(name: string, className = "w-6 h-6") {
  switch (name) {
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

export const AchievementsPanel: React.FC = () => {
  const [filterTier, setFilterTier] = useState<TierType>("all");
  const [checking, setChecking] = useState(false);
  const [achievements, setAchievements] = useState<AchievementItem[]>([]);
  const [totalUnlocked, setTotalUnlocked] = useState(0);
  const [totalCount, setTotalCount] = useState(11);
  const [completionRate, setCompletionRate] = useState(0);

  const loadData = useCallback(async () => {
    try {
      const res = await trpc.achievements.getAll.query();
      if (res) {
        setAchievements(res.achievements as AchievementItem[]);
        setTotalUnlocked(res.totalUnlocked);
        setTotalCount(res.totalCount);
        setCompletionRate(res.completionRate);
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRunCheck = async () => {
    setChecking(true);
    try {
      const res = await trpc.achievements.checkAndUnlock.mutate({});
      if (res?.newlyUnlocked && res.newlyUnlocked.length > 0) {
        for (const ach of res.newlyUnlocked) {
          triggerAchievementToast({
            id: ach.id,
            title: ach.title,
            desc: ach.desc,
            tier: ach.tier,
            icon: ach.icon,
          });
        }
      }
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setChecking(false);
    }
  };

  const filtered = achievements.filter((a: AchievementItem) => {
    if (filterTier === "all") return true;
    return a.tier === filterTier;
  });

  return (
    <div className="space-y-6">
      {/* 顶部荣誉大看板 */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-950 to-amber-950/60 border border-slate-800 p-6 shadow-2xl text-white">
        <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 p-0.5 shadow-lg shadow-amber-500/20">
              <div className="w-full h-full rounded-[14px] bg-slate-950 flex items-center justify-center text-amber-400">
                <Trophy className="w-8 h-8 drop-shadow-[0_0_12px_rgba(245,158,11,0.6)]" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                  成就荣耀殿堂
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30 font-mono">
                    HALL OF FAME
                  </span>
                </h3>
              </div>
              <p className="text-xs text-slate-400">
                记录你在片库探索、暗夜观影、私密耐力与云端漫游中达成的各项巅峰里程碑。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto">
            {/* 总体解锁度进度 */}
            <div className="bg-slate-900/80 border border-slate-800 px-4 py-3 rounded-xl min-w-[200px] shadow-sm">
              <div className="flex justify-between items-center text-xs font-bold mb-1.5">
                <span className="text-slate-400">解锁进度</span>
                <span className="text-amber-400 font-mono">
                  {totalUnlocked} / {totalCount} ({completionRate}%)
                </span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 via-rose-500 to-amber-300 transition-all duration-500 rounded-full shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                  style={{ width: `${completionRate}%` }}
                />
              </div>
            </div>

            {/* 巡检检测按钮 */}
            <button
              type="button"
              onClick={handleRunCheck}
              disabled={checking}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-lg shadow-amber-500/20 disabled:opacity-50 cursor-pointer shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} />
              <span>{checking ? "巡检评估中..." : "一键成就检测"}</span>
            </button>
          </div>
        </div>

        {/* 筛选标签 */}
        <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold text-slate-400 mr-2">勋章等级筛选:</span>
          {[
            { id: "all", label: "全部" },
            { id: "platinum", label: "白金绝巅" },
            { id: "gold", label: "黄金荣耀" },
            { id: "silver", label: "白银勋章" },
            { id: "bronze", label: "青铜勋章" },
          ].map((t) => {
            const active = filterTier === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilterTier(t.id as TierType)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  active
                    ? "bg-amber-400/90 text-slate-950 shadow-sm"
                    : "bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 成就网格卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((ach: AchievementItem) => {
          const style = TIER_STYLES[ach.tier] || TIER_STYLES.bronze;
          const currentVal = ach.current ?? 0;
          const targetVal = ach.target || 1;
          const pct = Math.min(100, Math.round((currentVal / targetVal) * 100));

          return (
            <div
              key={ach.id}
              className={`relative overflow-hidden rounded-2xl border p-5 transition-all duration-300 ${
                ach.unlocked
                  ? `${style.border} ${style.bg} hover:-translate-y-0.5 shadow-lg`
                  : "border-slate-800/60 bg-slate-950/40 opacity-70 hover:opacity-90"
              }`}
            >
              {/* 解锁光晕 */}
              {ach.unlocked && (
                <div className="absolute top-0 right-0 w-32 h-32 bg-amber-400/5 rounded-full blur-2xl pointer-events-none" />
              )}

              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${
                      ach.unlocked
                        ? `${style.badge} bg-slate-900/60`
                        : "border-slate-800 bg-slate-900/40 text-slate-600"
                    }`}
                  >
                    {ach.unlocked ? (
                      <div className={style.iconGlow}>{renderAchievementIcon(ach.icon)}</div>
                    ) : (
                      <Lock className="w-5 h-5 text-slate-600" />
                    )}
                  </div>
                  <div>
                    <h4
                      className={`text-sm font-bold tracking-tight ${
                        ach.unlocked ? "text-white" : "text-slate-400"
                      }`}
                    >
                      {ach.title}
                    </h4>
                    <span
                      className={`inline-block text-[10px] px-1.5 py-0.2 rounded border font-semibold mt-0.5 ${style.badge}`}
                    >
                      {style.label}
                    </span>
                  </div>
                </div>

                {ach.unlocked ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded-full shadow-sm">
                    <CheckCircle2 className="w-3 h-3" />
                    已达成
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-slate-500 font-medium">
                    {pct}%
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-400 leading-relaxed mb-4 min-h-[36px]">
                {ach.desc}
              </p>

              {/* 进度或解锁时间条 */}
              <div className="pt-3 border-t border-slate-800/60">
                {ach.unlocked ? (
                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>达成时间</span>
                    <span className="text-slate-400">
                      {ach.unlockedAt ? new Date(ach.unlockedAt).toLocaleDateString() : "近期达成"}
                    </span>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
                      <span>当前进展</span>
                      <span>
                        {currentVal} / {targetVal} {ach.unit || ""}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r ${style.progress} rounded-full transition-all duration-300`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
