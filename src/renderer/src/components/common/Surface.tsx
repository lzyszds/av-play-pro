import React from "react";

/**
 * 语义表面：全站卡片/面板的统一起点。
 * - glass：强玻璃（弹窗框/吸顶条，blur 20px，仅限少数场景）
 * - soft：软玻璃（大滚动列表/卡片，默认无 backdrop-filter，避免逐卡掉帧）
 * - panel：不透明兜底（玻璃不适用处）
 * - subtle：最轻的底层分隔（比 soft 更接近画布）
 */
export type SurfaceVariant = "glass" | "soft" | "panel" | "subtle";

export interface SurfaceProps {
  variant?: SurfaceVariant;
  /** 加入 hover 抬升与光环，用于可点击卡片 */
  hover?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const variantClass: Record<SurfaceVariant, string> = {
  glass: "glass",
  soft: "glass-soft",
  panel: "bg-panel",
  subtle: "bg-surface-2",
};

export function Surface({
  variant = "soft",
  hover = false,
  className = "",
  children,
}: SurfaceProps) {
  return (
    <div
      className={`relative rounded-2xl border-hairline ${variantClass[variant]} ${
        hover
          ? "transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/30 cursor-pointer"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
