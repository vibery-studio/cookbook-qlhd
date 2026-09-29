import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

export type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function Modal({ open, title, onClose, children, footer, className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setEntered(true));
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const firstControl = panelRef.current?.querySelector<HTMLElement>("[data-autofocus], button, input, select, textarea");
    firstControl?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-strong/20 p-s4" role="presentation" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          "motion-panel flex max-h-[calc(100dvh-2*var(--spacing-s4))] w-full max-w-[var(--drawer-w)] translate-y-[var(--modal-offset)] flex-col overflow-hidden rounded-r3 border border-line bg-surface opacity-0",
          entered && "translate-y-0 opacity-100",
          className,
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-s4 border-b border-line px-s5 py-s4">
          <h2 id="modal-title" className="text-lg font-bold leading-head text-strong">
            {title}
          </h2>
          <button
            type="button"
            className="motion-colors inline-grid min-h-[var(--row-h)] min-w-[var(--row-h)] place-items-center rounded-r2 text-muted hover:bg-hover hover:text-strong"
            aria-label="Đóng"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="shell-scroll min-h-0 flex-1 overflow-y-auto px-s5 py-s5">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-s2 border-t border-line bg-sunken px-s5 py-s4">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
