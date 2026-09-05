import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
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
  delay = 80,
  shortcut,
  className = "",
  disabled = false,
}) => {
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const handleMouseEnter = () => {
    if (disabled || !content) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    setReady(false);
  };

  useLayoutEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;

    const trigger = triggerRef.current.getBoundingClientRect();
    const tip = tooltipRef.current.getBoundingClientRect();
    const offset = 6;
    const padding = 10; // Viewport edge margin

    let top = 0;
    let left = 0;

    if (placement === "bottom") {
      top = trigger.bottom + offset;
      left = trigger.left + (trigger.width - tip.width) / 2;
      // Flip to top if overflowing window bottom
      if (top + tip.height > window.innerHeight - padding && trigger.top - tip.height - offset >= padding) {
        top = trigger.top - tip.height - offset;
      }
    } else if (placement === "top") {
      top = trigger.top - tip.height - offset;
      left = trigger.left + (trigger.width - tip.width) / 2;
      // Flip to bottom if overflowing window top
      if (top < padding && trigger.bottom + offset + tip.height <= window.innerHeight - padding) {
        top = trigger.bottom + offset;
      }
    } else if (placement === "left") {
      top = trigger.top + (trigger.height - tip.height) / 2;
      left = trigger.left - tip.width - offset;
      // Flip to right if overflowing window left
      if (left < padding && trigger.right + offset + tip.width <= window.innerWidth - padding) {
        left = trigger.right + offset;
      }
    } else if (placement === "right") {
      top = trigger.top + (trigger.height - tip.height) / 2;
      left = trigger.right + offset;
      // Flip to left if overflowing window right
      if (left + tip.width > window.innerWidth - padding && trigger.left - tip.width - offset >= padding) {
        left = trigger.left - tip.width - offset;
      }
    }

    // Horizontal boundary clamp
    if (left + tip.width > window.innerWidth - padding) {
      left = window.innerWidth - tip.width - padding;
    }
    if (left < padding) {
      left = padding;
    }

    // Vertical boundary clamp
    if (top + tip.height > window.innerHeight - padding) {
      top = window.innerHeight - tip.height - padding;
    }
    if (top < padding) {
      top = padding;
    }

    setCoords({ top, left });
    setReady(true);
  }, [visible, placement]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const clonedChild = React.cloneElement(children as React.ReactElement<any>, {
    title: undefined, // Suppress native tooltip so only the rich custom Tooltip shows
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
            ref={tooltipRef}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              zIndex: 999999,
              width: "max-content",
              maxWidth: "min(300px, calc(100vw - 20px))",
              opacity: ready ? 1 : 0,
              transform: ready ? "scale(1)" : "scale(0.96)",
              transition: "opacity 100ms ease, transform 100ms ease",
              pointerEvents: "none",
            }}
            className={`select-none px-2.5 py-1.5 rounded-lg bg-slate-900/95 text-slate-100 text-[11px] leading-snug border border-slate-700/80 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md flex items-center gap-1.5 break-words whitespace-normal ${className}`}
          >
            <span>{content}</span>
            {shortcut && (
              <kbd className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-slate-800 text-amber-400 border border-slate-700 rounded shadow-sm shrink-0">
                {shortcut}
              </kbd>
            )}
          </div>,
          document.body,
        )}
    </>
  );
};
