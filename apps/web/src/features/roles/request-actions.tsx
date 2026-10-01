import { useState } from "react";
import { Button } from "../../ui";
import { ConfirmDialog } from "../contracts/confirm-dialog";
import { roleError, useApproveRequest, useRejectRequest, useWithdrawRequest, type RoleError } from "./api";
import type { ChangeRequest } from "./requests";

const LOCK_TEXT = {
  self_approve: "Bạn gửi yêu cầu này — cần người khác duyệt",
  jit_actor: "Bạn đang có quyền quản trị tạm thời nên không duyệt được",
  owner_only: "Chỉ Giám đốc duyệt đổi quyền của vai trò Quản trị hệ thống",
  own_role: "Bạn đang mang vai trò này nên không tự duyệt được",
} as const;

/** Duyệt · Từ chối (asks a reason) · Rút yêu cầu, by the request's `can`; a 🔒 line says why the others are missing. */
export function RequestActions({ request, onError }: { request: ChangeRequest; onError: (error: RoleError | null) => void }) {
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const withdraw = useWithdrawRequest();
  const [rejecting, setRejecting] = useState(false);
  if (request.status !== "pending") return null;
  const { can } = request;
  const busy = approve.isPending || reject.isPending || withdraw.isPending;
  const lock = !can.approve && request.locked_reason ? LOCK_TEXT[request.locked_reason] : null;

  async function run(action: () => Promise<unknown>) {
    onError(null);
    try {
      await action();
    } catch (e) {
      onError(roleError(e));
    }
  }

  return (
    <div className="grid justify-items-start gap-s2">
      {lock ? <p className="text-sm text-muted">🔒 {lock}</p> : null}
      <div className="flex flex-wrap gap-s2">
        {can.approve ? (
          <Button type="button" disabled={busy} loading={approve.isPending} onClick={() => void run(() => approve.mutateAsync({ id: request.id }))}>
            Duyệt
          </Button>
        ) : null}
        {can.reject ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>
            Từ chối
          </Button>
        ) : null}
        {can.withdraw ? (
          <Button type="button" variant="secondary" disabled={busy} loading={withdraw.isPending} onClick={() => void run(() => withdraw.mutateAsync({ id: request.id }))}>
            Rút yêu cầu
          </Button>
        ) : null}
      </div>
      {rejecting ? (
        <ConfirmDialog
          spec={{ message: `Từ chối yêu cầu đổi quyền của «${request.role_label}»?`, askReason: true, reasonRequired: true, danger: true }}
          pending={reject.isPending}
          onCancel={() => setRejecting(false)}
          onConfirm={(note) => {
            void run(() => reject.mutateAsync({ id: request.id, note })).then(() => setRejecting(false));
          }}
        />
      ) : null}
    </div>
  );
}
