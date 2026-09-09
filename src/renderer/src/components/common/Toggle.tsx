import React from "react";

/**
 * 统一切换开关。开启态用 accent（玫瑰金），关闭态为中性灰。
 */
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  title?: string;
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  size = "md",
  title,
}: ToggleProps) {
  const trackCls =
    size === "md"
      ? "w-9 h-5"
      : "w-7 h-4";
  const knobCls =
    size === "md" ? "w-4 h-4 top-0.5 left-0.5" : "w-3 h-3 top-0.5 left-0.5";
  const moveCls = size === "md" ? "translate-x-4" : "translate-x-3";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      title={title ?? (checked ? "点击关闭" : "点击开启")}
      className={`relative rounded-full transition-colors cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-accent-500" : "bg-slate-300 dark:bg-slate-700"
      } ${trackCls}`}
    >
      <span
        className={`absolute ${knobCls} bg-white rounded-full shadow-sm transition-transform ${
          checked ? moveCls : ""
        }`}
      />
    </button>
  );
}
