import React from "react";

/**
 * 统一直播/控制台头部：accent 图标盒 + 标题 + 大写 mono 徽标 + 副题 + 右侧动作。
 * 收敛各页各自手写的页头。
 */
export interface PageHeaderProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** 标题右侧的大写 mono 徽标（如页面计数） */
  micro?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  size?: "md" | "sm";
  className?: string;
}

export function PageHeader({
  icon,
  title,
  micro,
  subtitle,
  actions,
  size = "md",
  className = "",
}: PageHeaderProps) {
  const boxCls =
    size === "md"
      ? "w-10 h-10 rounded-2xl"
      : "w-8 h-8 rounded-xl";
  const iconCls = size === "md" ? "w-5 h-5" : "w-4 h-4";
  const titleCls =
    size === "md"
      ? "text-xl font-bold tracking-tight"
      : "text-base font-bold tracking-tight";

  // 统一注入图标尺寸（覆盖调用方传入的 w/h），类型安全地 clone
  const iconNode =
    icon != null && React.isValidElement(icon)
      ? React.cloneElement(
          icon as React.ReactElement<{ className?: string }>,
          {
            className: `${iconCls} ${
              (icon.props as { className?: string } | undefined)?.className ??
              ""
            }`.trim(),
          },
        )
      : icon;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {icon && (
        <div
          className={`${boxCls} shrink-0 flex items-center justify-center bg-accent-500/10 border border-accent-500/20 text-accent-500`}
        >
          {iconNode}
        </div>
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className={`${titleCls} text-text-1 truncate`}>{title}</h2>
          {micro && (
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.18em] bg-accent-500/10 text-accent-500 px-1.5 py-0.5 rounded-full whitespace-nowrap">
              {micro}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-text-2 mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="ml-auto flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}
