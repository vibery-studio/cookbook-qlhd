import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
  error?: string;
};

export function Field({ id, label, hint, error, className, ...props }: FieldProps) {
  const fieldId = id ?? props.name ?? label.toLocaleLowerCase().replaceAll(" ", "-");
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="grid gap-s2">
      <label className="text-md font-semibold leading-head text-body" htmlFor={fieldId}>
        {label}
      </label>
      <input
        {...props}
        id={fieldId}
        className={cn(
          "motion-colors min-h-[var(--row-h)] w-full rounded-r2 border border-line-strong bg-surface px-s3 text-md text-body outline-none placeholder:text-faint focus:border-accent focus:ring-3 focus:ring-accent-soft",
          error && "border-danger focus:border-danger focus:ring-danger-bg",
          className,
        )}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
