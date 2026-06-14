import React, { useEffect, useRef } from "react";

type Tone = "amber" | "emerald" | "rose" | "sky";

const TONE_BG: Record<Tone, string> = {
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  sky: "bg-sky-500",
};

const TONE_RING_STROKE: Record<Tone, string> = {
  amber: "#f59e0b",
  emerald: "#10b981",
  rose: "#f43f5e",
  sky: "#0ea5e9",
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

  const size = 48;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, progress ?? 0));
  const dash = (pct / 100) * c;

  return (
    <>
      {/* popover —— 放在球的左上方 */}
      {open && (
        <div
          ref={popRef}
          style={{ bottom: bottomOffset + size + 12, right: rightOffset }}
          className={`fixed z-50 ${popoverWidthClass} bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden text-xs anim-pop-in`}
        >
          {popoverTitle && (
            <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 font-bold text-slate-700 dark:text-slate-200">
              {popoverTitle}
            </div>
          )}
          {popover}
        </div>
      )}

      {/* 球 */}
      <div
        ref={ballRef}
        style={{ bottom: bottomOffset, right: rightOffset, width: size, height: size }}
        className="fixed z-40"
      >
        <button
          type="button"
          onClick={onToggle}
          title={title}
          className={`relative w-full h-full rounded-full ${TONE_BG[tone]} text-white shadow-lg hover:brightness-110 active:scale-95 transition cursor-pointer flex items-center justify-center ${
            pulse ? "ring-2 ring-white/50 animate-pulse" : ""
          }`}
        >
          {/* 进度环 */}
          {progress != null && progress > 0 && (
            <svg
              className="absolute inset-0 -rotate-90"
              width={size}
              height={size}
              viewBox={`0 0 ${size} ${size}`}
            >
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={stroke}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={TONE_RING_STROKE[tone]}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeLinecap="round"
                style={{
                  filter: "drop-shadow(0 0 4px rgba(255,255,255,0.6))",
                  transition: "stroke-dasharray 200ms ease",
                }}
              />
            </svg>
          )}

          {/* 图标 */}
          <span className="relative z-10 flex items-center justify-center">
            {icon}
          </span>

          {/* 角标 */}
          {badge != null && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-slate-800 dark:bg-slate-900 dark:text-white border border-current/20 text-[10px] font-bold flex items-center justify-center shadow">
              {badge}
            </span>
          )}
        </button>
      </div>
    </>
  );
}
