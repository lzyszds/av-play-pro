import React from "react";

/**
 * 表单字段容器：label + 控件 + hint 的统一纵排。
 */
export interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children?: React.ReactNode;
}

export function Field({
  label,
  hint,
  htmlFor,
  className = "",
  children,
}: FieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-[11px] font-bold text-text-2"
        >
          {label}
        </label>
      )}
      {children}
      {hint && <p className="text-[10px] text-text-3 leading-relaxed">{hint}</p>}
    </div>
  );
}

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** 输入框左前缀图标 */
  leadingIcon?: React.ReactNode;
  mono?: boolean;
}

export function Input({
  leadingIcon,
  mono = false,
  className = "",
  ...props
}: InputProps) {
  return (
    <div className="relative">
      {leadingIcon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3 flex items-center">
          {leadingIcon}
        </span>
      )}
      <input
        {...props}
        className={`w-full h-9 rounded-lg border-hairline bg-surface-2 text-text-1 placeholder:text-text-3 focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/25 transition ${
          mono ? "font-mono text-[12px]" : "text-xs"
        } ${leadingIcon ? "pl-9" : "pl-3"} pr-3 ${className}`}
      />
    </div>
  );
}
