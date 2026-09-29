import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { Icon } from "../../ui";

export type DialogVariant = "modal" | "drawer" | "paper";

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

/** Only the newest dialog in the document reacts to Escape / Tab (the shared ui Modal may sit on top of this one). */
function isTopmost(el: HTMLElement | null): boolean {
  const all = document.querySelectorAll('[role="dialog"]');
  return all.length > 0 && all[all.length - 1] === el;
}

/**
 * Overlay shell for the contract screens: drawer (560px, full-screen on mobile), modal and the paper overlay.
 * Named by aria-label (not by the ui Modal's fixed title id), so it can stack under the customer modal.
 * All layers share one z-index; later in the DOM = on top. The ui Modal (z-50) sits above every one of them.
 */
export function Dialog({
  label,
  variant,
  onClose,
  closeOnBackdrop = variant !== "modal",
  testId,
  children,
}: {
  label: string;
  variant: DialogVariant;
  onClose: () => void;
  closeOnBackdrop?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const panel = panelRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();

    function onKey(event: KeyboardEvent) {
      if (!isTopmost(panel)) return;
      if (event.key === "Escape") {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      data-testid={testId}
      className={cn(
        "flex flex-col bg-surface outline-none",
        variant === "drawer" && "motion-panel absolute inset-y-0 right-0 w-full max-w-[var(--drawer-w)] border-l border-line",
        variant === "modal" &&
          "relative max-h-[calc(100dvh-2*var(--spacing-s4))] w-full max-w-[var(--drawer-w)] overflow-hidden rounded-r3 border border-line max-mobile:h-full max-mobile:max-h-none max-mobile:max-w-none max-mobile:rounded-none max-mobile:border-0",
        variant === "paper" && "absolute inset-0 bg-sunken",
      )}
    >
      {children}
    </div>
  );

  return createPortal(
    <div
      className={cn("fixed inset-0 z-40", variant === "modal" && "grid place-items-center bg-strong/20 p-s4 max-mobile:p-0")}
      role="presentation"
      onMouseDown={closeOnBackdrop && variant !== "paper" ? onClose : undefined}
    >
      {variant === "drawer" ? <div className="absolute inset-0 bg-strong/20" aria-hidden="true" /> : null}
      <div className="contents" onMouseDown={(e) => e.stopPropagation()}>
        {panel}
      </div>
    </div>,
    document.body,
  );
}

/** Header row shared by drawer / modal. */
export function DialogHeader({ eyebrow, title, right, onClose }: { eyebrow?: string; title: ReactNode; right?: ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-s3 border-b border-line px-s5 py-s4">
      <div className="grid min-w-0 gap-s1">
        {eyebrow ? <p className="text-sm font-medium text-muted">{eyebrow}</p> : null}
        {typeof title === "string" ? <h2 className="text-xl font-bold leading-head text-strong text-wrap-pretty">{title}</h2> : title}
        {right}
      </div>
      <button
        type="button"
        aria-label="Đóng"
        onClick={onClose}
        className="motion-colors inline-grid min-h-[var(--row-h)] min-w-[var(--row-h)] shrink-0 place-items-center rounded-r2 text-muted hover:bg-hover hover:text-strong"
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
