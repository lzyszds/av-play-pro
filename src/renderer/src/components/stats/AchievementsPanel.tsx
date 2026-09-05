import React, { useState, useEffect, useCallback, useMemo } from "react";
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
  Sparkles,
  Award,
} from "lucide-react";
import { trpc } from "../../lib/trpc";
import { triggerAchievementToast } from "../achievements/AchievementToast";

export type TierFilter = "all" | "platinum" | "gold" | "silver" | "bronze";
export type StatusFilter = "all" | "unlocked" | "locked";

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

const TIER_META: Record<
  "bronze" | "silver" | "gold" | "platinum",
  {
    label: string;
    xp: number;
    color: string;
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
    ring: string;
    iconColor: string;
  }
> = {
  bronze: {
    label: "青铜勋章",
    xp: 100,
    color: "#d97706",
    badgeBg: "bg-amber-100 dark:bg-amber-950/40",
    badgeText: "text-amber-700 dark:text-amber-400",
    badgeBorder: "border-amber-300 dark:border-amber-800/60",
    ring: "border-amber-400/50 bg-amber-50 dark:bg-amber-950/30",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  silver: {
    label: "白银勋章",
    xp: 200,
    color: "#64748b",
    badgeBg: "bg-slate-100 dark:bg-slate-800/60",
    badgeText: "text-slate-700 dark:text-slate-300",
    badgeBorder: "border-slate-300 dark:border-slate-700",
    ring: "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40",
    iconColor: "text-slate-600 dark:text-slate-300",
  },
  gold: {
    label: "黄金荣耀",
    xp: 300,
    color: "#f59e0b",
    badgeBg: "bg-yellow-100 dark:bg-yellow-950/40",
    badgeText: "text-yellow-800 dark:text-yellow-400",
    badgeBorder: "border-yellow-300 dark:border-yellow-700/60",
    ring: "border-yellow-400/60 bg-yellow-50 dark:bg-yellow-950/30 shadow-[0_0_12px_rgba(245,158,11,0.2)]",
    iconColor: "text-amber-500 dark:text-amber-400",
  },
  platinum: {
    label: "白金绝巅",
    xp: 500,
    color: "#06b6d4",
    badgeBg: "bg-cyan-100 dark:bg-cyan-950/40",
    badgeText: "text-cyan-800 dark:text-cyan-300",
    badgeBorder: "border-cyan-300 dark:border-cyan-700/60",
    ring: "border-cyan-400/70 bg-cyan-50 dark:bg-cyan-950/30 shadow-[0_0_15px_rgba(6,182,212,0.3)]",
    iconColor: "text-cyan-500 dark:text-cyan-400",
  },
};

function renderIcon(name: string, className = "w-5 h-5") {
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
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
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

  // 统计各品阶数量
  const tierCounts = useMemo(() => {
    const stats = {
      platinum: { total: 0, unlocked: 0 },
      gold: { total: 0, unlocked: 0 },
      silver: { total: 0, unlocked: 0 },
      bronze: { total: 0, unlocked: 0 },
    };
    let currentXp = 0;
    let maxXp = 0;

    for (const a of achievements) {
      const meta = TIER_META[a.tier] || TIER_META.bronze;
      maxXp += meta.xp;
      if (stats[a.tier]) {
        stats[a.tier].total += 1;
        if (a.unlocked) {
          stats[a.tier].unlocked += 1;
          currentXp += meta.xp;
        }
      }
    }
    return { stats, currentXp, maxXp };
  }, [achievements]);

  // 过滤列表
  const filtered = useMemo(() => {
    return achievements.filter((a) => {
      if (tierFilter !== "all" && a.tier !== tierFilter) return false;
      if (statusFilter === "unlocked" && !a.unlocked) return false;
      if (statusFilter === "locked" && a.unlocked) return false;
      return true;
    });
  }, [achievements, tierFilter, statusFilter]);

  return (
    <div className="space-y-5 anim-fade-in">
      {/* 1. 顶部总览卡片：与整个 Stats 仪表盘无缝统一 */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          {/* 左侧：总进度与等级 */}
          <div className="flex items-center gap-5">
            <div className="relative shrink-0">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 p-0.5 shadow-md shadow-amber-500/20 flex items-center justify-center">
                <div className="w-full h-full rounded-[14px] bg-white dark:bg-slate-950 flex items-center justify-center text-amber-500">
                  <Trophy className="w-8 h-8" />
                </div>
              </div>
              <span className="absolute -bottom-1 -right-1 bg-amber-500 text-slate-950 text-[10px] font-mono font-black px-1.5 py-0.2 rounded-full ring-2 ring-white dark:ring-slate-900">
                Lv.{Math.floor(tierCounts.currentXp / 300) + 1}
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
                  成就荣耀殿堂
                </h3>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60 font-bold font-mono">
                  {tierCounts.currentXp} / {tierCounts.maxXp} XP
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                完成深度探索、片库整理、深夜观影与私密耐力，解锁终极白金勋章。
              </p>

              {/* 进度条 */}
              <div className="flex items-center gap-3 mt-3 w-64 max-w-full">
                <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 via-rose-500 to-amber-400 rounded-full transition-all duration-500 shadow-sm"
                    style={{ width: `${completionRate}%` }}
                  />
                </div>
                <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 shrink-0">
                  {totalUnlocked}/{totalCount} ({completionRate}%)
                </span>
              </div>
            </div>
          </div>

          {/* 右侧：4 大奖杯计数与一键检测 */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 p-2 rounded-xl">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 shadow-xs">
                <span className="text-xs">🏆</span>
                <span className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400">白金</span>
                <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">
                  {tierCounts.stats.platinum.unlocked}/{tierCounts.stats.platinum.total}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 shadow-xs">
                <span className="text-xs">🥇</span>
                <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">黄金</span>
                <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">
                  {tierCounts.stats.gold.unlocked}/{tierCounts.stats.gold.total}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 shadow-xs">
                <span className="text-xs">🥈</span>
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">白银</span>
                <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">
                  {tierCounts.stats.silver.unlocked}/{tierCounts.stats.silver.total}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 shadow-xs">
                <span className="text-xs">🥉</span>
                <span className="text-[11px] font-bold text-amber-700 dark:text-amber-600">青铜</span>
                <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">
                  {tierCounts.stats.bronze.unlocked}/{tierCounts.stats.bronze.total}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleRunCheck}
              disabled={checking}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs transition shadow-sm cursor-pointer disabled:opacity-50 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} />
              <span>{checking ? "检测中..." : "一键检测成就"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. 筛选控制栏 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* 状态筛选 */}
        <div className="flex items-center gap-1 p-1 bg-slate-200/60 dark:bg-slate-900/80 rounded-xl border border-slate-200/50 dark:border-slate-800 w-fit">
          {[
            { id: "all", label: `全部 (${achievements.length})` },
            { id: "unlocked", label: `已达成 (${totalUnlocked})` },
            { id: "locked", label: `未达成 (${totalCount - totalUnlocked})` },
          ].map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStatusFilter(s.id as StatusFilter)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                statusFilter === s.id
                  ? "bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* 勋章品质筛选 */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400 font-medium">品质:</span>
          {[
            { id: "all", label: "全部" },
            { id: "platinum", label: "白金" },
            { id: "gold", label: "黄金" },
            { id: "silver", label: "白银" },
            { id: "bronze", label: "青铜" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTierFilter(t.id as TierFilter)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                tierFilter === t.id
                  ? "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold"
                  : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3. 成就列表网格 (两列式现代化卡片) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {filtered.map((ach) => {
          const meta = TIER_META[ach.tier] || TIER_META.bronze;
          const currentVal = ach.current ?? 0;
          const targetVal = ach.target || 1;
          const pct = Math.min(100, Math.round((currentVal / targetVal) * 100));

          return (
            <div
              key={ach.id}
              className={`relative overflow-hidden rounded-2xl border p-4.5 transition-all duration-200 bg-white dark:bg-slate-900 ${
                ach.unlocked
                  ? "border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-amber-400/40 dark:hover:border-amber-500/40"
                  : "border-slate-200/40 dark:border-slate-800/50 opacity-75 hover:opacity-100"
              }`}
            >
              <div className="flex items-start gap-3.5">
                {/* 勋章图标环 */}
                <div
                  className={`w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
                    ach.unlocked
                      ? meta.ring
                      : "border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/40 text-slate-400"
                  }`}
                >
                  {ach.unlocked ? (
                    <div className={meta.iconColor}>{renderIcon(ach.icon)}</div>
                  ) : (
                    <Lock className="w-5 h-5 text-slate-400 dark:text-slate-600" />
                  )}
                </div>

                {/* 核心信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <h4
                        className={`text-sm font-bold truncate ${
                          ach.unlocked
                            ? "text-slate-900 dark:text-slate-100"
                            : "text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {ach.title}
                      </h4>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded border font-semibold shrink-0 ${meta.badgeBg} ${meta.badgeText} ${meta.badgeBorder}`}
                      >
                        {meta.label} · +{meta.xp}XP
                      </span>
                    </div>

                    {/* 达成状态 */}
                    {ach.unlocked ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 px-2 py-0.5 rounded-full shrink-0">
                        <CheckCircle2 className="w-3 h-3" />
                        已达成
                      </span>
                    ) : (
                      <span className="text-[11px] font-mono font-semibold text-slate-400 shrink-0">
                        {pct}%
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                    {ach.desc}
                  </p>

                  {/* 底部进度或达成日期 */}
                  <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[11px]">
                    {ach.unlocked ? (
                      <span className="text-slate-400 font-mono text-[10px]">
                        达成时间：{ach.unlockedAt ? new Date(ach.unlockedAt).toLocaleDateString() : "近期达成"}
                      </span>
                    ) : (
                      <div className="w-full">
                        <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-1">
                          <span>达成进度</span>
                          <span>
                            {currentVal} / {targetVal} {ach.unit || ""}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
