import React, { useEffect } from "react";
import { X } from "lucide-react";

/**
 * 统一弹窗壳：玻璃框 + 半透明遮罩 + Esc/点底关闭 + 体内滚动。
 * 收编各页手写弹窗外框；子内容负责自己的 form/内容。
 */
export interface ModalProps {
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  /** 弹窗宽度类，默认 "max-w-2xl" */
  maxWidth?: string;
  children?: React.ReactNode;
  className?: string;
  /** 关闭弹窗的按钮 label */
  closeAriaLabel?: string;
}

export function Modal({
  onClose,
  title,
  subtitle,
  icon,
  footer,
  maxWidth = "max-w-2xl",
  children,
  className = "",
  closeAriaLabel = "关闭",
}: ModalProps) {
  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 anim-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`glass rounded-2xl w-full ${maxWidth} overflow-hidden shadow-2xl flex flex-col max-h-[90vh] anim-scale-in ${className}`}
      >
        {(title || subtitle || icon) && (
          <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-hairline shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              {icon && (
                <div className="flex items-center justify-center shrink-0 w-10 h-10 rounded-2xl bg-accent-500/10 border border-accent-500/20 text-accent-500">
                  {icon}
                </div>
              )}
              <div className="min-w-0">
                {title && (
                  <h2 className="text-sm font-bold text-text-1 tracking-wide truncate">
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p className="text-[11px] text-text-3 mt-0.5 truncate">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={closeAriaLabel}
              className="p-1.5 rounded-lg text-text-3 hover:text-text-1 hover:bg-accent-500/10 transition cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <div className="overflow-y-auto">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-hairline shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
