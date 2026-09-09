import React from "react";

/**
 * 统一「微标签」：大写 + 加宽字距的小标题（区块头、分组说明）。
 */
export interface MicroLabelProps {
  children?: React.ReactNode;
  tone?: "muted" | "accent" | "violet";
  className?: string;
}

const toneClass: Record<NonNullable<MicroLabelProps["tone"]>, string> = {
  muted: "text-text-3",
  accent: "text-accent-500",
  violet: "text-violet-500",
};

export function MicroLabel({
  children,
  tone = "muted",
  className = "",
}: MicroLabelProps) {
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-[0.2em] ${toneClass[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
