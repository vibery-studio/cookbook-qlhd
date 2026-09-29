import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type PillTone = "accent" | "neutral" | "success" | "danger" | "pending" | "approved" | "issued";

export function Pill({ tone = "neutral", children, className }: { tone?: PillTone; children: ReactNode; className?: string }) {
  const tones: Record<PillTone, string> = {
    accent: "border-accent-border bg-accent-soft text-accent",
    neutral: "bg-sunken text-muted",
    success: "border-ok-border bg-ok-bg text-ok",
    danger: "border-danger-border bg-danger-bg text-danger",
    pending: "bg-st-pending-bg text-st-pending",
    approved: "bg-st-approved-bg text-st-approved",
    issued: "bg-st-issued-bg text-st-issued",
  };

  return (
    <span className={cn("inline-flex items-center gap-s1 rounded-full border border-transparent px-s3 py-s1 text-sm font-medium leading-head", tones[tone], className)}>
      {children}
    </span>
  );
}
