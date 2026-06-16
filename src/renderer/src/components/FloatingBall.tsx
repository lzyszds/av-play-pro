import React, { useEffect, useRef } from "react";

type Tone = "amber" | "emerald" | "rose" | "sky" | "violet";

/** 每个 tone 的完整配色：底色（渐变）+ 进度环颜色 + 光晕颜色 */
const TONE_META: Record<
  Tone,
  {
    bg: string;
    ringStroke: string;
    ringGlow: string;
    badgeBg: string;
  }
> = {
  amber: {
    bg: "from-amber-400 via-amber-500 to-orange-500",
    ringStroke: "#fde68a",
    ringGlow: "rgba(251, 191, 36, 0.55)",
    badgeBg: "bg-white",
  },
  emerald: {
    bg: "from-emerald-400 via-emerald-500 to-teal-500",
    ringStroke: "#a7f3d0",
    ringGlow: "rgba(16, 185, 129, 0.55)",
    badgeBg: "bg-white",
  },
  rose: {
    bg: "from-rose-400 via-rose-500 to-pink-500",
    ringStroke: "#fecdd3",
    ringGlow: "rgba(244, 63, 94, 0.55)",
    badgeBg: "bg-white",
  },
  sky: {
    bg: "from-sky-400 via-sky-500 to-indigo-500",
    ringStroke: "#bae6fd",
    ringGlow: "rgba(14, 165, 233, 0.55)",
    badgeBg: "bg-white",
  },
  violet: {
    bg: "from-violet-400 via-violet-500 to-fuchsia-500",
    ringStroke: "#ddd6fe",
    ringGlow: "rgba(139, 92, 246, 0.55)",
    badgeBg: "bg-white",
  },
};

export interface FloatingBallProps {
  icon: React.ReactNode;
  /** 0–100，画在外圈的进度环。<=0 时不画。 */
  progress?: number;
  /** 右上小角标，例如 "3" */
  badge?: React.ReactNode;
  tone?: Tone;
  open: boolean;
  onToggle: () => void;
  /** 展开时弹出的卡片内容 */
  popover: React.ReactNode;
  /** 距底部偏移（px） */
  bottomOffset?: number;
  /** 距右侧偏移（px），多个球并排时使用 */
  rightOffset?: number;
  /** popover 标题（在卡片头里显示） */
  popoverTitle?: React.ReactNode;
  popoverWidthClass?: string;
  /** 悬浮提示 */
  title?: string;
  /** 球本身是否处于"活跃/呼吸"状态（动画提示有任务在跑） */
  pulse?: boolean;
}

const BALL_SIZE = 54; // 球外径
const RING_STROKE = 3;
const RING_R = (BALL_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_R;

export function FloatingBall({
  icon,
  progress,
  badge,
  tone = "amber",
  open,
  onToggle,
  popover,
  bottomOffset = 16,
  rightOffset = 16,
  popoverTitle,
  popoverWidthClass = "w-80",
  title,
  pulse,
}: FloatingBallProps) {
  const ballRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const meta = TONE_META[tone];

  // 点击外面关闭 popover
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ballRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      onToggle();
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open, onToggle]);

  const pct = Math.max(0, Math.min(100, progress ?? 0));
  const showRing = pct > 0 && pct < 100;
  const dash = (pct / 100) * RING_CIRC;

  return (
    <>
      {/* popover —— 玻璃卡片 */}
      {open && (
        <div
          ref={popRef}
          style={{
            bottom: bottomOffset + BALL_SIZE + 12,
            right: rightOffset,
          }}
          className={`fixed z-50 ${popoverWidthClass} anim-pop-in`}
        >
          <div className="rounded-2xl overflow-hidden shadow-[0_20px_60px_-15px_rgba(0,0,0,0.35)] ring-1 ring-white/10 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl text-slate-700 dark:text-slate-200">
            {popoverTitle && (
              <div className="px-4 py-2.5 border-b border-slate-100/70 dark:border-slate-800/70 font-bold text-sm flex items-center gap-2 bg-gradient-to-r from-white to-slate-50 dark:from-slate-900 dark:to-slate-800">
                {popoverTitle}
              </div>
            )}
            {popover}
          </div>
          {/* 小三角指向悬浮球 */}
          <div className="absolute bottom-[-6px] right-6 w-3 h-3 rotate-45 bg-white dark:bg-slate-900 ring-1 ring-white/10 dark:ring-slate-800/30 shadow-sm" />
        </div>
      )}

      {/* 球 */}
      <div
        ref={ballRef}
        style={{ bottom: bottomOffset, right: rightOffset }}
        className="fixed z-40 group"
      >
        {/* 外层光晕（有任务时呼吸） */}
        <div
          className={`absolute inset-0 rounded-full bg-gradient-to-br ${meta.bg} opacity-60 blur-lg transition group-hover:opacity-80 ${
            pulse ? "animate-pulse" : ""
          }`}
          style={{ width: BALL_SIZE, height: BALL_SIZE }}
        />
        <button
          type="button"
          onClick={onToggle}
          title={title}
          className={`relative flex items-center justify-center text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)] hover:shadow-[0_12px_32px_-6px_rgba(0,0,0,0.55)] active:scale-95 transition cursor-pointer bg-gradient-to-br ${meta.bg}`}
          style={{ width: BALL_SIZE, height: BALL_SIZE, borderRadius: "9999px" }}
        >
          {/* 高光 */}
          <span
            className="absolute top-1 left-1 right-3 h-1/2 rounded-t-full bg-gradient-to-b from-white/40 to-transparent"
            style={{ pointerEvents: "none" }}
          />
          {/* 进度环 */}
          {showRing && (
            <svg
              className="absolute inset-0"
              width={BALL_SIZE}
              height={BALL_SIZE}
              viewBox={`0 0 ${BALL_SIZE} ${BALL_SIZE}`}
              style={{ transform: "rotate(-90deg)" }}
            >
              <circle
                cx={BALL_SIZE / 2}
                cy={BALL_SIZE / 2}
                r={RING_R}
                fill="none"
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={RING_STROKE}
              />
              <circle
                cx={BALL_SIZE / 2}
                cy={BALL_SIZE / 2}
                r={RING_R}
                fill="none"
                stroke={meta.ringStroke}
                strokeWidth={RING_STROKE}
                strokeDasharray={`${dash} ${RING_CIRC - dash}`}
                strokeLinecap="round"
                style={{
                  filter: `drop-shadow(0 0 6px ${meta.ringGlow})`,
                  transition: "stroke-dasharray 250ms ease",
                }}
              />
            </svg>
          )}
          {/* 图标 */}
          <span className="relative z-10 flex items-center justify-center drop-shadow-sm">
            {icon}
          </span>
          {/* 角标 */}
          {badge != null && (
            <span
              className={`absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1.5 rounded-full ${meta.badgeBg} text-slate-800 text-[11px] font-bold flex items-center justify-center shadow ring-2 ring-white/70`}
            >
              {badge}
            </span>
          )}
        </button>
      </div>
    </>
  );
}
