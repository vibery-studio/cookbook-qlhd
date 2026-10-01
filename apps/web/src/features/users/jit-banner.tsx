import { useState } from "react";
import { useCurrentUser } from "../../app/me";
import { Alert, Button } from "../../ui";
import { errorText } from "./api";
import { useEndMyJit } from "./jit-api";
import { hhmm } from "./jit-rules";

/** SPEC-07 §3.4 Người nhận JIT: shown on every screen while the caller carries temporary admin. */
export function JitBanner() {
  const me = useCurrentUser();
  const end = useEndMyJit(me.id);
  const [error, setError] = useState<string | null>(null);
  if (!me.jit) return null;

  async function onEnd() {
    setError(null);
    try {
      await end.mutateAsync();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div data-testid="jit-banner" className="grid gap-s2 border border-accent-border bg-accent-soft px-s4 py-s3">
      <div className="flex flex-wrap items-center justify-between gap-s3">
        <p className="text-md font-medium text-strong">Bạn đang có quyền quản trị tạm thời — hết hạn lúc {hhmm(me.jit.expires_at)}</p>
        <Button variant="secondary" loading={end.isPending} onClick={() => void onEnd()}>Kết thúc sớm</Button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
