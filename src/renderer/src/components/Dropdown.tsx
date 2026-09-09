import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
  /** 选项前的小圆点颜色类，如 "bg-emerald-500"（可选） */
  dot?: string;
}

interface DropdownProps<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** 触发器最小宽度，默认 84px */
  minWidth?: number;
  className?: string;
  /** 自定义触发器样式（覆盖默认样式） */
  customTriggerStyle?: string;
  /** 触发器按钮上前缀文本（如"演员"） */
  prefix?: string;
}

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  minWidth = 84,
  className = "",
  customTriggerStyle,
  prefix,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; right: number; width: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? options[0];

  const updateRect = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 4, right: window.innerWidth - r.right, width: r.width });
  };

  // 打开时计算位置
  useLayoutEffect(() => {
    if (open) updateRect();
  }, [open]);

  // 点击外部 / Esc / 尺寸变化 时关闭
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        menuRef.current?.contains(t)
      )
        return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const defaultTriggerClass =
    "flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg border border-hairline bg-surface-1 text-text-2 hover:border-accent-400/60 hover:bg-accent-500/10 hover:text-text-1 transition cursor-pointer text-[11px] font-sans";

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ minWidth: customTriggerStyle ? undefined : minWidth }}
        className={customTriggerStyle || defaultTriggerClass}
      >
        <span className="flex items-center gap-1.5 truncate">
          {selected?.dot && (
            <span className={`w-1.5 h-1.5 rounded-full ${selected.dot}`} />
          )}
          {prefix ? (
            <>
              <span className="opacity-70">{prefix}</span>
              {value !== "全部" && <>
                <span className="opacity-50">:</span>
                <span className="font-semibold">{selected?.label}</span>
              </>}
            </>
          ) : (
            selected?.label
          )}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-text-3 shrink-0 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: rect.top,
              right: rect.right,
              minWidth: rect.width,
            }}
            className="z-[1000] anim-scale-in origin-top-right"
          >
            <ul className="py-1 rounded-lg border border-hairline bg-panel dark:bg-[#161016] shadow-xl shadow-black/15 dark:shadow-black/50 max-h-64 overflow-y-auto drop-scrollbar">
              {options.map((opt) => {
                const active = opt.value === value;
                return (
                  <li key={opt.value}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      className={`w-full flex items-center justify-between gap-3 px-2.5 py-1.5 text-left text-[11px] transition cursor-pointer ${
                        active
                          ? "bg-accent-500/10 text-accent-600 dark:text-accent-400 font-semibold"
                          : "text-text-2 hover:bg-accent-500/5 hover:text-text-1"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        {opt.dot && (
                          <span className={`w-1.5 h-1.5 rounded-full ${opt.dot}`} />
                        )}
                        {opt.label}
                      </span>
                      {active && <Check className="w-3 h-3 text-accent-500 shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
