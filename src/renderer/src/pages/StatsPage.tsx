import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  Clock,
  Database,
  Download,
  Film,
  Gauge,
  HardDrive,
  History,
  LineChart as LineChartIcon,
  Play,
  RefreshCw,
  Star,
  Timer,
  TrendingUp,
  Trash2,
  Users,
  Sparkles,
  FolderArchive,
  Search,
  CheckCircle2,
  AlertTriangle,
  Heart,
  Calendar,
  Layers,
  ChevronRight,
  Flame,
  Award,
  Zap,
  Trophy,
  CalendarCheck,
  MousePointerClick,
} from "lucide-react";
import { AchievementsPanel } from "../components/stats/AchievementsPanel";
import { triggerAchievementToast } from "../components/achievements/AchievementToast";
import { Button } from "../components/common/Button";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "../lib/trpc";
import { PageLoader } from "../components/PageLoader";
import { AnnualReportModal } from "../components/stats/AnnualReportModal";
import { ActivityHistoryModal } from "../components/stats/ActivityHistoryModal";
import { OrganizerModal } from "../components/organizer/OrganizerModal";

// =================== 类型定义 ===================

interface ActivityBucket {
  plays: number;
  watchSec: number;
  downloads: number;
  downloadBytes: number;
}

interface DiskPrediction {
  daysRemaining: number | null;
  predictedFullAt: string | null;
  avgDailyGrowth: number;
}

interface VideoEntry {
  folder: string;
  playCount: number;
  watchSec: number;
  lastPlayedAt: string | null;
  firstPlayedAt: string | null;
  series: string | null;
}

interface DiskSnapshot {
  at: string;
  totalBytes: number;
  videoCount: number;
  freeBytes?: number;
  totalDiskBytes?: number;
}

interface ArousalSession {
  startedAt: string;
  endedAt: string;
  durationSec: number;
  videoFolder?: string | null;
}

interface ArousalData {
  sessions: ArousalSession[];
  totals: { count: number; totalSec: number };
}

interface StatsData {
  daily: Record<string, ActivityBucket>;
  hourly?: Record<string, ActivityBucket>;
  weekdays?: Record<string, ActivityBucket>;
  monthly?: Record<string, ActivityBucket>;
  videos: Record<string, VideoEntry>;
  diskSnapshots: DiskSnapshot[];
  totals: ActivityBucket;
  arousal?: ArousalData;
}

interface LibraryVideo {
  id: string;
  name: string;
  size?: string;
  resolution?: string;
  coverUrl?: string;
  title?: string;
  duration?: string;
  createdAt?: number;
}

interface StatsPageProps {
  videoPath: string;
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
}

type TabType = "overview" | "rankings" | "habits" | "arousal" | "storage" | "assets" | "achievements";

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// =================== 工具函数 ===================

function emptyBucket(): ActivityBucket {
  return { plays: 0, watchSec: 0, downloads: 0, downloadBytes: 0 };
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(sec: number): string {
  if (!sec) return "0 分钟";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d} 天 ${h % 24} 小时`;
  }
  if (h > 0) return `${h} 小时 ${m} 分钟`;
  return `${Math.max(1, m)} 分钟`;
}

function parseMinutes(value?: string): number {
  const minutes = Number(String(value || "").match(/\d+/)?.[0] || 0);
  return Number.isFinite(minutes) ? minutes : 0;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}分${String(s).padStart(2, "0")}秒`;
}

function parseDay(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function lastNDays(n: number): string[] {
  const list: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    list.push(dateKey(d));
  }
  return list;
}

function HeatGrid({ values }: { values: Record<string, number> }) {
  const days = useMemo(() => {
    const out: string[] = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = 119; i >= 0; i -= 1) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      out.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      );
    }
    return out;
  }, []);
  const max = Math.max(1, ...days.map((day) => values[day] || 0));
  return (
    <div className="grid grid-cols-[repeat(30,1fr)] gap-1">
      {days.map((day) => {
        const value = values[day] || 0;
        const ratio = value / max;
        const cls =
          value === 0
            ? "bg-slate-100 dark:bg-slate-800"
            : ratio < 0.34
              ? "bg-amber-200 dark:bg-amber-900"
              : ratio < 0.67
                ? "bg-amber-400 dark:bg-amber-700"
                : "bg-amber-500";
        return (
          <div
            key={day}
            title={`${day}: ${value} 部入库`}
            className={`aspect-square rounded-xs ${cls} transition-transform hover:scale-125 cursor-pointer`}
          />
        );
      })}
    </div>
  );
}

// =================== 365天双轨热力图组件 ===================

function DualHeatmap({ daily }: { daily: Record<string, ActivityBucket> }) {
  const days = useMemo(() => lastNDays(365), [daily]);
  const playsValues = useMemo(() => days.map((d) => daily[d]?.plays || 0), [days, daily]);
  const watchValues = useMemo(() => days.map((d) => daily[d]?.watchSec || 0), [days, daily]);
  const maxPlays = Math.max(1, ...playsValues);
  const maxWatch = Math.max(1, ...watchValues);
  const first = parseDay(days[0]);
  const startPad = first.getDay();

  // 当前鼠标悬停聚焦的日期单元格
  const [hoveredCell, setHoveredCell] = useState<{
    day: string;
    plays: number;
    watch: number;
    weekday: string;
  } | null>(null);

  // 1. 活跃天数与覆盖率
  const activeDays = useMemo(
    () => days.filter((d) => (daily[d]?.plays || 0) > 0 || (daily[d]?.watchSec || 0) > 0),
    [days, daily],
  );
  const activeDaysCount = activeDays.length;
  const coverageRate = Math.round((activeDaysCount / 365) * 100);

  // 2. 连续专注打卡纪录 (Current Streak & Longest Streak)
  const { currentStreak, maxStreak } = useMemo(() => {
    let maxS = 0;
    let tempS = 0;
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      const isAct = (daily[d]?.plays || 0) > 0 || (daily[d]?.watchSec || 0) > 0;
      if (isAct) {
        tempS++;
        if (tempS > maxS) maxS = tempS;
      } else {
        tempS = 0;
      }
    }
    let curS = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      const d = days[i];
      const isAct = (daily[d]?.plays || 0) > 0 || (daily[d]?.watchSec || 0) > 0;
      if (isAct) {
        curS++;
      } else {
        if (i === days.length - 1) continue;
        break;
      }
    }
    return { currentStreak: curS, maxStreak: maxS };
  }, [days, daily]);

  const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];

  // 3. 统计各星期几的活跃度，找出黄金活跃周期
  const { peakWeekdayName, peakDayStr, peakDayPlays } = useMemo(() => {
    const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
    let pDayStr = "";
    let pDayPlays = 0;
    let pDayWatch = 0;

    days.forEach((d) => {
      const dt = parseDay(d);
      const dayOfWeek = dt.getDay();
      const p = daily[d]?.plays || 0;
      const w = daily[d]?.watchSec || 0;
      weekdayTotals[dayOfWeek] += p + (w > 0 ? 1 : 0);

      if (p > pDayPlays || (p === pDayPlays && w > pDayWatch)) {
        pDayPlays = p;
        pDayWatch = w;
        pDayStr = d;
      }
    });

    let peakIdx = 0;
    weekdayTotals.forEach((total, idx) => {
      if (total > weekdayTotals[peakIdx]) peakIdx = idx;
    });

    return {
      peakWeekdayName: `周${weekdayLabels[peakIdx]}`,
      peakDayStr: pDayStr,
      peakDayPlays: pDayPlays,
    };
  }, [days, daily]);

  // 4. 年度累计与活跃日均投入
  const totalAnnualPlays = useMemo(() => playsValues.reduce((a, b) => a + b, 0), [playsValues]);
  const totalAnnualWatchSec = useMemo(() => watchValues.reduce((a, b) => a + b, 0), [watchValues]);
  const avgActiveDailySec = activeDaysCount > 0 ? Math.round(totalAnnualWatchSec / activeDaysCount) : 0;

  const padded: Array<{
    day: string | null;
    plays: number | null;
    watch: number | null;
  }> = [
    ...Array.from({ length: startPad }, () => ({
      day: null,
      plays: null,
      watch: null,
    })),
    ...days.map((d, i) => ({
      day: d,
      plays: playsValues[i],
      watch: watchValues[i],
    })),
  ];

  const weeks: (typeof padded)[] = [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }

  const amberTier = (v: number | null): string => {
    if (v === null) return "fill-transparent";
    if (v === 0) return "fill-slate-200 dark:fill-slate-800";
    const r = v / maxPlays;
    if (r < 0.25) return "fill-amber-200 dark:fill-amber-900/60";
    if (r < 0.5) return "fill-amber-300 dark:fill-amber-700";
    if (r < 0.75) return "fill-amber-400 dark:fill-amber-600";
    return "fill-amber-500 dark:fill-amber-500";
  };

  const watchTier = (v: number | null): string => {
    if (v === null) return "fill-transparent";
    if (v === 0) return "fill-slate-200 dark:fill-slate-800";
    const r = v / maxWatch;
    if (r < 0.25) return "fill-emerald-200 dark:fill-emerald-900/60";
    if (r < 0.5) return "fill-emerald-300 dark:fill-emerald-700";
    if (r < 0.75) return "fill-emerald-400 dark:fill-emerald-600";
    return "fill-emerald-500 dark:fill-emerald-500";
  };

  const cell = 13;
  const gap = 3;
  const monthLabels: Array<{ label: string; weekIndex: number }> = [];
  let lastMonth = -1;

  weeks.forEach((week, wi) => {
    const firstReal = week.find((c) => c.day);
    if (!firstReal?.day) return;
    const d = parseDay(firstReal.day);
    if (d.getMonth() !== lastMonth) {
      lastMonth = d.getMonth();
      monthLabels.push({ label: `${d.getMonth() + 1}月`, weekIndex: wi });
    }
  });

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
      {/* 顶部标题与图例 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <span>365 天观影行为热力天图</span>
              <span className="text-[10px] font-normal text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                双轨时间轴
              </span>
            </h4>
            <p className="text-[10px] text-slate-400">
              上方为播放频次（琥珀色），下方为观看时长（翡翠色）
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-[10px] text-slate-400">
          <div className="flex items-center gap-1.5">
            <span>低</span>
            <div className="flex gap-0.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-slate-200 dark:bg-slate-800" />
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-200 dark:bg-amber-900/60" />
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-300 dark:bg-amber-700" />
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-400 dark:bg-amber-600" />
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-500" />
            </div>
            <span>高 (播放)</span>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex gap-0.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-200 dark:bg-emerald-900/60" />
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-400" />
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" />
            </div>
            <span>高 (时长)</span>
          </div>
        </div>
      </div>

      {/* 响应式主体布局：左侧热力网格 + 右侧数据洞察与单日聚焦 */}
      <div className="flex flex-col xl:flex-row gap-5 items-stretch">
        {/* 左侧：365天热力天图 SVG */}
        <div className="overflow-x-auto pb-1 shrink-0 h-[268px]">
          <svg
            width={weeks.length * (cell + gap) + 40}
            height={7 * (cell + gap) * 2 + 40}
            className="select-none"
            onMouseLeave={() => setHoveredCell(null)}
          >
            {/* 月份标题 */}
            {monthLabels.map((m) => (
              <text
                key={m.weekIndex}
                x={30 + m.weekIndex * (cell + gap)}
                y={12}
                className="fill-slate-400 dark:fill-slate-500 text-[10px]"
              >
                {m.label}
              </text>
            ))}

            {/* 星期标签 */}
            {[1, 3, 5].map((w) => (
              <text
                key={w}
                x={10}
                y={20 + w * (cell + gap) + 9}
                className="fill-slate-400 dark:fill-slate-500 text-[9px]"
              >
                {weekdayLabels[w]}
              </text>
            ))}
            {[1, 3, 5].map((w) => (
              <text
                key={`w2-${w}`}
                x={10}
                y={20 + 7 * (cell + gap) + 14 + w * (cell + gap) + 9}
                className="fill-slate-400 dark:fill-slate-500 text-[9px]"
              >
                {weekdayLabels[w]}
              </text>
            ))}

            {/* 分隔线 */}
            <line
              x1={28}
              y1={20 + 7 * (cell + gap) + 7}
              x2={weeks.length * (cell + gap) + 30}
              y2={20 + 7 * (cell + gap) + 7}
              className="stroke-slate-200/80 dark:stroke-slate-800"
              strokeDasharray="2 2"
            />

            {/* 播放次数格子 (上轨 - 琥珀色) */}
            {weeks.map((week, wi) =>
              week.map((c, di) => {
                const isHovered = hoveredCell?.day === c.day && Boolean(c.day);
                return (
                  <rect
                    key={`plays-${wi}-${di}`}
                    x={30 + wi * (cell + gap)}
                    y={20 + di * (cell + gap)}
                    width={cell}
                    height={cell}
                    rx={2}
                    className={`${amberTier(c.plays)} cursor-pointer ${
                      isHovered ? "stroke-amber-500 stroke-[1.5]" : "stroke-transparent"
                    }`}
                    onMouseEnter={() => {
                      if (c.day) {
                        setHoveredCell({
                          day: c.day,
                          plays: c.plays || 0,
                          watch: c.watch || 0,
                          weekday: weekdayLabels[di],
                        });
                      }
                    }}
                  >
                    <title>
                      {c.day ? `${c.day} (周${weekdayLabels[di]}): 播放 ${c.plays || 0} 次` : ""}
                    </title>
                  </rect>
                );
              }),
            )}

            {/* 观看时长格子 (下轨 - 翡翠色) */}
            {weeks.map((week, wi) =>
              week.map((c, di) => {
                const isHovered = hoveredCell?.day === c.day && Boolean(c.day);
                return (
                  <rect
                    key={`watch-${wi}-${di}`}
                    x={30 + wi * (cell + gap)}
                    y={20 + 7 * (cell + gap) + 14 + di * (cell + gap)}
                    width={cell}
                    height={cell}
                    rx={2}
                    className={`${watchTier(c.watch)} cursor-pointer ${
                      isHovered ? "stroke-emerald-500 stroke-[1.5]" : "stroke-transparent"
                    }`}
                    onMouseEnter={() => {
                      if (c.day) {
                        setHoveredCell({
                          day: c.day,
                          plays: c.plays || 0,
                          watch: c.watch || 0,
                          weekday: weekdayLabels[di],
                        });
                      }
                    }}
                  >
                    <title>
                      {c.day
                        ? `${c.day} (周${weekdayLabels[di]}): 观看时长 ${formatDuration(c.watch || 0)}`
                        : ""}
                    </title>
                  </rect>
                );
              }),
            )}
          </svg>
        </div>

        {/* 分割线 (仅在宽屏展示) */}
        <div className="hidden xl:block w-px bg-slate-100 dark:bg-slate-800 self-stretch my-1 shrink-0" />

        {/* 右侧：365天节律数据洞察 / 悬停单日实时聚焦面板 (固定高度严格 268px，杜绝高度跳动) */}
        <div className="flex-1 min-w-[280px] h-[268px] min-h-[268px] max-h-[268px] flex flex-col justify-between p-4 bg-slate-50/70 dark:bg-slate-800/30 border border-slate-200/60 dark:border-slate-800/60 rounded-xl overflow-hidden">
          {hoveredCell ? (
            /* 鼠标悬浮单日详情聚焦卡片 */
            <div className="h-full flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <Sparkles className="w-3.5 h-3.5" />
                  </span>
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                      <span>{hoveredCell.day}</span>
                      <span className="text-[10px] text-slate-400 font-normal">
                        (周{hoveredCell.weekday})
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400">单日双轨行为明细</p>
                  </div>
                </div>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    hoveredCell.plays > 0
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                      : "bg-slate-200/60 dark:bg-slate-800 text-slate-400"
                  }`}
                >
                  {hoveredCell.plays >= 5
                    ? "🔥 极度沉浸"
                    : hoveredCell.plays > 0
                      ? "✨ 观影活跃"
                      : "☕ 静止休整"}
                </span>
              </div>

              {/* 4 块单日聚焦指标卡片 (与默认状态尺寸完全对齐) */}
              <div className="grid grid-cols-2 gap-2.5">
                {/* 指标1: 播放频次 */}
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-amber-500/20 shadow-2xs flex flex-col justify-between h-[68px]">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-xs bg-amber-500 inline-block" />
                      播放频次
                    </span>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      {hoveredCell.plays > 0 ? `${Math.round((hoveredCell.plays / maxPlays) * 100)}% 峰值` : "0%"}
                    </span>
                  </div>
                  <div className="text-sm font-extrabold text-amber-600 dark:text-amber-400 stats-number">
                    {hoveredCell.plays}
                    <span className="text-[10px] font-normal text-slate-400 ml-1">次</span>
                  </div>
                  <div className="text-[9px] text-slate-400 truncate">
                    {hoveredCell.plays > 0 ? `单日峰值 ${maxPlays} 次` : "当日未点播"}
                  </div>
                </div>

                {/* 指标2: 观看时长 */}
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-emerald-500/20 shadow-2xs flex flex-col justify-between h-[68px]">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-xs bg-emerald-500 inline-block" />
                      观看时长
                    </span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {hoveredCell.watch > 0 && avgActiveDailySec > 0 ? `${(hoveredCell.watch / avgActiveDailySec).toFixed(1)}x 均值` : "0x"}
                    </span>
                  </div>
                  <div className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 stats-number">
                    {formatDuration(hoveredCell.watch)}
                  </div>
                  <div className="text-[9px] text-slate-400 truncate">
                    {hoveredCell.watch > 0 ? "专注观影时间" : "当日暂无时长"}
                  </div>
                </div>

                {/* 指标3: 沉浸等级 */}
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/70 dark:border-slate-800 shadow-2xs flex flex-col justify-between h-[68px]">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-amber-500" />
                      沉浸等级
                    </span>
                    <span className="text-[9px] text-slate-400">
                      {hoveredCell.plays >= 5 ? "S 级" : hoveredCell.plays >= 2 ? "A 级" : hoveredCell.plays > 0 ? "B 级" : "休整"}
                    </span>
                  </div>
                  <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100 stats-number">
                    {hoveredCell.plays >= 5 ? "极度沉浸" : hoveredCell.plays > 0 ? "观影活跃" : "静止休整"}
                  </div>
                  <div className="text-[9px] text-slate-400 truncate">
                    {hoveredCell.plays > 0 ? "已记录至热力天图" : "休闲无点播记录"}
                  </div>
                </div>

                {/* 指标4: 全年贡献比 */}
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/70 dark:border-slate-800 shadow-2xs flex flex-col justify-between h-[68px]">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Flame className="w-3 h-3 text-rose-500" />
                      年度贡献
                    </span>
                    <span className="text-[9px] text-slate-400">
                      {hoveredCell.plays > 0 ? "已计入" : "-"}
                    </span>
                  </div>
                  <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100 stats-number">
                    {hoveredCell.watch > 0 && totalAnnualWatchSec > 0
                      ? `${((hoveredCell.watch / totalAnnualWatchSec) * 100).toFixed(1)}%`
                      : hoveredCell.plays > 0
                        ? "<0.1%"
                        : "0.0%"}
                  </div>
                  <div className="text-[9px] text-slate-400 truncate">
                    {hoveredCell.plays > 0 ? `贡献 ${hoveredCell.plays} 次播放` : "未有点播占比"}
                  </div>
                </div>
              </div>

              {/* 底部引导栏 */}
              <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-800">
                <span className="flex items-center gap-1 text-slate-400">
                  <MousePointerClick className="w-3 h-3 text-amber-500" />
                  光标漫游热力图可查看任意历史日期
                </span>
                <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium cursor-pointer hover:underline" onClick={() => setHoveredCell(null)}>
                  返回年度总览
                </span>
              </div>
            </div>
          ) : (
            /* 默认状态：年度节律数据洞察面板 */
            <div className="h-full flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <Activity className="w-3.5 h-3.5" />
                  </span>
                  <div>
                    <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      年度节律数据洞察
                    </h5>
                    <p className="text-[10px] text-slate-400">
                      过去 365 天双轨活跃与专注全景
                    </p>
                  </div>
                </div>
                {currentStreak > 0 ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1">
                    <Flame className="w-3 h-3 text-amber-500" />
                    连击 {currentStreak} 天
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400 bg-slate-200/50 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                    暂未连击
                  </span>
                )}
              </div>

              {/* 4 块节律指标卡片 */}
              <div className="grid grid-cols-2 gap-2.5">
                {/* 指标1: 年度活跃天数 */}
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/70 dark:border-slate-800 shadow-2xs flex flex-col justify-between h-[68px]">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <CalendarCheck className="w-3 h-3 text-amber-500" />
                      年度活跃天
                    </span>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      {coverageRate}%
                    </span>
                  </div>
                  <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100 stats-number">
                    {activeDaysCount}
                    <span className="text-[10px] font-normal text-slate-400 ml-1">/ 365天</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-1 rounded-full overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-amber-400 to-amber-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(activeDaysCount > 0 ? 3 : 0, coverageRate))}%` }}
                    />
                  </div>
                </div>

                {/* 指标2: 最长连续打卡 */}
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/70 dark:border-slate-800 shadow-2xs flex flex-col justify-between h-[68px]">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Zap className="w-3 h-3 text-amber-500" />
                      最长连击
                    </span>
                    <span className="text-[9px] text-slate-400">
                      当前 {currentStreak} 天
                    </span>
                  </div>
                  <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100 stats-number">
                    {maxStreak}
                    <span className="text-[10px] font-normal text-slate-400 ml-1">天连续</span>
                  </div>
                  <div className="text-[9px] text-slate-400 truncate">
                    {maxStreak >= 7 ? "🏆 坚持卓越" : "保持每日打卡"}
                  </div>
                </div>

                {/* 指标3: 黄金活跃周期 */}
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/70 dark:border-slate-800 shadow-2xs flex flex-col justify-between h-[68px]">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-sky-500" />
                      黄金周期
                    </span>
                  </div>
                  <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100 stats-number">
                    {peakWeekdayName}
                    <span className="text-[10px] font-normal text-slate-400 ml-1">最沉浸</span>
                  </div>
                  <div className="text-[9px] text-slate-400 truncate">
                    {peakDayPlays > 0
                      ? `单日最高播放 ${peakDayPlays} 部`
                      : "等待产生观影纪录"}
                  </div>
                </div>

                {/* 指标4: 活跃日均投入 */}
                <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/70 dark:border-slate-800 shadow-2xs flex flex-col justify-between h-[68px]">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-emerald-500" />
                      日均投入
                    </span>
                  </div>
                  <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100 stats-number">
                    {formatDuration(avgActiveDailySec)}
                    <span className="text-[10px] font-normal text-slate-400 ml-1">/ 活跃日</span>
                  </div>
                  <div className="text-[9px] text-slate-400 truncate">
                    全年累计 {formatDuration(totalAnnualWatchSec)}
                  </div>
                </div>
              </div>

              {/* 底部引导栏 */}
              <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-800">
                <span className="flex items-center gap-1 text-slate-400">
                  <MousePointerClick className="w-3 h-3 text-amber-500" />
                  悬停热力方格可实时漫游查看单日
                </span>
                <span className="text-[9px] font-medium text-amber-600 dark:text-amber-400">
                  共记录 {totalAnnualPlays} 次播放
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =================== 主页面组件 ===================

export function StatsPage({ videoPath, onAddSystemLog }: StatsPageProps) {
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [stats, setStats] = useState<StatsData | null>(null);
  const [libraryVideos, setLibraryVideos] = useState<LibraryVideo[]>([]);
  const [rankings, setRankings] = useState<{ series: any[]; actors: any[] }>({
    series: [],
    actors: [],
  });
  const [diskPrediction, setDiskPrediction] = useState<DiskPrediction | null>(null);
  const [libraryOverview, setLibraryOverview] = useState<any>(null);
  const [isSnapshotting, setIsSnapshotting] = useState(false);
  const [trendMetric, setTrendMetric] = useState<"watch" | "plays">("watch");
  const [searchRanking, setSearchRanking] = useState("");

  // 模态弹窗控制
  const [showReportModal, setShowReportModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showOrganizerModal, setShowOrganizerModal] = useState(false);

  const refresh = async () => {
    try {
      const [statsData, videos, rankData, predictData, overviewData] = await Promise.all([
        trpc.stats.get.query(),
        videoPath
          ? trpc.videos.list.query({ path: videoPath }).catch(() => [])
          : Promise.resolve([]),
        trpc.stats.getRankings.query().catch(() => ({ series: [], actors: [] })),
        trpc.stats.getDiskPrediction.query().catch(() => null),
        videoPath
          ? trpc.library.overview.query({ rootPath: videoPath }).catch(() => null)
          : Promise.resolve(null),
      ]);
      setStats(statsData as StatsData);
      setLibraryVideos(videos as LibraryVideo[]);
      setRankings(rankData);
      setDiskPrediction(predictData);
      setLibraryOverview(overviewData);

      // 后台静默检测并触发新成就跳杯
      void trpc.achievements.checkAndUnlock
        .mutate({
          totalVideos: Array.isArray(videos) ? videos.length : 0,
          actorCount: Array.isArray(rankData?.actors) ? rankData.actors.length : 0,
        })
        .then((res) => {
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
        })
        .catch(() => {});
    } catch (err: any) {
      onAddSystemLog(`统计加载失败: ${err?.message || err}`, "ERROR");
    }
  };

  useEffect(() => {
    void refresh();
  }, [videoPath]);

  const handleSnapshot = async () => {
    if (!videoPath) {
      onAddSystemLog("请先在设置中配置有效的视频库路径", "WARNING");
      return;
    }
    setIsSnapshotting(true);
    try {
      const res = await trpc.stats.snapshotDisk.mutate({
        rootPath: videoPath,
        force: true,
      });
      if (res.success) {
        onAddSystemLog("磁盘快照记录成功！", "SUCCESS");
        await refresh();
      }
    } catch (err: any) {
      onAddSystemLog(`快照拍摄失败: ${err?.message || err}`, "ERROR");
    } finally {
      setIsSnapshotting(false);
    }
  };

  // 基础聚合计算
  const days30 = useMemo(() => lastNDays(30), []);
  const chartData = useMemo(() => {
    if (!stats) return [];
    return days30.map((d) => {
      const b = stats.daily[d] || emptyBucket();
      return {
        date: d.slice(5),
        fullDate: d,
        plays: b.plays,
        watchMinutes: Math.round(b.watchSec / 60),
        downloads: b.downloads,
      };
    });
  }, [stats, days30]);

  const [terrainFilter, setTerrainFilter] = useState<"all" | "ready" | "needsCover" | "unwatched">("all");
  const terrainVideos = useMemo(() => {
    return libraryVideos.map((video, index) => {
      const playCount = stats?.videos?.[video.name]?.playCount || 0;
      const hasCover = Boolean(video.coverUrl);
      const hasMeta = Boolean(video.title);
      const minutes = parseMinutes(video.duration);
      const quality = (hasCover ? 1 : 0) + (hasMeta ? 1 : 0) + (video.resolution && video.resolution !== "local" ? 1 : 0);
      return { video, index, playCount, hasCover, hasMeta, minutes, quality };
    });
  }, [libraryVideos, stats]);

  const terrainVisible = useMemo(() => terrainVideos.filter((item) => {
    if (terrainFilter === "ready") return item.quality >= 2;
    if (terrainFilter === "needsCover") return !item.hasCover;
    if (terrainFilter === "unwatched") return item.playCount === 0;
    return true;
  }), [terrainVideos, terrainFilter]);

  const quarterReport = useMemo(() => {
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3) + 1;
    const start = new Date(now.getFullYear(), (quarter - 1) * 3, 1).getTime();
    const days = Object.entries(stats?.daily || {}).filter(([day]) => new Date(`${day}T00:00:00`).getTime() >= start);
    const activity = days.reduce((sum, [, bucket]) => ({
      downloads: sum.downloads + bucket.downloads,
      bytes: sum.bytes + bucket.downloadBytes,
      plays: sum.plays + bucket.plays,
      watchSec: sum.watchSec + bucket.watchSec,
    }), { downloads: 0, bytes: 0, plays: 0, watchSec: 0 });
    const added = terrainVideos.filter(({ video }) => (video.createdAt || 0) >= start).length;
    const coverRate = terrainVideos.length ? Math.round((terrainVideos.filter((item) => item.hasCover).length / terrainVideos.length) * 100) : 0;
    return { quarter, activity, added, coverRate, needsCare: terrainVideos.filter((item) => !item.hasCover || !item.hasMeta).length };
  }, [stats, terrainVideos]);

  // 连续观影天数与高光
  const streakInfo = useMemo(() => {
    if (!stats) return { best: 0, current: 0, activeDays: 0, busiest: null };
    const allDays = Object.keys(stats.daily).sort();
    let best = 0;
    let running = 0;
    let activeDays = 0;
    let busiest: { day: string; sec: number } | null = null;

    allDays.forEach((d) => {
      const b = stats.daily[d];
      if ((b.plays || 0) + (b.watchSec || 0) > 0) {
        activeDays++;
        running++;
        if (running > best) best = running;
        if (!busiest || b.watchSec > busiest.sec) {
          busiest = { day: d, sec: b.watchSec };
        }
      } else {
        running = 0;
      }
    });

    // 计算当前连续天数
    let current = 0;
    const now = new Date();
    for (let i = 0; ; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const k = dateKey(d);
      const b = stats.daily[k];
      if (!b || (b.plays || 0) + (b.watchSec || 0) === 0) break;
      current++;
    }

    return { best, current, activeDays, busiest };
  }, [stats]);

  // 24小时分布
  const hourData = useMemo(() => {
    if (!stats?.hourly) return [];
    return Array.from({ length: 24 }, (_, h) => {
      const k = String(h).padStart(2, "0");
      const b = stats.hourly?.[k] || emptyBucket();
      return {
        hour: `${k}:00`,
        plays: b.plays,
        watchHours: Number((b.watchSec / 3600).toFixed(1)),
      };
    });
  }, [stats]);

  // 星期分布
  const weekdayData = useMemo(() => {
    if (!stats?.weekdays) return [];
    return WEEKDAY_LABELS.map((label, idx) => {
      const b = stats.weekdays?.[String(idx)] || emptyBucket();
      return {
        name: label,
        plays: b.plays,
        watchMinutes: Math.round(b.watchSec / 60),
      };
    });
  }, [stats]);

  // 过滤后的榜单
  const filteredActors = useMemo(() => {
    const list = rankings.actors || [];
    if (!searchRanking.trim()) return list;
    const q = searchRanking.trim().toLowerCase();
    return list.filter((item: any) => item.name.toLowerCase().includes(q));
  }, [rankings.actors, searchRanking]);

  const filteredSeries = useMemo(() => {
    const list = rankings.series || [];
    if (!searchRanking.trim()) return list;
    const q = searchRanking.trim().toLowerCase();
    return list.filter((item: any) => item.name.toLowerCase().includes(q));
  }, [rankings.series, searchRanking]);

  // 库覆盖率
  const coveragePercent = useMemo(() => {
    if (!libraryVideos.length || !stats) return "0%";
    const playedSet = new Set(
      Object.keys(stats.videos).filter((k) => (stats.videos[k]?.playCount || 0) > 0),
    );
    const count = libraryVideos.filter((v) => playedSet.has(v.name)).length;
    return `${Math.round((count / libraryVideos.length) * 100)}%`;
  }, [libraryVideos, stats]);

  const lastSnapshot = stats?.diskSnapshots?.slice(-1)[0];

  return (
    <div className="relative h-full overflow-y-auto bg-slate-50/50 dark:bg-slate-950 p-6 space-y-6 text-slate-800 dark:text-slate-100">
      <PageLoader active={!stats} label="正在汇聚多维数据中心..." />

      {/* ================= 1. 顶部 Header & 工具栏 ================= */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200/80 dark:border-slate-800/80 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shadow-xs shrink-0">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                数据洞察中心
              </h2>
              <span className="text-[10px] font-bold font-mono uppercase px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                {libraryVideos.length} 部片库
              </span>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              实时聚合观影习惯、时段偏好、深度榜单与磁盘空间全景
            </p>
          </div>
        </div>

        {/* 顶部三大高能入口与功能按钮 */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Button
            variant="primary"
            size="md"
            icon={<Sparkles className="w-3.5 h-3.5 animate-pulse" />}
            onClick={() => setShowReportModal(true)}
            title="生成赛博朋克观影战斗力年度档案"
          >
            观影战力年报
          </Button>

          <Button
            variant="secondary"
            size="md"
            icon={<History className="w-3.5 h-3.5 text-amber-500" />}
            onClick={() => setShowHistoryModal(true)}
            title="查看完整操作时间线"
          >
            操作历史
          </Button>

          <Button
            variant="secondary"
            size="md"
            icon={<FolderArchive className="w-3.5 h-3.5 text-blue-500" />}
            onClick={() => setShowOrganizerModal(true)}
            className="text-blue-600 dark:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
            title="Emby/Plex 媒体库软链接归档"
          >
            Emby软链接
          </Button>
        </div>
      </div>

      {/* ================= 2. 标签页导航器 (Tabs) ================= */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-200/60 dark:bg-slate-900/80 rounded-xl w-fit border border-slate-200/50 dark:border-slate-800">
        {[
          { id: "overview", label: "综合总览", icon: BarChart3 },
          { id: "rankings", label: "演员与系列榜", icon: Award },
          { id: "habits", label: "观影时段规律", icon: Clock },
          { id: "arousal", label: "私密时刻", icon: Heart },
          { id: "storage", label: "存储与预测", icon: HardDrive },
          { id: "assets", label: "质量地形与季报", icon: Layers },
          { id: "achievements", label: "成就殿堂", icon: Trophy },
        ].map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id as TabType)}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                active
                  ? "bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* ================= 3. 各标签页核心内容 ================= */}

      {/* TAB 1: 综合总览 */}
      {activeTab === "overview" && stats && (
        <div className="space-y-5 anim-fade-in">
          {/* 5 个核心 Hero KPI */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
            <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase">
                <span>累计播放</span>
                <Play className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-xl font-extrabold text-slate-800 dark:text-slate-100 mt-2 stats-number">
                {stats.totals.plays.toLocaleString()}
                <span className="text-xs font-normal text-slate-400 ml-1">次</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                <Flame className="w-3 h-3 text-amber-500" />
                <span>连击 {streakInfo.current} 天</span>
              </div>
            </div>

            <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase">
                <span>观看总时长</span>
                <Clock className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-xl font-extrabold text-slate-800 dark:text-slate-100 mt-2 stats-number">
                {formatDuration(stats.totals.watchSec)}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                历史累计专注沉浸
              </div>
            </div>

            <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase">
                <span>片库覆盖率</span>
                <Gauge className="w-4 h-4 text-rose-500" />
              </div>
              <div className="text-xl font-extrabold text-slate-800 dark:text-slate-100 mt-2 stats-number">
                {coveragePercent}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                已点播观赏比例
              </div>
            </div>

            <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase">
                <span>磁盘视频占用</span>
                <HardDrive className="w-4 h-4 text-purple-500" />
              </div>
              <div className="text-xl font-extrabold text-slate-800 dark:text-slate-100 mt-2 stats-number">
                {lastSnapshot ? formatBytes(lastSnapshot.totalBytes) : "暂未统计"}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {lastSnapshot ? `${lastSnapshot.videoCount} 个媒体文件` : "可拍摄快照"}
              </div>
            </div>

            <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden col-span-2 md:col-span-1">
              <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase">
                <span>下载吞吐量</span>
                <Download className="w-4 h-4 text-sky-500" />
              </div>
              <div className="text-xl font-extrabold text-slate-800 dark:text-slate-100 mt-2 stats-number">
                {stats.totals.downloads.toLocaleString()}
                <span className="text-xs font-normal text-slate-400 ml-1">部</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                共 {formatBytes(stats.totals.downloadBytes)}
              </div>
            </div>
          </div>

          {/* 365天全景双轨热力图 */}
          <DualHeatmap daily={stats.daily} />

          {/* 近 30 天观影波动趋势图 */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    近 30 天观影活跃走势
                  </h4>
                  <p className="text-[10px] text-slate-400">每日观影投入与波动轨迹</p>
                </div>
              </div>

              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setTrendMetric("watch")}
                  className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                    trendMetric === "watch"
                      ? "bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-xs"
                      : "text-slate-500"
                  }`}
                >
                  观看分钟
                </button>
                <button
                  type="button"
                  onClick={() => setTrendMetric("plays")}
                  className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                    trendMetric === "plays"
                      ? "bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-xs"
                      : "text-slate-500"
                  }`}
                >
                  播放次数
                </button>
              </div>
            </div>

            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor={trendMetric === "watch" ? "#10b981" : "#f59e0b"}
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor={trendMetric === "watch" ? "#10b981" : "#f59e0b"}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "#fff",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey={trendMetric === "watch" ? "watchMinutes" : "plays"}
                    name={trendMetric === "watch" ? "观看时长 (分钟)" : "播放次数"}
                    stroke={trendMetric === "watch" ? "#10b981" : "#f59e0b"}
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorTrend)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: 演员与系列榜 */}
      {activeTab === "rankings" && (
        <div className="space-y-5 anim-fade-in">
          {/* 搜索过滤条 */}
          <div className="flex items-center justify-between gap-4">
            <div className="relative w-72">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchRanking}
                onChange={(e) => setSearchRanking(e.target.value)}
                placeholder="搜索榜单中的演员名或系列..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs focus:outline-none focus:border-amber-500"
              />
            </div>

            <span className="text-xs text-slate-400">
              共收录 {rankings.actors.length} 位演员 · {rankings.series.length} 个系列
            </span>
          </div>

          {/* 双栏列表：左侧演员，右侧系列 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* 演员排行榜 */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-500" />
                  <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    最爱演员榜单 (Top 20)
                  </h3>
                </div>
                <span className="text-[10px] text-slate-400">综合热度评分</span>
              </div>

              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {filteredActors.length === 0 && (
                  <div className="text-center py-8 text-xs text-slate-400">
                    未找到相关演员记录
                  </div>
                )}
                {filteredActors.slice(0, 20).map((actor: any, idx: number) => {
                  const maxScore = rankings.actors[0]?.score || 1;
                  const ratio = Math.min(100, Math.round((actor.score / maxScore) * 100));
                  return (
                    <div
                      key={actor.name}
                      className="p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 hover:border-amber-400/40 transition flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 ${
                            idx === 0
                              ? "bg-amber-500 text-white shadow-xs"
                              : idx === 1
                                ? "bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-200"
                                : idx === 2
                                  ? "bg-amber-700 text-white"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-slate-800 dark:text-slate-200 truncate">
                            {actor.name}
                          </div>
                          <div className="w-full bg-slate-200 dark:bg-slate-800 h-1 rounded-full mt-1.5 overflow-hidden">
                            <div
                              className="bg-amber-500 h-full rounded-full transition-all"
                              style={{ width: `${ratio}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0 text-[11px]">
                        <div className="font-mono font-bold text-slate-700 dark:text-slate-300">
                          {formatDuration(actor.watchSec)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {actor.count} 次播放 · 评分 {Math.round(actor.score)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 系列榜单 */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Film className="w-4 h-4 text-blue-500" />
                  <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    系列与厂牌深度分析 (Top 20)
                  </h3>
                </div>
                <span className="text-[10px] text-slate-400">综合热度评分</span>
              </div>

              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {filteredSeries.length === 0 && (
                  <div className="text-center py-8 text-xs text-slate-400">
                    未找到相关系列记录
                  </div>
                )}
                {filteredSeries.slice(0, 20).map((series: any, idx: number) => {
                  const maxScore = rankings.series[0]?.score || 1;
                  const ratio = Math.min(100, Math.round((series.score / maxScore) * 100));
                  return (
                    <div
                      key={series.name}
                      className="p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 hover:border-blue-400/40 transition flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-[11px] text-slate-500 shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-slate-800 dark:text-slate-200 truncate font-mono">
                            {series.name}
                          </div>
                          <div className="w-full bg-slate-200 dark:bg-slate-800 h-1 rounded-full mt-1.5 overflow-hidden">
                            <div
                              className="bg-blue-500 h-full rounded-full transition-all"
                              style={{ width: `${ratio}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0 text-[11px]">
                        <div className="font-mono font-bold text-slate-700 dark:text-slate-300">
                          {formatDuration(series.watchSec)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {series.count} 次播放 · 评分 {Math.round(series.score)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: 观影时段与规律 */}
      {activeTab === "habits" && stats && (
        <div className="space-y-5 anim-fade-in">
          {/* 24 小时峰值柱状图 */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" />
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    24 小时全天候观影时段活跃度
                  </h4>
                  <p className="text-[10px] text-slate-400">哪个时间段你的沉浸度最高？</p>
                </div>
              </div>
            </div>

            <div className="w-full h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#94a3b8" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "#fff",
                    }}
                  />
                  <Bar
                    dataKey="watchHours"
                    name="观看小时"
                    fill="#f59e0b"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 星期分布与月度吞吐 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* 星期分布 */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                <CalendarDays className="w-4 h-4 text-emerald-500" />
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  工作日 vs 周末分布
                </h4>
              </div>

              <div className="w-full h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekdayData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        borderColor: "#334155",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "#fff",
                      }}
                    />
                    <Bar
                      dataKey="plays"
                      name="播放次数"
                      fill="#10b981"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 月度下载吞吐 */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                <LineChartIcon className="w-4 h-4 text-sky-500" />
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  月度下载活跃走势
                </h4>
              </div>

              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {Object.entries(stats.monthly || {}).map(([month, bucket]) => (
                  <div
                    key={month}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-xs"
                  >
                    <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                      {month}
                    </span>
                    <span className="text-slate-500 text-[11px]">
                      {bucket.downloads} 部 · {formatBytes(bucket.downloadBytes)}
                    </span>
                    <span className="text-amber-600 dark:text-amber-400 font-bold text-[11px]">
                      {bucket.plays} 次播放
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 片库入库热力与成就打卡 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* 120天入库热力图 */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-amber-500" />
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    入库活跃热力图
                  </h4>
                </div>
                <span className="text-[10px] text-slate-400">最近 120 天</span>
              </div>
              <div className="pt-2">
                <HeatGrid values={libraryOverview?.addedByDay || {}} />
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                <span>少</span>
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-xs bg-slate-100 dark:bg-slate-800" />
                  <div className="w-2.5 h-2.5 rounded-xs bg-amber-200 dark:bg-amber-900" />
                  <div className="w-2.5 h-2.5 rounded-xs bg-amber-400 dark:bg-amber-700" />
                  <div className="w-2.5 h-2.5 rounded-xs bg-amber-500" />
                </div>
                <span>多</span>
              </div>
            </div>

            {/* 片库成就勋章 */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-violet-500" />
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    片库探索成就勋章
                  </h4>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">
                  {(libraryOverview?.achievements || []).filter((a: any) => a.done).length} /{" "}
                  {(libraryOverview?.achievements || []).length} 已解锁
                </span>
              </div>

              <div className="space-y-3 pt-1">
                {(libraryOverview?.achievements || []).map((ach: any) => (
                  <div key={ach.id} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800/60">
                    <div className="flex items-center justify-between text-xs">
                      <span className={ach.done ? "text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1.5" : "text-slate-700 dark:text-slate-200 font-medium"}>
                        {ach.done && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                        {ach.title}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {ach.progress} / {ach.target}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-slate-200/70 dark:bg-slate-700 overflow-hidden">
                      <div
                        className={`h-full transition-all ${ach.done ? "bg-emerald-500" : "bg-violet-500"}`}
                        style={{ width: `${Math.min(100, Math.round((ach.progress / Math.max(1, ach.target)) * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: 私密时刻 */}
      {activeTab === "arousal" && stats && (
        <div className="space-y-5 anim-fade-in">
          {(() => {
            const arousal = stats.arousal || { totals: { count: 0, totalSec: 0 }, sessions: [] };
            const count = arousal.totals.count || 0;
            const totalSec = arousal.totals.totalSec || 0;
            const avgSec = count > 0 ? Math.floor(totalSec / count) : 0;
            const maxSec = Math.max(0, ...(arousal.sessions || []).map((s) => s.durationSec || 0));

            return (
              <>
                {/* 4 个高光指标 */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-rose-200/80 dark:border-rose-900/30">
                    <div className="flex items-center justify-between text-rose-500 text-xs font-bold">
                      <span>总记录次数</span>
                      <Heart className="w-4 h-4" />
                    </div>
                    <div className="text-2xl font-black text-slate-800 dark:text-slate-100 mt-2 stats-number">
                      {count}
                      <span className="text-xs font-normal text-slate-400 ml-1">次</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">历史累计会话</div>
                  </div>

                  <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-rose-200/80 dark:border-rose-900/30">
                    <div className="flex items-center justify-between text-rose-500 text-xs font-bold">
                      <span>累计专注时长</span>
                      <Timer className="w-4 h-4" />
                    </div>
                    <div className="text-2xl font-black text-slate-800 dark:text-slate-100 mt-2 stats-number">
                      {formatDuration(totalSec)}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">深度体验总计</div>
                  </div>

                  <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-rose-200/80 dark:border-rose-900/30">
                    <div className="flex items-center justify-between text-rose-500 text-xs font-bold">
                      <span>平均单次时长</span>
                      <Zap className="w-4 h-4" />
                    </div>
                    <div className="text-2xl font-black text-slate-800 dark:text-slate-100 mt-2 stats-number">
                      {formatTime(avgSec)}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">耐力节奏指数</div>
                  </div>

                  <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-rose-200/80 dark:border-rose-900/30">
                    <div className="flex items-center justify-between text-rose-500 text-xs font-bold">
                      <span>单次巅峰纪录</span>
                      <Award className="w-4 h-4" />
                    </div>
                    <div className="text-2xl font-black text-slate-800 dark:text-slate-100 mt-2 stats-number">
                      {formatTime(maxSec)}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">历史最持久单次</div>
                  </div>
                </div>

                {/* 详细历史记录流 */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <History className="w-4 h-4 text-rose-500" />
                    <span>私密时刻会话流</span>
                  </h4>

                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {(arousal.sessions || []).length === 0 && (
                      <div className="text-center py-12 text-xs text-slate-400">
                        播放影片时点击右下角心形“私密计时”即可记录专属体验
                      </div>
                    )}
                    {(arousal.sessions || []).slice(-30).reverse().map((s, idx) => (
                      <div
                        key={`${s.startedAt}-${idx}`}
                        className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Heart className="w-4 h-4 text-rose-500 shrink-0" />
                          <div className="min-w-0 flex-1 truncate">
                            <span className="font-bold text-slate-700 dark:text-slate-200 truncate block">
                              {s.videoFolder || "无关联视频 / 独立计时"}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {new Date(s.startedAt).toLocaleString()}
                            </span>
                          </div>
                        </div>

                        <span className="font-mono font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded-lg text-xs shrink-0">
                          {formatTime(s.durationSec)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* TAB 5: 存储与预测 */}
      {activeTab === "storage" && stats && (
        <div className="space-y-5 anim-fade-in">
          {/* 磁盘空间预警卡片 */}
          {diskPrediction && diskPrediction.daysRemaining !== null && (
            <div className="rounded-2xl p-5 bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-amber-500 text-white shadow-md shadow-amber-500/20">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                    磁盘容量预测预警
                  </h4>
                  <p className="text-xs text-amber-700 dark:text-amber-300/80 mt-0.5">
                    按近期日均增量（{formatBytes(diskPrediction.avgDailyGrowth)}/天）推算，预计在{" "}
                    <span className="font-bold text-amber-600 dark:text-amber-400">
                      {diskPrediction.daysRemaining} 天
                    </span>{" "}
                    后达到上限。
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowOrganizerModal(true)}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition shadow-xs cursor-pointer shrink-0"
              >
                清理归档
              </button>
            </div>
          )}

          {/* 磁盘占用快照走势图 */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-purple-500" />
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    硬盘空间历史快照走势
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    共记录 {stats.diskSnapshots?.length || 0} 次扫描点
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSnapshot}
                disabled={isSnapshotting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-200 transition cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSnapshotting ? "animate-spin" : ""}`} />
                {isSnapshotting ? "正在扫描..." : "即刻拍快照"}
              </button>
            </div>

            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={(stats.diskSnapshots || []).map((s) => ({
                    time: s.at.slice(5, 10),
                    gb: Number((s.totalBytes / 1024 ** 3).toFixed(1)),
                    count: s.videoCount,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "#fff",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="gb"
                    name="占用空间 (GB)"
                    stroke="#a855f7"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {activeTab === "assets" && stats && (
        <div className="space-y-5 anim-fade-in">
          <div className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">片库质量地形图</h3><p className="mt-1 text-[10px] text-slate-400">横向是片长，纵向是观看频率；颜色越暖，资料资产越完整。</p></div><div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-[10px] dark:bg-slate-800">{[["all","全部"],["ready","完整"],["needsCover","缺封面"],["unwatched","未看"]].map(([id,label]) => <button key={id} type="button" onClick={() => setTerrainFilter(id as typeof terrainFilter)} className={`rounded-md px-2 py-1 font-bold ${terrainFilter === id ? "bg-white text-amber-600 shadow-sm dark:bg-slate-700" : "text-slate-500"}`}>{label}</button>)}</div></div>
              <div className="relative mt-5 h-72 overflow-hidden rounded-xl border border-slate-100 bg-[linear-gradient(rgba(148,163,184,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.12)_1px,transparent_1px)] bg-[size:32px_32px] dark:border-slate-800">
                {terrainVisible.map((item) => { const left = 4 + ((item.minutes || (item.index % 90) + 10) / 180) * 88; const bottom = 6 + Math.min(item.playCount, 12) / 12 * 78; const tone = item.quality >= 2 ? "bg-emerald-400" : item.hasCover ? "bg-amber-400" : "bg-rose-400"; return <button key={item.video.id} title={`${item.video.name} · ${item.playCount} 次播放 · ${item.quality}/3 资料完整`} className={`absolute h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full ${tone} ring-4 ring-white/50 transition hover:scale-150 dark:ring-slate-900/50`} style={{ left: `${Math.min(left, 94)}%`, bottom: `${bottom}%` }} />; })}
                {!terrainVisible.length && <div className="flex h-full items-center justify-center text-xs text-slate-400">当前筛选没有可展示的影片</div>}
                <span className="absolute bottom-2 left-3 text-[9px] text-slate-400">短片</span><span className="absolute bottom-2 right-3 text-[9px] text-slate-400">长片</span><span className="absolute left-3 top-2 text-[9px] text-slate-400">常看</span><span className="absolute left-3 bottom-7 text-[9px] text-slate-400">未看</span>
              </div>
            </div>
            <div className="rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm dark:border-violet-900/50 dark:from-violet-950/30 dark:to-slate-900"><div className="text-[10px] font-bold tracking-[0.2em] text-violet-500">PRIVATE ASSET QUARTERLY</div><h3 className="mt-2 text-lg font-bold text-slate-800 dark:text-slate-100">{new Date().getFullYear()} · Q{quarterReport.quarter} 资源季报</h3><p className="mt-1 text-xs leading-5 text-slate-500">本季度新增 {quarterReport.added} 部资产，封面完备率 {quarterReport.coverRate}%，仍有 {quarterReport.needsCare} 部等待资料完善。</p><div className="mt-5 grid grid-cols-2 gap-2">{[["下载流量",formatBytes(quarterReport.activity.bytes)],["下载任务",`${quarterReport.activity.downloads} 次`],["播放次数",`${quarterReport.activity.plays} 次`],["观看投入",formatDuration(quarterReport.activity.watchSec)]].map(([label,value]) => <div key={label} className="rounded-xl bg-white/80 p-3 dark:bg-slate-800/70"><div className="text-[9px] text-slate-400">{label}</div><div className="mt-1 text-sm font-extrabold text-slate-800 dark:text-slate-100">{value}</div></div>)}</div><div className="mt-4 rounded-xl border border-violet-200/60 bg-violet-100/50 px-3 py-2 text-[10px] text-violet-700 dark:border-violet-800/60 dark:bg-violet-900/20 dark:text-violet-300">季报是本地实时计算，不上传片名、文件或观看记录。</div></div>
          </div>
        </div>
      )}

      {/* 成就殿堂选项卡 */}
      {activeTab === "achievements" && <AchievementsPanel />}

      {/* ================= 4. 浮层弹窗 ================= */}
      {showReportModal && (
        <AnnualReportModal
          stats={stats}
          rankings={rankings}
          onClose={() => setShowReportModal(false)}
          onAddSystemLog={onAddSystemLog}
        />
      )}

      {showHistoryModal && (
        <ActivityHistoryModal
          onClose={() => setShowHistoryModal(false)}
          onAddSystemLog={onAddSystemLog}
        />
      )}

      {showOrganizerModal && (
        <OrganizerModal
          sourcePath={videoPath}
          onClose={() => setShowOrganizerModal(false)}
          onAddSystemLog={onAddSystemLog}
        />
      )}
    </div>
  );
}
