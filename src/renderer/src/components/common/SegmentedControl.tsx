import React from "react";

export interface SegmentedOption<V extends string> {
  value: V;
  label: React.ReactNode;
}

export interface SegmentedControlProps<V extends string> {
  value: V;
  options: SegmentedOption<V>[];
  onChange: (value: V) => void;
  /** inline = 轨道滑块式（iOS 风）；grid = 等宽单元格（设置里的主题/关闭动作等） */
  layout?: "inline" | "grid";
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
}

export function SegmentedControl<V extends string>({
  value,
  options,
  onChange,
  layout = "grid",
  size = "md",
  className = "",
  disabled = false,
}: SegmentedControlProps<V>) {
  const textCls = size === "sm" ? "text-[10px]" : "text-[11px]";
  const padCls = size === "sm" ? "px-2 py-1" : "px-3 py-1.5";

  if (layout === "inline") {
    return (
      <div
        className={`inline-flex items-center gap-1 p-1 rounded-xl border-hairline bg-surface-2 ${className}`}
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={`${textCls} ${padCls} rounded-lg font-bold transition cursor-pointer whitespace-nowrap disabled:cursor-not-allowed ${
                active
                  ? "bg-panel text-accent-600 dark:text-accent-400 shadow-sm border border-hairline"
                  : "text-text-2 hover:text-text-1 border border-transparent"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={`grid gap-1.5 ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`${textCls} ${padCls} rounded-lg border font-bold transition cursor-pointer text-center disabled:cursor-not-allowed ${
              active
                ? "border-accent-500/40 bg-accent-500/10 text-accent-600 dark:text-accent-400"
                : "border-hairline bg-surface-1 text-text-2 hover:text-text-1 hover:border-hairline-strong"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
