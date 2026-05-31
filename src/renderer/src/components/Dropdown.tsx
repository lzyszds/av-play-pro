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
}

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  minWidth = 84,
  className = "",
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

  // 点击外部 / Esc / 滚动 / 尺寸变化 时关闭或重算
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
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ minWidth }}
        className="flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:bg-amber-50/40 transition cursor-pointer text-[11px] font-sans"
      >
        <span className="flex items-center gap-1.5 truncate">
          {selected?.dot && (
            <span className={`w-1.5 h-1.5 rounded-full ${selected.dot}`} />
          )}
          {selected?.label}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${
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
            <ul className="py-1 rounded-lg border border-slate-200 bg-white shadow-lg shadow-slate-900/10 overflow-hidden">
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
                          ? "bg-amber-50 text-amber-700 font-semibold"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        {opt.dot && (
                          <span className={`w-1.5 h-1.5 rounded-full ${opt.dot}`} />
                        )}
                        {opt.label}
                      </span>
                      {active && <Check className="w-3 h-3 text-amber-600 shrink-0" />}
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
