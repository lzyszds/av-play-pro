import React, { forwardRef } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "danger-subtle"
  | "subtle"
  | "accent";

export type ButtonSize =
  | "xs"
  | "sm"
  | "md"
  | "lg"
  | "icon-xs"
  | "icon-sm"
  | "icon-md"
  | "icon-lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pill?: boolean;
  active?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold border border-amber-500/40 shadow-sm shadow-amber-500/20 active:scale-[0.98]",
  secondary:
    "bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 font-semibold shadow-2xs active:scale-[0.98]",
  outline:
    "bg-transparent hover:bg-slate-100/80 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 font-semibold active:scale-[0.98]",
  ghost:
    "bg-transparent hover:bg-slate-100/80 dark:hover:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-semibold active:scale-[0.98]",
  danger:
    "bg-rose-500 hover:bg-rose-600 text-white font-bold border border-rose-600/30 shadow-sm shadow-rose-500/20 active:scale-[0.98]",
  "danger-subtle":
    "bg-rose-50 hover:bg-rose-100/80 dark:bg-rose-950/30 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 border border-rose-200/80 dark:border-rose-900/50 font-semibold active:scale-[0.98]",
  subtle:
    "bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/25 font-semibold active:scale-[0.98]",
  accent:
    "bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border border-amber-500/35 font-bold active:scale-[0.98]",
};

const activeVariantStyles: Partial<Record<ButtonVariant, string>> = {
  secondary:
    "bg-amber-50 dark:bg-amber-950/30 border-amber-500/60 text-amber-600 dark:text-amber-400 shadow-xs",
  outline:
    "bg-amber-50 dark:bg-amber-950/30 border-amber-500/60 text-amber-600 dark:text-amber-400",
  ghost:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold",
};

const sizeStyles: Record<ButtonSize, string> = {
  xs: "h-6.5 px-2 text-[11px] rounded-lg gap-1",
  sm: "h-7.5 px-2.5 text-xs rounded-lg gap-1.5",
  md: "h-9 px-3.5 text-xs rounded-xl gap-2",
  lg: "h-10 px-4 text-sm rounded-xl gap-2",
  "icon-xs": "w-6.5 h-6.5 p-0 rounded-lg justify-center",
  "icon-sm": "w-7.5 h-7.5 p-0 rounded-lg justify-center",
  "icon-md": "w-9 h-9 p-0 rounded-xl justify-center",
  "icon-lg": "w-10 h-10 p-0 rounded-xl justify-center",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "secondary",
      size = "md",
      pill = false,
      active = false,
      loading = false,
      icon,
      iconRight,
      className = "",
      disabled,
      children,
      type = "button",
      ...props
    },
    ref
  ) => {
    const isIconOnly =
      size.startsWith("icon-") || (!children && (icon || iconRight));
    const effectiveVariantStyle =
      active && activeVariantStyles[variant]
        ? activeVariantStyles[variant]
        : variantStyles[variant];

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center select-none transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${
          pill ? "rounded-full" : ""
        } ${sizeStyles[size]} ${effectiveVariantStyle} ${className}`}
        {...props}
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        ) : (
          icon && <span className="shrink-0 flex items-center">{icon}</span>
        )}
        {children && <span className="truncate">{children}</span>}
        {!loading && iconRight && (
          <span className="shrink-0 flex items-center">{iconRight}</span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";

export interface IconButtonProps
  extends Omit<ButtonProps, "size" | "icon" | "iconRight"> {
  size?: "xs" | "sm" | "md" | "lg";
  icon: React.ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = "md", icon, ...props }, ref) => {
    const iconSize = `icon-${size}` as ButtonSize;
    return <Button ref={ref} size={iconSize} icon={icon} {...props} />;
  }
);

IconButton.displayName = "IconButton";

export function ButtonGroup({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-center p-1 bg-slate-200/60 dark:bg-slate-900/80 rounded-xl border border-slate-200/50 dark:border-slate-800 gap-1 ${className}`}
    >
      {children}
    </div>
  );
}
