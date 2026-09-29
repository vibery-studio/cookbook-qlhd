import { useRef, useState } from "react";
import { Button } from "../../ui";
import { Dialog } from "./dialog";

/**
 * The printed contract: the server's own HTML inside a sandboxed same-origin iframe (SPEC-04b 3.6).
 * No allow-scripts (server CSP is default-src 'none'), nothing from the frame is read or rewritten here.
 * "In" calls the frame's print(); if the browser refuses, the new-tab link is the fallback (DEC-4).
 */
export function PaperOverlay({ contractId, version, onClose }: { contractId: string; version: number; onClose: () => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [printFailed, setPrintFailed] = useState(false);
  const src = `/contracts/${contractId}/render`;

  function print() {
    try {
      const w = frameRef.current?.contentWindow;
      if (!w) throw new Error("no frame");
      w.focus();
      w.print();
      setPrintFailed(false);
    } catch {
      setPrintFailed(true);
    }
  }

  return (
    <Dialog label="Văn bản hợp đồng" variant="paper" onClose={onClose}>
      <div className="flex flex-wrap items-center justify-between gap-s3 border-b border-line bg-surface px-s5 py-s3 max-mobile:px-s3">
        <h2 className="text-lg font-bold leading-head text-strong">Văn bản hợp đồng</h2>
        <div className="flex flex-wrap items-center gap-s2">
          <Button type="button" variant="secondary" onClick={print}>In</Button>
          <a
            href={src}
            target="_blank"
            rel="noopener"
            className="motion-colors inline-flex min-h-[var(--row-h)] items-center rounded-r2 border border-line-strong bg-surface px-s4 text-md font-semibold text-body hover:bg-hover"
          >
            Mở ở tab mới
          </a>
          <Button type="button" variant="ghost" onClick={onClose}>Đóng</Button>
        </div>
      </div>
      {printFailed ? (
        <p className="border-b border-danger-border bg-danger-bg px-s5 py-s2 text-md text-danger" role="status">
          Trình duyệt không cho in trực tiếp — bấm «Mở ở tab mới» rồi in (Ctrl/Cmd + P).
        </p>
      ) : null}
      <iframe
        key={version}
        ref={frameRef}
        title="Văn bản hợp đồng"
        src={src}
        sandbox="allow-same-origin allow-modals"
        referrerPolicy="no-referrer"
        className="min-h-0 w-full flex-1 border-0 bg-surface"
      />
    </Dialog>
  );
}
