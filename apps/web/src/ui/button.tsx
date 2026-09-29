import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent text-surface hover:opacity-90 active:opacity-75",
  secondary: "border border-line-strong bg-surface text-body hover:bg-hover active:bg-active",
  ghost: "bg-transparent text-muted hover:bg-hover hover:text-strong active:bg-active",
  danger: "border border-danger-border bg-surface text-danger hover:bg-danger-bg active:bg-danger-bg",
};

export function Button({ className, variant = "primary", loading = false, disabled, children, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "motion-colors inline-flex min-h-[var(--row-h)] items-center justify-center gap-s2 rounded-r2 px-s4 text-md font-semibold leading-head focus-visible:outline-accent-soft disabled:opacity-50",
        variantClasses[variant],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? "Đang xử lý…" : children}
    </button>
  );
}
