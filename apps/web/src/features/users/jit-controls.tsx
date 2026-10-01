import { useState } from "react";
import { Alert, Button, Field, Modal, Pill } from "../../ui";
import { errorText, type AdminUser } from "./api";
import { useGrantJit, useNow, useRevokeJit } from "./jit-api";
import { expiryText, GRANT_DURATIONS, remainingText, validReason } from "./jit-rules";
import { JIT_LOCK_TEXT } from "./role-locks";

const selectClass =
  "min-h-[var(--row-h)] w-full rounded-r2 border border-line-strong bg-surface px-s3 text-md text-body outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft";

function nameOf(user: AdminUser): string {
  return user.display_name?.trim() || user.email;
}

/**
 * The JIT part of a Người dùng row, straight from the API (FIX-06): active grant the caller may end → chip + Thu hồi ngay ·
 * may grant → button · else the API's 🔒 reason · nothing when the API offers nothing (no jit:grant).
 */
export function JitControls({ user, onGrant }: { user: AdminUser; onGrant: (user: AdminUser) => void }) {
  const revoke = useRevokeJit();
  const now = useNow();
  const [error, setError] = useState<string | null>(null);

  const grant = user.jit_grant;
  if (grant !== null && user.can.revoke_jit) {
    const id = grant.id;
    const onRevoke = async () => {
      setError(null);
      try {
        await revoke.mutateAsync({ id });
      } catch (e) {
        setError(errorText(e));
      }
    };
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
  if (user.can.grant_jit) {
    return (
      <Button variant="secondary" onClick={() => onGrant(user)}>
        Cấp quản trị tạm thời
      </Button>
    );
  }
  const reason = user.locked_reason.grant_jit;
  return reason ? <p className="text-sm text-muted">🔒 {JIT_LOCK_TEXT[reason]}</p> : null;
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
