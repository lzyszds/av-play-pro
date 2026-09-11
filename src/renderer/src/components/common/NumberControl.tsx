import React, { useEffect, useState } from "react";

/**
 * 数字步进控件：从 SettingsPanel 底部搬移 + 令牌化（行为不变，blur 提交、± 步进）。
 */
export interface NumberControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
}

export function NumberControl({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: NumberControlProps) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const [draftValue, setDraftValue] = useState(value);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  const safeValue = clamp(draftValue);
  const commit = (next: number) => {
    const clamped = clamp(next);
    setDraftValue(clamped);
    onChange(clamped);
  };
  const commitDraft = () => commit(safeValue);

  return (
    <div className="rounded-lg border-hairline bg-surface-1 px-3 py-2.5">
      <div className="grid grid-cols-[84px_32px_1fr_32px] items-center gap-2">
        <span className="text-[11px] font-semibold text-text-2">{label}</span>
        <button
          type="button"
          onClick={() => commit(safeValue - step)}
          className="flex h-8 w-8 items-center justify-center rounded-md border-hairline bg-surface-2 text-sm font-bold text-text-2 hover:border-accent-400 hover:bg-accent-500/10 hover:text-accent-600 dark:hover:text-accent-400 transition cursor-pointer"
          aria-label={`${label} 减少`}
        >
          -
        </button>
        <div className="relative">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={safeValue}
            onChange={(e) =>
              setDraftValue(clamp(Number(e.target.value || min)))
            }
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitDraft();
                e.currentTarget.blur();
              }
            }}
            className="h-8 w-full rounded-md border-hairline bg-panel dark:bg-[#2a2d33] px-3 pr-9 text-center font-mono text-[12px] font-semibold text-text-1 focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-text-3">
            {suffix}
          </span>
        </div>
        <button
          type="button"
          onClick={() => commit(safeValue + step)}
          className="flex h-8 w-8 items-center justify-center rounded-md border-hairline bg-surface-2 text-sm font-bold text-text-2 hover:border-accent-400 hover:bg-accent-500/10 hover:text-accent-600 dark:hover:text-accent-400 transition cursor-pointer"
          aria-label={`${label} 增加`}
        >
          +
        </button>
      </div>
    </div>
  );
}
