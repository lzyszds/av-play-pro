import React from "react";

/**
 * 统一语义状态/通知胶囊。色相约定：
 * neutral 中性 / success 成功 / warn 警示(真琥珀橙) / error 错误(玫瑰红) / info 信息(天蓝) / accent 品牌强调(玫瑰金)。
 * 注意：amber-* 已被重映射为玫瑰，故「警示黄」走 Tailwind 默认 orange。
 */
export type ChipTone =
  | "neutral"
  | "success"
  | "warn"
  | "error"
  | "info"
  | "accent";

export interface ChipProps {
  tone?: ChipTone;
  /** 前缀小圆点（语义色） */
  dot?: boolean;
  children?: React.ReactNode;
  className?: string;
}

const toneClass: Record<ChipTone, string> = {
  neutral:
    "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/70 dark:text-slate-300 dark:border-slate-700",
  success:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30",
  warn: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/30",
  error:
    "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30",
  info: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/30",
  accent:
    "bg-accent-50 text-accent-700 border-accent-200 dark:bg-accent-500/10 dark:text-accent-400 dark:border-accent-500/30",
};

const dotClass: Record<ChipTone, string> = {
  neutral: "bg-slate-400",
  success: "bg-emerald-500",
  warn: "bg-orange-500",
  error: "bg-rose-500",
  info: "bg-sky-500",
  accent: "bg-accent-500",
};

export function Chip({
  tone = "neutral",
  dot = false,
  children,
  className = "",
}: ChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${toneClass[tone]} ${className}`}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass[tone]}`} />
      )}
      {children}
    </span>
  );
}
