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
  LineChart,
  Play,
  RefreshCw,
  Star,
  Timer,
  TrendingUp,
  Trash2,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "../lib/trpc";
import { PageLoader } from "../components/PageLoader";

interface ActivityBucket {
  plays: number;
  watchSec: number;
  downloads: number;
  downloadBytes: number;
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

interface StatsData {
  daily: Record<string, ActivityBucket>;
  hourly?: Record<string, ActivityBucket>;
  weekdays?: Record<string, ActivityBucket>;
  monthly?: Record<string, ActivityBucket>;
  videos: Record<string, VideoEntry>;
  diskSnapshots: DiskSnapshot[];
  totals: ActivityBucket;
}

interface LibraryVideo {
  id: string;
  name: string;
  size?: string;
}

interface StatsPageProps {
  videoPath: string;
  onAddSystemLog: (
    text: string,
    level: "INFO" | "WARNING" | "SUCCESS" | "ERROR",
  ) => void;
}

type IconType = React.ComponentType<{ className?: string }>;

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

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

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push(dateKey(d));
  }
  return out;
}

function parseDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function dayDiff(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);
}

function percent(value: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function inferSeries(name: string | null | undefined): string {
  if (!name) return "未分类";
  const code = name.match(/[A-Z]{2,8}-?\d{2,6}/i)?.[0];
  if (!code) return "未分类";
  return code.replace("-", "").replace(/\d+$/, "").toUpperCase() || "未分类";
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: IconType;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex items-center gap-3 min-w-0">
      <div className={`p-2.5 rounded-lg ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider">
          {label}
        </div>
        <div className="text-lg font-bold text-slate-800 dark:text-slate-100 truncate stats-number">
          {value}
        </div>
        {sub && (
          <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 bg-white dark:bg-slate-900">
      <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">
        {label}
      </div>
      <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate stats-number">
        {value}
      </div>
      {sub && <div className="text-[9px] text-slate-400 truncate">{sub}</div>}
    </div>
  );
}

function PanelControls({
  hidden,
  expanded,
  onToggleHidden,
  onToggleExpanded,
}: {
  hidden: boolean;
  expanded: boolean;
  onToggleHidden: () => void;
  onToggleExpanded: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-slate-400 hover:text-amber-500"
        title={expanded ? "收起" : "展开"}
      >
        {expanded ? (
          <Minimize2 className="w-3 h-3" />
        ) : (
          <Maximize2 className="w-3 h-3" />
        )}
      </button>
      <button
        type="button"
        onClick={onToggleHidden}
        className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-slate-400 hover:text-amber-500"
        title={hidden ? "显示" : "隐藏"}
      >
        {hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
      </button>
    </div>
  );
}

function HiddenPanelNote() {
  return (
    <div className="py-8 text-center text-[11px] text-slate-400 dark:text-slate-500">
      已隐藏，点击右上角眼睛按钮显示
    </div>
  );
}

function Heatmap({
  daily,
  field,
  title,
  unit,
}: {
  daily: Record<string, ActivityBucket>;
  field: keyof ActivityBucket;
  title: string;
  unit: "count" | "duration" | "bytes";
}) {
  const days = useMemo(() => lastNDays(365), []);
  const values = days.map((day) => daily[day]?.[field] || 0);
  const max = Math.max(1, ...values);
  const first = parseDay(days[0]);
  const startPad = first.getDay();
  const padded: Array<{ day: string | null; value: number | null }> = [
    ...Array.from({ length: startPad }, () => ({ day: null, value: null })),
    ...days.map((day, index) => ({ day, value: values[index] })),
  ];
  const weeks: Array<Array<{ day: string | null; value: number | null }>> = [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }

  const colorAt = (value: number | null): string => {
    if (value === null) return "fill-transparent";
    if (value === 0) return "fill-slate-200 dark:fill-slate-800";
    const ratio = value / max;
    if (ratio < 0.25) return "fill-amber-200 dark:fill-amber-900";
    if (ratio < 0.5) return "fill-amber-300 dark:fill-amber-700";
    if (ratio < 0.75) return "fill-amber-400 dark:fill-amber-600";
    return "fill-amber-500 dark:fill-amber-500";
  };

  const formatValue = (value: number): string => {
    if (unit === "duration") return formatDuration(value);
    if (unit === "bytes") return formatBytes(value);
    return value.toLocaleString();
  };

  const cell = 12;
  const gap = 3;
  const total = values.reduce((sum, value) => sum + value, 0);
  const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
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

  const svgWidth = weeks.length * (cell + gap) + 4;
  const svgHeight = 7 * (cell + gap) + 18;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-amber-500" />
          {title}
        </h3>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
          365 天累计 {formatValue(total)}
        </span>
      </div>
      <div className="flex gap-1.5">
        {/* 左侧星期标签 */}
        <div
          className="flex flex-col text-[9px] text-slate-400 dark:text-slate-500 pt-[18px] shrink-0"
          style={{ gap: `${gap}px` }}
        >
          {weekdayLabels.map((label, i) => (
            <span
              key={i}
              style={{ height: `${cell}px`, lineHeight: `${cell}px` }}
              className={i % 2 === 1 ? "" : "opacity-0"}
            >
              {label}
            </span>
          ))}
        </div>
        {/* 热力图主体（可横向滚动兜底） */}
        <div className="flex-1 overflow-x-auto pb-1">
          <svg width={svgWidth} height={svgHeight} className="block">
            {/* 月份标签 */}
            {monthLabels.map(({ label, weekIndex }, i) => (
              <text
                key={i}
                x={weekIndex * (cell + gap)}
                y={11}
                className="fill-slate-400 dark:fill-slate-500"
                style={{ fontSize: 9 }}
              >
                {label}
              </text>
            ))}
            {/* 格子 */}
            <g transform="translate(0, 18)">
              {weeks.map((week, weekIndex) =>
                week.map((item, dayIndex) => (
                  <rect
                    key={`${weekIndex}-${dayIndex}`}
                    x={weekIndex * (cell + gap)}
                    y={dayIndex * (cell + gap)}
                    width={cell}
                    height={cell}
                    rx={2}
                    className={colorAt(item.value)}
                  >
                    {item.day && item.value !== null && (
                      <title>
                        {item.day}: {formatValue(item.value)}
                      </title>
                    )}
                  </rect>
                )),
              )}
            </g>
          </svg>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-2 text-[9px] text-slate-400 dark:text-slate-500">
        <span>少</span>
        {[
          "bg-slate-200 dark:bg-slate-800",
          "bg-amber-200 dark:bg-amber-900",
          "bg-amber-300 dark:bg-amber-700",
          "bg-amber-400 dark:bg-amber-600",
          "bg-amber-500",
        ].map((className, index) => (
          <span key={index} className={`w-2.5 h-2.5 rounded-sm ${className}`} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}

function HeatStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "amber" | "emerald";
}) {
  const ring =
    tone === "amber"
      ? "border-amber-200/70 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5"
      : "border-emerald-200/70 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5";
  const fg =
    tone === "amber"
      ? "text-amber-700 dark:text-amber-300"
      : "text-emerald-700 dark:text-emerald-300";
  return (
    <div className={`rounded-lg border ${ring} px-2.5 py-2`}>
      <div className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
        {label}
      </div>
      <div className={`text-sm font-bold font-mono mt-0.5 truncate ${fg}`}>
        {value}
      </div>
      {sub && (
        <div className="text-[9px] text-slate-400 dark:text-slate-500 truncate">
          {sub}
        </div>
      )}
    </div>
  );
}

function DualHeatmap({ daily }: { daily: Record<string, ActivityBucket> }) {
  const days = useMemo(() => lastNDays(365), []);
  const playsValues = days.map((d) => daily[d]?.plays || 0);
  const watchValues = days.map((d) => daily[d]?.watchSec || 0);
  const maxPlays = Math.max(1, ...playsValues);
  const maxWatch = Math.max(1, ...watchValues);
  const first = parseDay(days[0]);
  const startPad = first.getDay();
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
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

  // amber 5 阶 (播放) / emerald 5 阶 (观看时长)
  const amberTier = (v: number | null): string => {
    if (v === null) return "fill-transparent";
    if (v === 0) return "fill-slate-200 dark:fill-slate-800";
    const r = v / maxPlays;
    if (r < 0.25) return "fill-amber-200 dark:fill-amber-900/70";
    if (r < 0.5) return "fill-amber-300 dark:fill-amber-700";
    if (r < 0.75) return "fill-amber-400 dark:fill-amber-600";
    return "fill-amber-500 dark:fill-amber-500";
  };
  const watchTier = (v: number | null): string => {
    if (v === null) return "fill-transparent";
    if (v === 0) return "fill-slate-200 dark:fill-slate-800";
    const r = v / maxWatch;
    if (r < 0.25) return "fill-emerald-200 dark:fill-emerald-900/70";
    if (r < 0.5) return "fill-emerald-300 dark:fill-emerald-700";
    if (r < 0.75) return "fill-emerald-400 dark:fill-emerald-600";
    return "fill-emerald-500 dark:fill-emerald-500";
  };

  const cell = 15;
  const gap = 3;
  const totalPlays = playsValues.reduce((s, v) => s + v, 0);
  const totalWatch = watchValues.reduce((s, v) => s + v, 0);
  const activeDays = days.filter(
    (d) => (daily[d]?.plays || 0) > 0 || (daily[d]?.watchSec || 0) > 0,
  ).length;
  const avgPlays = activeDays ? totalPlays / activeDays : 0;
  const avgWatch = activeDays ? totalWatch / activeDays : 0;
  const topDay = days.reduce<{
    day: string;
    watch: number;
    plays: number;
  } | null>((acc, d) => {
    const w = daily[d]?.watchSec || 0;
    const p = daily[d]?.plays || 0;
    const score = w + p * 60;
    if (!acc || score > acc.watch + acc.plays * 60) {
      return { day: d, watch: w, plays: p };
    }
    return acc;
  }, null);
  // 连续观看天数
  let bestStreak = 0;
  let cur = 0;
  for (const d of days) {
    if ((daily[d]?.plays || 0) > 0 || (daily[d]?.watchSec || 0) > 0) {
      cur += 1;
      if (cur > bestStreak) bestStreak = cur;
    } else {
      cur = 0;
    }
  }

  const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
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
  const svgWidth = weeks.length * (cell + gap) + 4;
  const svgHeight = 7 * (cell + gap) + 18;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-amber-500" />
          观影日历热力图（双指标）
        </h3>
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <span className="inline-block w-2 h-2 rounded-sm bg-amber-500" />
            播放 {totalPlays.toLocaleString()} 次
          </span>
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" />
            观看 {formatDuration(totalWatch)}
          </span>
        </div>
      </div>

      <div className="flex gap-4 items-start">
        {/* 左侧星期标签 */}
        <div
          className="flex flex-col text-[9px] text-slate-400 dark:text-slate-500 pt-[18px] shrink-0"
          style={{ gap: `${gap}px` }}
        >
          {weekdayLabels.map((label, i) => (
            <span
              key={i}
              style={{ height: `${cell}px`, lineHeight: `${cell}px` }}
              className={i % 2 === 1 ? "" : "opacity-0"}
            >
              {label}
            </span>
          ))}
        </div>
        {/* 热力图主体 */}
        <div className="flex-1 overflow-x-auto pb-1">
          <svg width={svgWidth} height={svgHeight} className="block max-w-full">
            {monthLabels.map(({ label, weekIndex }, i) => (
              <text
                key={i}
                x={weekIndex * (cell + gap)}
                y={11}
                className="fill-slate-400 dark:fill-slate-500"
                style={{ fontSize: 9 }}
              >
                {label}
              </text>
            ))}
            <g transform="translate(0, 18)">
              {weeks.map((week, weekIndex) =>
                week.map((item, dayIndex) => {
                  const x = weekIndex * (cell + gap);
                  const y = dayIndex * (cell + gap);
                  if (item.day === null) return null;
                  // 对角分割：左上三角 = plays（amber），右下三角 = watch（emerald）
                  const tl = `${x},${y} ${x + cell},${y} ${x},${y + cell}`;
                  const br = `${x + cell},${y} ${x + cell},${y + cell} ${x},${y + cell}`;
                  const tip =
                    `${item.day}\n播放 ${item.plays?.toLocaleString() ?? 0} 次` +
                    `\n观看 ${formatDuration(item.watch ?? 0)}`;
                  return (
                    <g key={`${weekIndex}-${dayIndex}`}>
                      <polygon points={tl} className={amberTier(item.plays)} />
                      <polygon points={br} className={watchTier(item.watch)} />
                      <title>{tip}</title>
                    </g>
                  );
                }),
              )}
            </g>
          </svg>
        </div>
        {/* 右侧紧凑摘要面板 */}
        <div className="w-44 shrink-0 grid grid-cols-2 gap-2 self-stretch">
          <HeatStat
            label="活跃天数"
            value={`${activeDays}`}
            sub="365 天内有记录"
            tone="amber"
          />
          <HeatStat
            label="最长连看"
            value={`${bestStreak} 天`}
            sub="连续有活动"
            tone="emerald"
          />
          <HeatStat
            label="日均播放"
            value={avgPlays >= 10 ? avgPlays.toFixed(0) : avgPlays.toFixed(1)}
            sub="活跃天平均"
            tone="amber"
          />
          <HeatStat
            label="日均时长"
            value={formatDuration(Math.round(avgWatch))}
            sub="活跃天平均"
            tone="emerald"
          />
        </div>
      </div>

      <div className="flex items-center justify-between mt-2 text-[9px] text-slate-400 dark:text-slate-500">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span>播放</span>
            {[
              "bg-slate-200 dark:bg-slate-800",
              "bg-amber-200 dark:bg-amber-900/70",
              "bg-amber-300 dark:bg-amber-700",
              "bg-amber-400 dark:bg-amber-600",
              "bg-amber-500",
            ].map((c, i) => (
              <span key={i} className={`w-2.5 h-2.5 rounded-sm ${c}`} />
            ))}
          </span>
          <span className="flex items-center gap-1">
            <span>时长</span>
            {[
              "bg-slate-200 dark:bg-slate-800",
              "bg-emerald-200 dark:bg-emerald-900/70",
              "bg-emerald-300 dark:bg-emerald-700",
              "bg-emerald-400 dark:bg-emerald-600",
              "bg-emerald-500",
            ].map((c, i) => (
              <span key={i} className={`w-2.5 h-2.5 rounded-sm ${c}`} />
            ))}
          </span>
        </div>
        <span>悬停查看当日明细 · 左上播放 · 右下时长</span>
      </div>
    </div>
  );
}

function DiskTrendChart({
  snapshots,
  hidden,
  expanded,
  onToggleHidden,
  onToggleExpanded,
}: {
  snapshots: DiskSnapshot[];
  hidden: boolean;
  expanded: boolean;
  onToggleHidden: () => void;
  onToggleExpanded: () => void;
}) {
  const points = snapshots.slice(-90);
  if (points.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 text-center text-[11px] text-slate-400 dark:text-slate-500 py-12">
        暂无磁盘快照。点击右上角“立即拍快照”后会生成空间趋势和剩余天数预测。
      </div>
    );
  }

  const W = 820;
  const H = expanded ? 320 : 220;
  const PAD = { l: 58, r: 16, t: 16, b: 28 };
  const max = Math.max(1, ...points.map((p) => p.totalBytes));
  const min = Math.min(...points.map((p) => p.totalBytes));
  const range = max - min || Math.max(max, 1);
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const xStep = points.length > 1 ? innerW / (points.length - 1) : 0;
  const xy = (index: number, bytes: number) => ({
    x: PAD.l + index * xStep,
    y: PAD.t + innerH - ((bytes - min) / range) * innerH,
  });
  const linePath = points
    .map((point, index) => {
      const p = xy(index, point.totalBytes);
      return `${index === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    })
    .join(" ");
  const areaPath =
    linePath +
    ` L ${PAD.l + (points.length - 1) * xStep} ${PAD.t + innerH}` +
    ` L ${PAD.l} ${PAD.t + innerH} Z`;
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const value = min + (range * index) / 4;
    return { value, y: PAD.t + innerH - (innerH * index) / 4 };
  });

  const first = points[0];
  const last = points[points.length - 1];
  const elapsedDays = Math.max(
    1,
    (new Date(last.at).getTime() - new Date(first.at).getTime()) / 86400000,
  );
  const dailyGrowth = Math.max(
    0,
    (last.totalBytes - first.totalBytes) / elapsedDays,
  );
  const daysLeft =
    last.freeBytes && dailyGrowth > 0
      ? Math.floor(last.freeBytes / dailyGrowth)
      : null;
  const avgVideoSize =
    last.videoCount > 0 ? last.totalBytes / last.videoCount : 0;
  const moreVideos =
    last.freeBytes && avgVideoSize > 0
      ? Math.floor(last.freeBytes / avgVideoSize)
      : null;
  const diskUsed =
    last.totalDiskBytes && last.totalDiskBytes > 0
      ? percent(
          last.totalDiskBytes - (last.freeBytes || 0),
          last.totalDiskBytes,
        )
      : null;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
          视频盘占用增长曲线
        </h3>
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="text-slate-400 dark:text-slate-500">
            {points.length} 张快照
          </span>
          <span className="text-amber-600 dark:text-amber-400 font-bold">
            {dailyGrowth > 0 ? `+${formatBytes(dailyGrowth)}/天` : "增长不足"}
          </span>
          <PanelControls
            hidden={hidden}
            expanded={expanded}
            onToggleHidden={onToggleHidden}
            onToggleExpanded={onToggleExpanded}
          />
        </div>
      </div>
      {hidden ? (
        <HiddenPanelNote />
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
            {ticks.map((tick, index) => (
              <g key={index}>
                <line
                  x1={PAD.l}
                  x2={W - PAD.r}
                  y1={tick.y}
                  y2={tick.y}
                  className="stroke-slate-200 dark:stroke-slate-800"
                  strokeDasharray="2,3"
                  strokeWidth={0.5}
                />
                <text
                  x={PAD.l - 7}
                  y={tick.y + 3}
                  textAnchor="end"
                  className="fill-slate-400 dark:fill-slate-500 text-[9px] font-mono"
                >
                  {formatBytes(tick.value)}
                </text>
              </g>
            ))}
            <path d={areaPath} className="fill-emerald-500/10" />
            <path
              d={linePath}
              fill="none"
              className="stroke-emerald-500"
              strokeWidth={2.2}
              strokeLinejoin="round"
            />
            {points.length <= 45 &&
              points.map((point, index) => {
                const p = xy(index, point.totalBytes);
                return (
                  <circle
                    key={point.at}
                    cx={p.x}
                    cy={p.y}
                    r={2}
                    className="fill-emerald-500"
                  >
                    <title>
                      {point.at.slice(0, 10)}: {formatBytes(point.totalBytes)} /{" "}
                      {point.videoCount} 个视频
                    </title>
                  </circle>
                );
              })}
            <text
              x={PAD.l}
              y={H - 7}
              className="fill-slate-400 dark:fill-slate-500 text-[9px] font-mono"
            >
              {first.at.slice(0, 10)}
            </text>
            <text
              x={W - PAD.r}
              y={H - 7}
              textAnchor="end"
              className="fill-slate-400 dark:fill-slate-500 text-[9px] font-mono"
            >
              {last.at.slice(0, 10)}
            </text>
          </svg>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
            <MiniMetric
              label="当前视频占用"
              value={formatBytes(last.totalBytes)}
              sub={`${last.videoCount} 个视频`}
            />
            <MiniMetric
              label="磁盘剩余"
              value={last.freeBytes ? formatBytes(last.freeBytes) : "未知"}
              sub={diskUsed ? `磁盘已用 ${diskUsed}` : "需要新版快照"}
            />
            <MiniMetric
              label="还能下多少天"
              value={daysLeft == null ? "待观察" : `${daysLeft} 天`}
              sub="按快照增长速度估算"
            />
            <MiniMetric
              label="还能下多少部"
              value={moreVideos == null ? "待观察" : `${moreVideos} 部`}
              sub="按当前平均体积估算"
            />
          </div>
        </>
      )}
    </div>
  );
}

type AdvancedChartMode = "watch" | "plays" | "downloads" | "disk";

const ADVANCED_MODES: Array<{
  key: AdvancedChartMode;
  label: string;
  field: keyof ActivityBucket | "disk";
  icon: IconType;
  color: string;
}> = [
  {
    key: "watch",
    label: "观看时长",
    field: "watchSec",
    icon: Clock,
    color: "#10b981",
  },
  {
    key: "plays",
    label: "播放次数",
    field: "plays",
    icon: Play,
    color: "#f43f5e",
  },
  {
    key: "downloads",
    label: "下载体量",
    field: "downloadBytes",
    icon: Download,
    color: "#0ea5e9",
  },
  {
    key: "disk",
    label: "磁盘占用",
    field: "disk",
    icon: HardDrive,
    color: "#8b5cf6",
  },
];

function AdvancedStatsChart({
  daily,
  snapshots,
  hidden,
  expanded,
  onToggleHidden,
  onToggleExpanded,
}: {
  daily: Record<string, ActivityBucket>;
  snapshots: DiskSnapshot[];
  hidden: boolean;
  expanded: boolean;
  onToggleHidden: () => void;
  onToggleExpanded: () => void;
}) {
  const [mode, setMode] = useState<AdvancedChartMode>("watch");
  const meta = ADVANCED_MODES.find((item) => item.key === mode)!;
  const isDisk = mode === "disk";

  const points = useMemo(() => {
    if (isDisk) {
      return snapshots.slice(-60).map((snapshot) => ({
        label: snapshot.at.slice(0, 10),
        value: snapshot.totalBytes,
      }));
    }
    return lastNDays(60).map((day) => ({
      label: day,
      value: daily[day]?.[meta.field as keyof ActivityBucket] || 0,
    }));
  }, [daily, isDisk, meta.field, snapshots]);

  const chartData = useMemo(
    () =>
      points.map((point, index) => {
        const start = Math.max(0, index - 6);
        const slice = points.slice(start, index + 1);
        const avg =
          slice.reduce((sum, item) => sum + item.value, 0) /
          Math.max(1, slice.length);
        return { ...point, avg };
      }),
    [points],
  );

  const values = points.map((point) => point.value);
  const peak = points.reduce(
    (best, point) => (point.value > best.value ? point : best),
    { label: "-", value: 0 },
  );
  const latest = points[points.length - 1] || { label: "-", value: 0 };
  const average =
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const chartHeight = expanded ? 360 : 260;
  const formatValue = (value: number) => {
    if (mode === "watch") return formatDuration(value);
    if (mode === "downloads" || mode === "disk") return formatBytes(value);
    return value.toLocaleString();
  };

  const tooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const value = Number(payload[0]?.value || 0);
    const avg = Number(payload[1]?.value || 0);
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-3 py-2 shadow-lg text-[11px]">
        <div className="font-bold text-slate-700 dark:text-slate-100 mb-1">
          {label}
        </div>
        <div className="text-amber-600 dark:text-amber-400">
          {meta.label}: {formatValue(value)}
        </div>
        <div className="text-slate-400">7 点均线: {formatValue(avg)}</div>
      </div>
    );
  };

  return (
    <div
      className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 ${expanded ? "lg:col-span-full" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <LineChart className="w-3.5 h-3.5 text-amber-500" />
          高级趋势分析
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {ADVANCED_MODES.map((item) => {
            const Icon = item.icon;
            const active = item.key === mode;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setMode(item.key)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[10px] font-bold transition cursor-pointer ${
                  active
                    ? "bg-amber-500 text-white border-amber-500"
                    : "bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                <Icon className="w-3 h-3" />
                {item.label}
              </button>
            );
          })}
          <PanelControls
            hidden={hidden}
            expanded={expanded}
            onToggleHidden={onToggleHidden}
            onToggleExpanded={onToggleExpanded}
          />
        </div>
      </div>

      {hidden ? (
        <HiddenPanelNote />
      ) : points.length === 0 ? (
        <div className="text-[11px] text-slate-400 text-center py-12">
          暂无可分析数据
        </div>
      ) : (
        <>
          <div style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 12, right: 18, left: 8, bottom: 6 }}
              >
                <defs>
                  <linearGradient
                    id={`recharts-advanced-${mode}`}
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={meta.color}
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="100%"
                      stopColor={meta.color}
                      stopOpacity={0.03}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 4"
                  stroke="rgba(148,163,184,0.22)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  tickLine={false}
                  axisLine={{ stroke: "rgba(148,163,184,0.25)" }}
                  minTickGap={28}
                />
                <YAxis
                  width={62}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => formatValue(Number(value))}
                />
                <Tooltip content={tooltip} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={meta.color}
                  strokeWidth={2.4}
                  fill={`url(#recharts-advanced-${mode})`}
                  dot={false}
                  activeDot={{ r: 4 }}
                  name={meta.label}
                />
                <Line
                  type="monotone"
                  dataKey="avg"
                  stroke="#64748b"
                  strokeWidth={1.5}
                  strokeDasharray="5 5"
                  dot={false}
                  name="7 点均线"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
            <MiniMetric
              label="当前值"
              value={formatValue(latest.value)}
              sub={latest.label}
            />
            <MiniMetric
              label="峰值"
              value={formatValue(peak.value)}
              sub={peak.label}
            />
            <MiniMetric
              label="平均值"
              value={formatValue(average)}
              sub={isDisk ? "快照均值" : "近 60 天日均"}
            />
            <MiniMetric label="图表库" value="Recharts" sub="第三方图表渲染" />
          </div>
        </>
      )}
    </div>
  );
}

function BarBlock({
  title,
  icon: Icon,
  rows,
  valueKind,
  hidden,
  expanded,
  onToggleHidden,
  onToggleExpanded,
}: {
  title: string;
  icon: IconType;
  rows: Array<{ label: string; value: number; sub?: string }>;
  valueKind: "count" | "duration" | "bytes";
  hidden: boolean;
  expanded: boolean;
  onToggleHidden: () => void;
  onToggleExpanded: () => void;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  const format = (value: number) =>
    valueKind === "duration"
      ? formatDuration(value)
      : valueKind === "bytes"
        ? formatBytes(value)
        : value.toLocaleString();

  return (
    <div
      className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 ${expanded ? "lg:col-span-full" : ""}`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-amber-500" />
          {title}
        </h3>
        <PanelControls
          hidden={hidden}
          expanded={expanded}
          onToggleHidden={onToggleHidden}
          onToggleExpanded={onToggleExpanded}
        />
      </div>
      {hidden ? (
        <HiddenPanelNote />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[56px_1fr_76px] items-center gap-2 text-[10px]"
            >
              <span className="text-slate-500 dark:text-slate-400 font-bold truncate">
                {row.label}
              </span>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-500"
                  style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
                />
              </div>
              <span className="text-right text-slate-600 dark:text-slate-300 font-mono truncate">
                {format(row.value)}
              </span>
              {row.sub && (
                <span className="col-start-2 col-span-2 text-[9px] text-slate-400 truncate">
                  {row.sub}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopList({
  title,
  icon: Icon,
  items,
  hidden,
  expanded,
  onToggleHidden,
  onToggleExpanded,
}: {
  title: string;
  icon: IconType;
  items: Array<{ label: string; sub?: string; value: string; right?: string }>;
  hidden: boolean;
  expanded: boolean;
  onToggleHidden: () => void;
  onToggleExpanded: () => void;
}) {
  return (
    <div
      className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 ${expanded ? "lg:col-span-full" : ""}`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-amber-500" />
          {title}
        </h3>
        <PanelControls
          hidden={hidden}
          expanded={expanded}
          onToggleHidden={onToggleHidden}
          onToggleExpanded={onToggleExpanded}
        />
      </div>
      {hidden ? (
        <HiddenPanelNote />
      ) : items.length === 0 ? (
        <div className="text-[10px] text-slate-400 dark:text-slate-500 text-center py-6">
          暂无数据
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item, index) => (
            <div
              key={`${item.label}-${index}`}
              className="flex items-center gap-2 text-[11px] py-1 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              <span className="w-5 text-center font-mono font-bold text-slate-400 dark:text-slate-500">
                {index + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-700 dark:text-slate-200 truncate select-text">
                  {item.label}
                </div>
                {item.sub && (
                  <div className="text-[9px] text-slate-400 dark:text-slate-500 truncate">
                    {item.sub}
                  </div>
                )}
              </div>
              <span className="text-amber-600 dark:text-amber-400 font-mono font-bold shrink-0">
                {item.value}
              </span>
              {item.right && (
                <span className="text-slate-400 dark:text-slate-500 text-[9px] font-mono shrink-0 w-14 text-right">
                  {item.right}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type PanelKey = "advanced" | "disk" | "hour" | "weekday" | "month" | "ranking";
type PanelStateValue = { hidden: boolean; expanded: boolean };

export function StatsPage({ videoPath, onAddSystemLog }: StatsPageProps) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [libraryVideos, setLibraryVideos] = useState<LibraryVideo[]>([]);
  const [isSnapshotting, setIsSnapshotting] = useState(false);
  const [panelState, setPanelState] = useState<
    Record<PanelKey, PanelStateValue>
  >({
    advanced: { hidden: false, expanded: false },
    disk: { hidden: false, expanded: false },
    hour: { hidden: false, expanded: false },
    weekday: { hidden: false, expanded: false },
    month: { hidden: false, expanded: false },
    ranking: { hidden: false, expanded: false },
  });
  const togglePanelHidden = (key: PanelKey) => {
    setPanelState((prev) => ({
      ...prev,
      [key]: { ...prev[key], hidden: !prev[key].hidden },
    }));
  };
  const togglePanelExpanded = (key: PanelKey) => {
    setPanelState((prev) => ({
      ...prev,
      [key]: { ...prev[key], expanded: !prev[key].expanded },
    }));
  };

  const refresh = async () => {
    try {
      const [statsData, videos] = await Promise.all([
        trpc.stats.get.query(),
        videoPath
          ? trpc.videos.list.query({ path: videoPath }).catch(() => [])
          : Promise.resolve([]),
      ]);
      setStats(statsData as StatsData);
      setLibraryVideos(videos as LibraryVideo[]);
    } catch (err: any) {
      onAddSystemLog(`统计加载失败: ${err?.message || err}`, "ERROR");
    }
  };

  useEffect(() => {
    void (async () => {
      // 每天首次进入统计页自动拍一次磁盘快照（后端会按日期去重）
      if (videoPath) {
        try {
          await trpc.stats.snapshotDisk.mutate({ rootPath: videoPath });
        } catch {
          /* ignore */
        }
      }
      await refresh();
    })();
  }, [videoPath]);

  const handleSnapshot = async () => {
    if (!videoPath) {
      onAddSystemLog("未配置视频路径，无法扫描磁盘占用", "ERROR");
      return;
    }
    setIsSnapshotting(true);
    try {
      const result = await trpc.stats.snapshotDisk.mutate({
        rootPath: videoPath,
        force: true,
      });
      if ((result as any).success) {
        const data = result as {
          totalBytes: number;
          videoCount: number;
          freeBytes?: number;
        };
        onAddSystemLog(
          `磁盘快照已记录: ${formatBytes(data.totalBytes)} / ${data.videoCount} 个视频 / 剩余 ${data.freeBytes ? formatBytes(data.freeBytes) : "未知"}`,
          "SUCCESS",
        );
        await refresh();
      } else {
        onAddSystemLog(
          `磁盘快照失败: ${(result as any).error || "未知错误"}`,
          "ERROR",
        );
      }
    } catch (err: any) {
      onAddSystemLog(`磁盘快照异常: ${err?.message || err}`, "ERROR");
    } finally {
      setIsSnapshotting(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("确认清空所有统计数据？此操作不可恢复。")) return;
    await trpc.stats.reset.mutate();
    onAddSystemLog("统计数据已重置", "WARNING");
    await refresh();
  };

  if (!stats) {
    return (
      <div className="relative h-full bg-[#fffaf5] dark:bg-slate-950">
        <PageLoader active label="加载统计数据" />
      </div>
    );
  }

  const videosArr = Object.values(stats.videos);
  const last7 = lastNDays(7);
  const last30 = lastNDays(30);
  const sumRange = (keys: string[], field: keyof ActivityBucket) =>
    keys.reduce((sum, key) => sum + (stats.daily[key]?.[field] || 0), 0);

  const activeDays = Object.values(stats.daily).filter(
    (day) => day.plays || day.watchSec || day.downloads,
  ).length;
  const avgWatchPerPlay =
    stats.totals.plays > 0 ? stats.totals.watchSec / stats.totals.plays : 0;
  const playedSet = new Set(videosArr.map((video) => video.folder));
  const unplayedCount = libraryVideos.filter(
    (video) => !playedSet.has(video.name),
  ).length;
  const coverage =
    libraryVideos.length > 0
      ? percent(libraryVideos.length - unplayedCount, libraryVideos.length)
      : "0%";
  const lastSnapshot = stats.diskSnapshots[stats.diskSnapshots.length - 1];

  const sortedDays = Object.keys(stats.daily).sort();
  let bestStreak = 0;
  let currentStreak = 0;
  let running = 0;
  for (let i = 0; i < sortedDays.length; i++) {
    const key = sortedDays[i];
    const active =
      (stats.daily[key]?.plays || 0) + (stats.daily[key]?.watchSec || 0) > 0;
    if (!active) continue;
    if (i === 0 || dayDiff(sortedDays[i - 1], key) === 1) {
      running += 1;
    } else {
      running = 1;
    }
    bestStreak = Math.max(bestStreak, running);
  }
  const today = todayKey();
  for (let cursor = parseDay(today); ; cursor.setDate(cursor.getDate() - 1)) {
    const key = dateKey(cursor);
    const day = stats.daily[key];
    if (!day || (day.plays || 0) + (day.watchSec || 0) === 0) break;
    currentStreak += 1;
  }

  const topByPlays = [...videosArr]
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, 10);
  const topByWatch = [...videosArr]
    .sort((a, b) => b.watchSec - a.watchSec)
    .slice(0, 10);
  const recentVideos = [...videosArr]
    .filter((video) => video.lastPlayedAt)
    .sort((a, b) => (b.lastPlayedAt || "").localeCompare(a.lastPlayedAt || ""))
    .slice(0, 10);

  const seriesMap = new Map<
    string,
    { plays: number; watchSec: number; count: number }
  >();
  for (const video of videosArr) {
    const key = video.series || inferSeries(video.folder);
    const item = seriesMap.get(key) || { plays: 0, watchSec: 0, count: 0 };
    item.plays += video.playCount;
    item.watchSec += video.watchSec;
    item.count += 1;
    seriesMap.set(key, item);
  }
  const topSeries = Array.from(seriesMap.entries())
    .sort((a, b) => b[1].plays - a[1].plays)
    .slice(0, 10);

  const hourRows = Array.from({ length: 24 }, (_, hour) => {
    const key = String(hour).padStart(2, "0");
    const bucket = stats.hourly?.[key] || emptyBucket();
    return {
      label: `${key}:00`,
      value: bucket.watchSec,
      sub: `${bucket.plays} 次播放`,
    };
  })
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const weekdayRows = WEEKDAY_LABELS.map((label, index) => {
    const bucket = stats.weekdays?.[String(index)] || emptyBucket();
    return { label, value: bucket.plays, sub: formatDuration(bucket.watchSec) };
  });

  const monthRows = Object.entries(stats.monthly || {})
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 8)
    .map(([month, bucket]) => ({
      label: month,
      value: bucket.downloadBytes,
      sub: `${bucket.downloads} 次下载 / ${bucket.plays} 次播放`,
    }));

  const busiestDay = Object.entries(stats.daily).sort(
    (a, b) => b[1].watchSec - a[1].watchSec,
  )[0];
  const bestHour = hourRows[0];

  return (
    <div
      className="relative h-full overflow-y-auto bg-[#fffaf5] dark:bg-slate-950 p-6 space-y-4 stats-stagger"
      key={stats ? "ready" : "loading"}
    >
      <PageLoader active={!stats} label="加载统计数据" />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            统计中心
          </h2>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            观影行为、下载活动、播放次数和视频盘空间的全景视图
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-amber-50 dark:hover:bg-amber-500/10 text-xs text-slate-600 dark:text-slate-300 font-bold rounded-lg transition cursor-pointer"
            title="刷新统计数据"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            刷新
          </button>
          <button
            onClick={handleSnapshot}
            disabled={isSnapshotting}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-amber-50 dark:hover:bg-amber-500/10 text-xs text-amber-700 dark:text-amber-400 font-bold rounded-lg transition cursor-pointer disabled:opacity-60"
            title="扫描视频路径并记录磁盘占用快照"
          >
            {isSnapshotting ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <HardDrive className="w-3.5 h-3.5" />
            )}
            {isSnapshotting ? "扫描中..." : "立即拍快照"}
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/40 hover:bg-rose-50 dark:hover:bg-rose-500/10 text-xs text-rose-600 dark:text-rose-400 font-bold rounded-lg transition cursor-pointer"
            title="清空所有统计数据"
          >
            <Trash2 className="w-3.5 h-3.5" />
            重置
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 stats-stagger-inner">
        <StatCard
          icon={Play}
          label="累计播放"
          value={`${stats.totals.plays.toLocaleString()} 次`}
          sub={`近 7 天 ${sumRange(last7, "plays")} 次`}
          color="bg-amber-500"
        />
        <StatCard
          icon={Clock}
          label="累计观看时长"
          value={formatDuration(stats.totals.watchSec)}
          sub={`近 30 天 ${formatDuration(sumRange(last30, "watchSec"))}`}
          color="bg-emerald-500"
        />
        <StatCard
          icon={Download}
          label="累计下载"
          value={`${stats.totals.downloads.toLocaleString()} 次`}
          sub={`总下载量 ${formatBytes(stats.totals.downloadBytes)}`}
          color="bg-sky-500"
        />
        <StatCard
          icon={HardDrive}
          label="当前占用"
          value={lastSnapshot ? formatBytes(lastSnapshot.totalBytes) : "暂无"}
          sub={
            lastSnapshot
              ? `${lastSnapshot.videoCount} 个视频文件`
              : "先拍一张快照"
          }
          color="bg-violet-500"
        />
        <StatCard
          icon={Gauge}
          label="库覆盖率"
          value={coverage}
          sub={`${libraryVideos.length - unplayedCount}/${libraryVideos.length} 部已播放`}
          color="bg-rose-500"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stats-stagger-inner">
        <MiniMetric
          label="活跃天数"
          value={`${activeDays} 天`}
          sub={`当前连看 ${currentStreak} 天`}
        />
        <MiniMetric
          label="最长连续观看"
          value={`${bestStreak} 天`}
          sub="按有观看记录的日期计算"
        />
        <MiniMetric
          label="平均单次观看"
          value={formatDuration(avgWatchPerPlay)}
          sub="总观看时长 / 播放次数"
        />
        <MiniMetric
          label="最猛的一天"
          value={busiestDay ? busiestDay[0] : "暂无"}
          sub={busiestDay ? formatDuration(busiestDay[1].watchSec) : undefined}
        />
      </div>

      <DualHeatmap daily={stats.daily} />

      <AdvancedStatsChart
        daily={stats.daily}
        snapshots={stats.diskSnapshots}
        hidden={panelState.advanced.hidden}
        expanded={panelState.advanced.expanded}
        onToggleHidden={() => togglePanelHidden("advanced")}
        onToggleExpanded={() => togglePanelExpanded("advanced")}
      />

      <DiskTrendChart
        snapshots={stats.diskSnapshots}
        hidden={panelState.disk.hidden}
        expanded={panelState.disk.expanded}
        onToggleHidden={() => togglePanelHidden("disk")}
        onToggleExpanded={() => togglePanelExpanded("disk")}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <BarBlock
          title="最常观看时段"
          icon={Timer}
          rows={hourRows}
          valueKind="duration"
          hidden={panelState.hour.hidden}
          expanded={panelState.hour.expanded}
          onToggleHidden={() => togglePanelHidden("hour")}
          onToggleExpanded={() => togglePanelExpanded("hour")}
        />
        <BarBlock
          title="星期播放分布"
          icon={CalendarDays}
          rows={weekdayRows}
          valueKind="count"
          hidden={panelState.weekday.hidden}
          expanded={panelState.weekday.expanded}
          onToggleHidden={() => togglePanelHidden("weekday")}
          onToggleExpanded={() => togglePanelExpanded("weekday")}
        />
        <BarBlock
          title="月度下载体量"
          icon={LineChart}
          rows={monthRows}
          valueKind="bytes"
          hidden={panelState.month.hidden}
          expanded={panelState.month.expanded}
          onToggleHidden={() => togglePanelHidden("month")}
          onToggleExpanded={() => togglePanelExpanded("month")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        <MiniMetric
          label="本周观看"
          value={formatDuration(sumRange(last7, "watchSec"))}
          sub={`${sumRange(last7, "plays")} 次播放`}
        />
        <MiniMetric
          label="本月下载"
          value={formatBytes(sumRange(last30, "downloadBytes"))}
          sub={`${sumRange(last30, "downloads")} 次下载`}
        />
        <MiniMetric
          label="收藏库规模"
          value={`${libraryVideos.length} 部`}
          sub={`${unplayedCount} 部还没播放过`}
        />
        <MiniMetric
          label="黄金时段"
          value={bestHour?.label || "暂无"}
          sub={bestHour ? bestHour.sub : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <TopList
          title="播放次数 Top 10"
          icon={Star}
          hidden={panelState.ranking.hidden}
          expanded={panelState.ranking.expanded}
          onToggleHidden={() => togglePanelHidden("ranking")}
          onToggleExpanded={() => togglePanelExpanded("ranking")}
          items={topByPlays.map((video) => ({
            label: video.folder,
            sub: video.lastPlayedAt
              ? `最近 ${video.lastPlayedAt.slice(0, 10)}`
              : undefined,
            value: `${video.playCount} 次`,
            right: formatDuration(video.watchSec),
          }))}
        />
        <TopList
          title="观看时长 Top 10"
          icon={Clock}
          hidden={panelState.ranking.hidden}
          expanded={panelState.ranking.expanded}
          onToggleHidden={() => togglePanelHidden("ranking")}
          onToggleExpanded={() => togglePanelExpanded("ranking")}
          items={topByWatch.map((video) => ({
            label: video.folder,
            sub: `系列: ${video.series || inferSeries(video.folder)}`,
            value: formatDuration(video.watchSec),
            right: `${video.playCount} 次`,
          }))}
        />
        <TopList
          title="热门系列 Top 10"
          icon={BarChart3}
          hidden={panelState.ranking.hidden}
          expanded={panelState.ranking.expanded}
          onToggleHidden={() => togglePanelHidden("ranking")}
          onToggleExpanded={() => togglePanelExpanded("ranking")}
          items={topSeries.map(([series, data]) => ({
            label: series,
            sub: `${data.count} 部视频`,
            value: `${data.plays} 次`,
            right: formatDuration(data.watchSec),
          }))}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TopList
          title="最近播放"
          icon={History}
          hidden={panelState.ranking.hidden}
          expanded={panelState.ranking.expanded}
          onToggleHidden={() => togglePanelHidden("ranking")}
          onToggleExpanded={() => togglePanelExpanded("ranking")}
          items={recentVideos.map((video) => ({
            label: video.folder,
            sub: video.lastPlayedAt
              ? video.lastPlayedAt.replace("T", " ").slice(0, 19)
              : undefined,
            value: `${video.playCount} 次`,
            right: formatDuration(video.watchSec),
          }))}
        />
        <TopList
          title="下载活跃日 Top 10"
          icon={Database}
          hidden={panelState.ranking.hidden}
          expanded={panelState.ranking.expanded}
          onToggleHidden={() => togglePanelHidden("ranking")}
          onToggleExpanded={() => togglePanelExpanded("ranking")}
          items={Object.entries(stats.daily)
            .sort((a, b) => b[1].downloadBytes - a[1].downloadBytes)
            .slice(0, 10)
            .map(([day, bucket]) => ({
              label: day,
              sub: `${bucket.downloads} 次下载 / ${bucket.plays} 次播放`,
              value: formatBytes(bucket.downloadBytes),
              right: formatDuration(bucket.watchSec),
            }))}
        />
      </div>

      <div className="pb-2 text-[10px] text-slate-400 dark:text-slate-500">
        播放统计会在播放器开始播放时记录次数，并在播放过程中周期性累计观看时长；下载统计会在任务成功完成时记录。
      </div>
    </div>
  );
}
