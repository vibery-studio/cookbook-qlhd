import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export function Alert({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "danger" | "success" }) {
  const toneClasses = {
    info: "border-accent-border bg-accent-soft text-strong",
    danger: "border-danger-border bg-danger-bg text-danger",
    success: "border-ok-border bg-ok-bg text-ok",
  } as const;
  return (
    <div className={cn("border px-s4 py-s3 text-md text-wrap-pretty", toneClasses[tone])} role="alert">
      {children}
    </div>
  );
}

export function Toast({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "danger" | "success" }) {
  return (
    <div className="pointer-events-none fixed bottom-s5 right-s5 z-40 max-w-[var(--drawer-w)]" role="status" aria-live="polite">
      <Alert tone={tone}>{children}</Alert>
    </div>
  );
}
