import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("rounded-r1 bg-sunken", className)} />;
}

export function EmptyState({ title, action, className }: { title: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid justify-items-center gap-s3 border border-dashed border-line-strong bg-surface px-s5 py-s7 text-center", className)}>
      <p className="text-md text-muted text-wrap-pretty">{title}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn("grid gap-s3 border border-danger-border bg-danger-bg px-s5 py-s5", className)} role="alert">
      <p className="text-md text-danger text-wrap-pretty">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry} className="justify-self-start">
          Thử lại
        </Button>
      ) : null}
    </div>
  );
}

export function LockedNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-s3 border border-danger-border bg-st-rejected-bg px-s4 py-s3 text-danger" role="note">
      <span aria-hidden="true" className="text-lg leading-head">
        🔒
      </span>
      <p className="text-md text-wrap-pretty">{children}</p>
    </div>
  );
}
