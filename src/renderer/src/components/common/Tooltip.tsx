import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: "top" | "bottom" | "left" | "right";
  delay?: number;
  shortcut?: string;
  className?: string;
  disabled?: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  placement = "bottom",
  delay = 120,
  shortcut,
  className = "",
  disabled = false,
}) => {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const calculatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    let top = 0;
    let left = 0;
    const offset = 6;

    switch (placement) {
      case "top":
        top = rect.top - offset;
        left = rect.left + rect.width / 2;
        break;
      case "bottom":
        top = rect.bottom + offset;
        left = rect.left + rect.width / 2;
        break;
      case "left":
        top = rect.top + rect.height / 2;
        left = rect.left - offset;
        break;
      case "right":
        top = rect.top + rect.height / 2;
        left = rect.right + offset;
        break;
    }

    setCoords({ top, left });
  };

  const handleMouseEnter = () => {
    if (disabled || !content) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      calculatePosition();
      setVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const clonedChild = React.cloneElement(children as React.ReactElement<any>, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      const originalRef = (children as any).ref;
      if (typeof originalRef === "function") {
        originalRef(node);
      } else if (originalRef) {
        originalRef.current = node;
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      handleMouseEnter();
      (children as any).props?.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      handleMouseLeave();
      (children as any).props?.onMouseLeave?.(e);
    },
    onClick: (e: React.MouseEvent) => {
      handleMouseLeave();
      (children as any).props?.onClick?.(e);
    },
  });

  return (
    <>
      {clonedChild}
      {visible &&
        content &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              transform:
                placement === "top"
                  ? "translate(-50%, -100%)"
                  : placement === "bottom"
                    ? "translate(-50%, 0)"
                    : placement === "left"
                      ? "translate(-100%, -50%)"
                      : "translate(0, -50%)",
              zIndex: 999999,
            }}
            className={`pointer-events-none select-none px-2.5 py-1.5 rounded-lg bg-slate-900/95 text-slate-100 text-[11px] leading-snug border border-slate-700/80 shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md animate-in fade-in zoom-in-95 duration-150 flex items-center gap-2 max-w-xs ${className}`}
          >
            <span>{content}</span>
            {shortcut && (
              <kbd className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-slate-800 text-amber-400 border border-slate-700 rounded shadow-sm">
                {shortcut}
              </kbd>
            )}
          </div>,
          document.body,
        )}
    </>
  );
};
