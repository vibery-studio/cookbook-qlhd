import { useRef, useState } from "react";
import { Button } from "../../ui";
import type { ActivationLink } from "./api";

const expiryFormat = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Shown once; the link lives only in this component's props (memory). */
export function LinkBox({ link, name }: { link: ActivationLink; name: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopy("done");
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      setCopy("failed");
    }
  }

  return (
    <div className="grid gap-s3" data-testid="activation-box">
      <p className="text-md text-body">
        Link kích hoạt cho <strong className="text-strong">{name}</strong>. Link chỉ hiện một lần — đóng hộp này là mất link (dùng “Tạo lại link” nếu cần).
      </p>
      <input
        ref={inputRef}
        readOnly
        aria-label="Link kích hoạt"
        data-testid="activation-url"
        value={link.url}
        onFocus={(event) => event.currentTarget.select()}
        className="min-h-[var(--row-h)] w-full rounded-r2 border border-line-strong bg-sunken px-s3 font-mono text-sm text-body outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft"
      />
      <div className="flex flex-wrap items-center gap-s3">
        <Button onClick={() => void copyLink()}>{copy === "done" ? "Đã sao chép" : "Sao chép"}</Button>
        <span className="text-sm text-muted">Hết hạn: {expiryFormat.format(new Date(link.expiresAt * 1000))}</span>
      </div>
      {copy === "failed" ? <p className="text-sm text-danger" role="alert">Không sao chép được — link đã được chọn sẵn, bấm Ctrl+C (⌘C).</p> : null}
      <p className="text-sm text-muted">Gửi link này cho người dùng qua Zalo. Họ mở link để đặt mật khẩu và đăng nhập.</p>
    </div>
  );
}
