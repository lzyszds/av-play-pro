import React, { useMemo, useState, useEffect } from "react";

export interface HeatmapPoint {
  x: number; // 0 to 100 (%)
  val: number; // 0 to 1 (normalized intensity)
}

interface PlayerHeatmapProps {
  videoKey: string;
  duration: number;
  currentTime?: number;
  bookmarks?: Array<{ currentTime: number; note?: string }>;
  onHoverTime?: (time: number | null, percent: number | null, val: number | null) => void;
}

// 简单字符串哈希转种子
function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// 基于伪随机数生成符合人体工学与剧情节奏的平滑波形 (3个主要高能起伏峰)
function generateOrganicHeatmap(seed: number, count = 80): number[] {
  const s = seed || 12345;
  const raw: number[] = new Array(count).fill(0);

  // 主峰 1: 前期突破 (18% - 28%)
  const peak1 = 0.22;
  // 主峰 2: 中期激战 (50% - 62%)
  const peak2 = 0.56;
  // 主峰 3: 巅峰终章 (80% - 92%)
  const peak3 = 0.85;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    // 高斯钟形脉冲
    const g1 = Math.exp(-Math.pow((t - peak1) / 0.08, 2)) * 0.75;
    const g2 = Math.exp(-Math.pow((t - peak2) / 0.1, 2)) * 0.88;
    const g3 = Math.exp(-Math.pow((t - peak3) / 0.07, 2)) * 1.0;

    // 叠加伪随机抖动微波
    const noise =
      Math.sin(t * 24 + (s % 10)) * 0.08 +
      Math.sin(t * 47 + (s % 30)) * 0.05 +
      Math.cos(t * 12 + (s % 17)) * 0.06;

    const base = 0.15 + (s % 15) * 0.008;
    raw[i] = Math.max(0.08, Math.min(1.0, base + g1 + g2 + g3 + noise));
  }

  return raw;
}

const HEATMAP_STORAGE_PREFIX = "avplay:heatmap:";

export function recordUserSeekHeat(videoKey: string, timeSec: number, duration: number): void {
  if (!videoKey || !duration || duration <= 0) return;
  try {
    const key = HEATMAP_STORAGE_PREFIX + videoKey;
    const existingRaw = localStorage.getItem(key);
    let arr: number[] = existingRaw ? JSON.parse(existingRaw) : new Array(80).fill(0);
    if (!Array.isArray(arr) || arr.length !== 80) arr = new Array(80).fill(0);

    const bucket = Math.max(0, Math.min(79, Math.floor((timeSec / duration) * 80)));
    // 自身以及左右两个相邻桶增加权重（高斯弥散）
    arr[bucket] += 1.0;
    if (bucket > 0) arr[bucket - 1] += 0.5;
    if (bucket < 79) arr[bucket + 1] += 0.5;

    localStorage.setItem(key, JSON.stringify(arr));
  } catch {
    /* ignore storage quota */
  }
}

export const PlayerHeatmap: React.FC<PlayerHeatmapProps> = ({
  videoKey,
  duration,
  currentTime = 0,
  bookmarks = [],
}) => {
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const [userHeat, setUserHeat] = useState<number[]>([]);

  // 读取本地用户自定义 seek 增益
  useEffect(() => {
    if (!videoKey) return;
    try {
      const raw = localStorage.getItem(HEATMAP_STORAGE_PREFIX + videoKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 80) {
          setUserHeat(parsed);
        }
      }
    } catch {
      /* ignore */
    }
  }, [videoKey]);

  // 计算融合热力点
  const points = useMemo(() => {
    const seed = hashString(videoKey || "default_video");
    const baseWave = generateOrganicHeatmap(seed, 80);

    // 最大用户权重
    const maxUserHeat = userHeat.length > 0 ? Math.max(...userHeat, 1) : 1;

    // 书签增强
    const bookmarkBuckets = new Set<number>();
    if (duration > 0) {
      for (const b of bookmarks) {
        const bIdx = Math.floor((b.currentTime / duration) * 80);
        if (bIdx >= 0 && bIdx < 80) bookmarkBuckets.add(bIdx);
      }
    }

    const merged: HeatmapPoint[] = [];
    for (let i = 0; i < 80; i++) {
      const x = (i / 79) * 100;
      let val = baseWave[i];

      // 叠加热度
      if (userHeat[i]) {
        val += (userHeat[i] / maxUserHeat) * 0.4;
      }
      // 叠加书签
      if (bookmarkBuckets.has(i)) {
        val += 0.35;
      }

      val = Math.min(1.0, Math.max(0.1, val));
      merged.push({ x, val });
    }

    return merged;
  }, [videoKey, userHeat, bookmarks, duration]);

  // 生成平滑 SVG path 路径
  const { pathData, areaData } = useMemo(() => {
    if (points.length === 0) return { pathData: "", areaData: "" };

    const width = 1000;
    const height = 36;
    const coords = points.map((p) => ({
      x: (p.x / 100) * width,
      y: height - p.val * (height - 4), // 顶部留 4px
    }));

    // 平滑三次贝塞尔曲线
    let d = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const curr = coords[i];
      const next = coords[i + 1];
      const midX = (curr.x + next.x) / 2;
      const midY = (curr.y + next.y) / 2;
      d += ` Q ${curr.x} ${curr.y}, ${midX} ${midY}`;
    }
    const last = coords[coords.length - 1];
    d += ` L ${last.x} ${last.y}`;

    // 闭合区域用于渐变填充
    const area = `${d} L ${width} ${height} L 0 ${height} Z`;

    return { pathData: d, areaData: area };
  }, [points]);

  // 悬停点对应的高能指数与文案
  const hoverInfo = useMemo(() => {
    if (hoverPercent === null || points.length === 0) return null;
    const idx = Math.min(
      points.length - 1,
      Math.max(0, Math.round((hoverPercent / 100) * (points.length - 1))),
    );
    const intensity = Math.round(points[idx].val * 100);

    let levelText = "剧情铺垫";
    let icon = "🎬";
    let badgeClass = "text-slate-300 border-white/20 bg-black/60";

    if (intensity >= 85) {
      levelText = "极度高能";
      icon = "🔥";
      badgeClass = "text-rose-400 border-rose-500/40 bg-rose-950/80 shadow-[0_0_12px_rgba(244,63,94,0.4)]";
    } else if (intensity >= 65) {
      levelText = "精彩时刻";
      icon = "⚡";
      badgeClass = "text-amber-400 border-amber-500/40 bg-amber-950/80 shadow-[0_0_10px_rgba(245,158,11,0.3)]";
    } else if (intensity >= 45) {
      levelText = "渐入佳境";
      icon = "📈";
      badgeClass = "text-sky-300 border-sky-500/40 bg-sky-950/70";
    }

    return { intensity, levelText, icon, badgeClass, percent: hoverPercent };
  }, [hoverPercent, points]);

  return (
    <div
      className="absolute inset-x-0 bottom-full h-9 mb-1 pointer-events-none select-none overflow-visible transition-opacity duration-300 group-hover/plyr:opacity-100"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const p = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
        setHoverPercent(p);
      }}
      onMouseLeave={() => setHoverPercent(null)}
      style={{ zIndex: 25 }}
    >
      <svg
        viewBox="0 0 1000 36"
        preserveAspectRatio="none"
        className="w-full h-full overflow-visible drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
      >
        <defs>
          {/* 热力多色垂直渐变 */}
          <linearGradient id={`heatGrad-${videoKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.85" />
            <stop offset="45%" stopColor="#f59e0b" stopOpacity="0.55" />
            <stop offset="85%" stopColor="#8b5cf6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" />
          </linearGradient>

          {/* 顶线发光描边 */}
          <linearGradient id={`heatLine-${videoKey}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.8" />
            <stop offset="35%" stopColor="#ef4444" stopOpacity="0.95" />
            <stop offset="70%" stopColor="#ec4899" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#eab308" stopOpacity="0.85" />
          </linearGradient>
        </defs>

        {/* 区域半透明填充 */}
        <path d={areaData} fill={`url(#heatGrad-${videoKey})`} />

        {/* 顶部平滑亮色波峰描边 */}
        <path
          d={pathData}
          fill="none"
          stroke={`url(#heatLine-${videoKey})`}
          strokeWidth="1.8"
          strokeLinecap="round"
          className="opacity-90"
        />
      </svg>

      {/* 悬停高能气泡指示器 */}
      {hoverInfo && (
        <div
          className="absolute -top-7 transform -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border backdrop-blur-md pointer-events-none transition-all duration-700 animate-in fade-in zoom-in-95"
          style={{ left: `${hoverInfo.percent}%` }}
        >
          <span className="text-xs leading-none">{hoverInfo.icon}</span>
          <span className="font-mono">{hoverInfo.intensity}%</span>
          <span className="text-[10px] font-medium opacity-90">{hoverInfo.levelText}</span>
        </div>
      )}
    </div>
  );
};
