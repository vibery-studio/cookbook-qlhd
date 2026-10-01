import { useState } from "react";
import { Alert, Button, Field, Modal, Pill } from "../../ui";
import { errorText, type AdminUser } from "./api";
import { useGrantJit, useNow, useRevokeJit } from "./jit-api";
import { expiryText, GRANT_DURATIONS, remainingText, validReason, type JitRowAction } from "./jit-rules";

const selectClass =
  "min-h-[var(--row-h)] w-full rounded-r2 border border-line-strong bg-surface px-s3 text-md text-body outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft";

function nameOf(user: AdminUser): string {
  return user.display_name?.trim() || user.email;
}

/** The JIT part of a Người dùng row: grant button · active chip + Thu hồi ngay · 🔒 reason. */
export function JitControls({ user, action, onGrant }: { user: AdminUser; action: JitRowAction; onGrant: (user: AdminUser) => void }) {
  const revoke = useRevokeJit();
  const now = useNow();
  const [error, setError] = useState<string | null>(null);

  if (action.kind === "locked") return <p className="text-sm text-muted">🔒 {action.reason}</p>;
  if (action.kind === "grant") {
    return (
      <Button variant="secondary" onClick={() => onGrant(user)}>
        Cấp quản trị tạm thời
      </Button>
    );
  }
  const grant = action.grant;
  async function onRevoke() {
    setError(null);
    try {
      await revoke.mutateAsync({ id: grant.id });
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <div className="grid justify-items-start gap-s2">
      <div className="flex flex-wrap items-center gap-s2">
        <Pill tone="pending">Quản trị tạm · {remainingText(grant.expires_at, now)}</Pill>
        <Button variant="danger" loading={revoke.isPending} onClick={() => void onRevoke()}>
          Thu hồi ngay
        </Button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

export function GrantJitDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const grant = useGrantJit();
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [key] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const now = useNow(15_000);
  const valid = validReason(reason);

  async function submit() {
    setError(null);
    try {
      await grant.mutateAsync({ user_id: user.id, reason: reason.trim(), minutes, key });
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Modal
      open
      title={`Cấp quản trị tạm thời · ${nameOf(user)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button loading={grant.isPending} disabled={!valid} onClick={() => void submit()}>Cấp quyền</Button>
        </>
      }
    >
      <form
        className="grid gap-s4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !grant.isPending) void submit();
        }}
      >
        <Field
          label="Lý do"
          name="reason"
          autoComplete="off"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          hint="Không ghi thông tin cá nhân. Từ 10 ký tự."
          data-autofocus
        />
        <div className="grid gap-s2">
          <label htmlFor="jit-minutes" className="text-md font-semibold leading-head text-body">Thời hạn</label>
          <select id="jit-minutes" className={selectClass} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {GRANT_DURATIONS.map((d) => (
              <option key={d.minutes} value={d.minutes}>{d.label}</option>
            ))}
          </select>
          <p className="text-sm text-muted">{expiryText(minutes, now)}</p>
        </div>
        <p className="text-sm text-muted">Trong thời hạn, người này chỉ có quyền quản trị — không còn quyền hợp đồng của vai trò cũ.</p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </form>
    </Modal>
  );
}
