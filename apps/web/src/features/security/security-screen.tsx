import { useState } from "react";
import { Alert, Button, ErrorState, Field, Skeleton } from "../../ui";
import { cn } from "../../lib/cn";
import { ApiProblemError } from "../../lib/client";
import { problemMessage } from "../../lib/problem-messages";
import { ConfirmDialog } from "../contracts/confirm-dialog";
import { useSetTwoLayer, useTwoLayer } from "./api";

const REASON_MIN = 10;
const REASON_MAX = 500;

const dateTime = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** C-11-001 — màn "Bảo mật" (Root admin): bật/tắt cơ chế duyệt 2 lớp khi đổi quyền, lý do bắt buộc, có hộp xác nhận. */
export function SecurityScreen() {
  const query = useTwoLayer();
  const save = useSetTwoLayer();
  const [choice, setChoice] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (query.isPending) return <Skeleton className="h-[180px] w-full" />;
  if (query.isError || !query.data) {
    return <ErrorState message="Không tải được cài đặt bảo mật. Thử lại sau." onRetry={() => void query.refetch()} />;
  }

  const current = query.data.enabled;
  const next = choice ?? current;
  const dirty = next !== current;

  function pick(value: boolean) {
    setChoice(value);
    setError(null);
    setNotice(null);
  }

  function ask() {
    const r = reason.trim();
    if (r.length < REASON_MIN || r.length > REASON_MAX) {
      setReasonError(`Lý do từ ${REASON_MIN} đến ${REASON_MAX} ký tự.`);
      return;
    }
    setReasonError(undefined);
    setConfirm(true);
  }

  async function apply() {
    try {
      await save.mutateAsync({ enabled: next, reason: reason.trim() });
      setConfirm(false);
      setChoice(null);
      setReason("");
      setNotice(next ? "Đã bật cơ chế duyệt 2 lớp." : "Đã tắt cơ chế duyệt 2 lớp — thay đổi quyền có hiệu lực ngay.");
    } catch (e) {
      setConfirm(false);
      setError(e instanceof ApiProblemError ? problemMessage(e.problem).message : "Hệ thống đang bận, thử lại sau.");
    }
  }

  const option = (value: boolean, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={next === value}
      onClick={() => pick(value)}
      className={cn(
        "motion-colors min-h-[var(--row-h)] min-w-[88px] border px-s3 text-md font-semibold",
        next === value ? "border-accent bg-accent text-surface" : "border-line-strong bg-surface text-body hover:bg-hover",
      )}
    >
      {label}
    </button>
  );

  return (
    <section className="grid max-w-[720px] gap-s4">
      <h1 className="text-2xl font-bold leading-head text-strong">Bảo mật</h1>
      {notice ? (
        <div role="status">
          <Alert tone="success">{notice}</Alert>
        </div>
      ) : null}
      <div className="grid gap-s4 rounded-r3 border border-line bg-surface p-s5">
        <div className="flex flex-wrap items-center justify-between gap-s3">
          <p id="two-layer-label" className="text-md font-semibold text-strong">
            Cơ chế duyệt 2 lớp khi đổi quyền
          </p>
          <div role="radiogroup" aria-labelledby="two-layer-label" className="flex">
            {option(true, "Bật")}
            {option(false, "Tắt")}
          </div>
        </div>
        <p className="text-md text-muted text-wrap-pretty">
          Bật: đổi quyền của một vai trò phải gửi yêu cầu và người khác duyệt. Tắt: Quản trị hệ thống và Giám đốc đổi quyền
          trực tiếp, có hiệu lực ngay (vẫn ghi nhật ký). Gán vai trò cho người dùng không đổi.
        </p>
        {query.data.updated_at !== null ? (
          <p className="text-sm text-muted">
            Đổi lần cuối {dateTime.format(new Date(query.data.updated_at * 1000))}
            {query.data.updated_by_name ? ` — «${query.data.updated_by_name}»` : ""}
          </p>
        ) : null}
        {dirty ? (
          <div className="grid gap-s3">
            <Field
              id="two-layer-reason"
              label="Lý do (bắt buộc)"
              name="reason"
              value={reason}
              maxLength={REASON_MAX}
              autoComplete="off"
              onChange={(e) => setReason(e.target.value)}
              {...(reasonError ? { error: reasonError } : {})}
            />
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <div className="flex justify-end gap-s2">
              <Button type="button" variant="secondary" onClick={() => pick(current)}>
                Hủy
              </Button>
              <Button type="button" loading={save.isPending} onClick={ask}>
                {next ? "Bật" : "Tắt"} cơ chế duyệt 2 lớp
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      {confirm ? (
        <ConfirmDialog
          spec={{
            message: next
              ? "Bật lại cơ chế duyệt 2 lớp? Từ giờ đổi quyền phải gửi yêu cầu để người khác duyệt."
              : "Tắt cơ chế duyệt 2 lớp? Quản trị hệ thống và Giám đốc sẽ đổi quyền vai trò có hiệu lực ngay, không cần người thứ hai duyệt.",
            danger: !next,
            confirmLabel: next ? "Bật" : "Tắt",
          }}
          pending={save.isPending}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void apply()}
        />
      ) : null}
    </section>
  );
}
