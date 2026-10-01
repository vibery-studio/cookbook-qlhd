import { useState } from "react";
import { Link } from "react-router";
import type { Role } from "../../app/roles-query";
import { Alert, Button, Field, LockedNote } from "../../ui";
import { ConfirmDialog } from "../contracts/confirm-dialog";
import { Dialog, DialogHeader } from "../contracts/dialog";
import { asPerms, roleError, useDeleteRole, useSendChangeRequest, useUpdateRole, type RoleError } from "./api";
import { PermissionChecklist } from "./permission-checklist";
import { permissionLabel } from "./permission-labels";
import { requestDiffLabel, roleDiff } from "./role-diff";
import { RequestActions } from "./request-actions";
import { diffText, formatDayMonth, useChangeRequests, useSodPairs, violatedPairs } from "./requests";

type Meta = { label: string; description: string };

export const SYSTEM_REASON = "Vai trò hệ thống — không xóa/đổi tên";
const LOCK_TEXT = {
  admin: "Quản trị hệ thống: không đổi tên hay xóa được. Đổi quyền thì gửi yêu cầu — chỉ Giám đốc duyệt.",
  own_role: "Bạn đang mang vai trò này nên không tự sửa được. Nhờ người khác có quyền quản lý vai trò.",
  system: SYSTEM_REASON,
} as const;
export const NO_APPROVER_TEXT =
  "Không còn người nào khác có quyền Quản lý vai trò để duyệt — đổi quyền phải qua người quản trị kỹ thuật (migration).";

/** FIX-05 R2: a change to the admin role needs a Giám đốc other than the sender. */
export const ADMIN_NO_APPROVER_TEXT =
  "Đổi quyền của vai trò Quản trị hệ thống cần một Giám đốc khác bạn duyệt — hiện không có ai như vậy.";

const addNoApproverText = (label: string) =>
  `Không ai duyệt được yêu cầu thêm quyền này: người duyệt phải có quyền Quản lý vai trò, không phải bạn, và không đang mang vai trò «${label}». Bớt quyền thì vẫn gửi được; muốn thêm, cấp quyền Quản lý vai trò cho một người thứ ba trước.`;

const metaOf = (r: Role): Meta => ({ label: r.label, description: r.description ?? "" });

/**
 * SPEC-06 DEC-3 + SPEC-07 DEC-1: the 560px role drawer. Label/description save with Lưu (one PATCH); permission edits
 * are SENT as a change request that another roles:write holder approves (band + Duyệt/Từ chối/Rút while it waits).
 */
export function RoleDrawer({
  role,
  catalog,
  holds,
  onClose,
  onClone,
  onDeleted,
  onReload,
}: {
  role: Role;
  catalog: readonly string[];
  /** Does the caller hold this permission? (hint only — the API decides) */
  holds: (code: string) => boolean;
  onClose: () => void;
  onClone: (role: Role) => void;
  onDeleted: (role: Role) => void;
  onReload: () => void;
}) {
  // null = untouched: the drawer follows the server role (so a fresh version shows without a reset effect).
  const [metaEdit, setMetaEdit] = useState<Meta | null>(null);
  const [permEdit, setPermEdit] = useState<Set<string> | null>(null);
  const [error, setError] = useState<RoleError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useUpdateRole();
  const send = useSendChangeRequest();
  const remove = useDeleteRole();
  const requests = useChangeRequests(true);
  const sod = useSodPairs();

  const meta = metaEdit ?? metaOf(role);
  const perms = permEdit ?? new Set(role.permissions);
  const canEdit = role.can.edit;
  const pending = role.pending_request;
  const noApprover = role.request_locked_reason === "no_approver";
  const canEditPerms = role.can.request || noApprover;
  const isSystem = role.is_system;
  const metaDirty = meta.label.trim() !== role.label || meta.description.trim() !== (role.description ?? "");
  const { added, removed } = roleDiff(role.permissions, [...perms]);
  const permsChanged = added.length + removed.length > 0;
  const broken = violatedPairs(perms, sod.data ?? []);
  const request = pending ? (requests.data ?? []).find((r) => r.id === pending.id) : undefined;

  function changeMeta(next: Partial<Meta>) {
    setMetaEdit({ ...meta, ...next });
    setError(null);
    setNotice(null);
  }

  function toggle(code: string) {
    const next = new Set(perms);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setPermEdit(next);
    setError(null);
    setNotice(null);
  }

  async function save() {
    if (update.isPending || !metaDirty) return;
    const label = meta.label.trim();
    if (!isSystem && (label === "" || label.length > 60)) {
      setError({ slug: "validation", message: "Tên vai trò từ 1 đến 60 ký tự.", fieldErrors: { label: "Tên vai trò từ 1 đến 60 ký tự" } });
      return;
    }
    try {
      await update.mutateAsync({
        id: role.id,
        body: {
          expected_version: role.version,
          ...(!isSystem && label !== role.label ? { label } : {}),
          ...(meta.description.trim() !== (role.description ?? "") ? { description: meta.description.trim() } : {}),
        },
      });
      setMetaEdit(null);
      setError(null);
      setNotice("Đã lưu.");
    } catch (e) {
      setNotice(null);
      setError(roleError(e));
    }
  }

  async function sendRequest() {
    if (send.isPending || !permsChanged || broken.length > 0 || !role.can.request) return;
    try {
      await send.mutateAsync({ id: role.id, body: { expected_version: role.version, permissions: asPerms([...perms].sort()) } });
      setPermEdit(null);
      setError(null);
      setNotice(null);
    } catch (e) {
      setNotice(null);
      const err = roleError(e);
      // FIX-04: adding permissions needs a third approver (own_role rule) — say so instead of the generic "no one left".
      // FIX-05: the admin role's approver is a Giám đốc; giam_doc's own holders approve additions to it.
      setError(
        err.slug === "no-eligible-approver" && role.name === "admin"
          ? { ...err, message: ADMIN_NO_APPROVER_TEXT }
          : err.slug === "no-eligible-approver" && added.length > 0
            ? { ...err, message: addNoApproverText(role.label) }
            : err,
      );
    }
  }

  async function doDelete() {
    try {
      await remove.mutateAsync({ id: role.id, expectedVersion: role.version });
      setConfirmDelete(false);
      onDeleted(role);
    } catch (e) {
      setConfirmDelete(false);
      setError(roleError(e));
    }
  }

  const deleteReason = role.locked_reason ? LOCK_TEXT[role.locked_reason] : null;
  const sendLabel = requestDiffLabel(role.permissions, [...perms]);

  return (
    <>
      <Dialog label={`Vai trò · ${role.label}`} variant="drawer" onClose={onClose} testId="role-drawer">
        <DialogHeader
          eyebrow="Vai trò"
          onClose={onClose}
          title={<h2 className="text-xl font-bold leading-head text-strong text-wrap-pretty">{role.label}</h2>}
          right={<p className="text-md text-muted">{role.holders} người đang mang</p>}
        />
        <div className="shell-scroll grid min-h-0 flex-1 content-start gap-s5 overflow-y-auto px-s5 py-s5">
          {role.locked_reason ? <LockedNote>{LOCK_TEXT[role.locked_reason]}</LockedNote> : null}

          {pending ? (
            <div data-testid="pending-band" className="grid gap-s3 border border-st-pending bg-st-pending-bg px-s4 py-s3">
              <p className="text-md font-semibold text-st-pending text-wrap-pretty">
                Đang chờ duyệt: {diffText(pending.added, pending.removed)} — do «{pending.requested_by_name ?? "người dùng đã xóa"}» gửi, hết hạn{" "}
                {formatDayMonth(pending.expires_at)}
              </p>
              {pending.added.length + pending.removed.length > 0 ? (
                <ul className="grid gap-[2px] text-md text-body">
                  {pending.added.map((c) => (
                    <li key={`+${c}`}>+ {permissionLabel(c)}</li>
                  ))}
                  {pending.removed.map((c) => (
                    <li key={`-${c}`}>− {permissionLabel(c)}</li>
                  ))}
                </ul>
              ) : null}
              {request ? <RequestActions request={request} onError={setError} /> : null}
            </div>
          ) : null}

          {noApprover ? <LockedNote>{role.name === "admin" ? ADMIN_NO_APPROVER_TEXT : NO_APPROVER_TEXT}</LockedNote> : null}

          <div className="grid gap-s4">
            <Field
              id="role-label"
              label="Tên vai trò"
              name="label"
              value={meta.label}
              maxLength={60}
              autoComplete="off"
              disabled={!canEdit || isSystem}
              onChange={(e) => changeMeta({ label: e.target.value })}
              {...(error?.fieldErrors["label"] ? { error: error.fieldErrors["label"] } : {})}
            />
            <Field
              id="role-description"
              label="Mô tả"
              name="description"
              value={meta.description}
              maxLength={200}
              autoComplete="off"
              disabled={!canEdit}
              onChange={(e) => changeMeta({ description: e.target.value })}
            />
          </div>

          <div className="grid gap-s2">
            {pending ? <p className="text-sm text-muted">🔒 Đang có yêu cầu chờ duyệt</p> : null}
            <PermissionChecklist
              catalog={catalog}
              selected={perms}
              lockedAll={!canEditPerms}
              cannotGrant={(code) => !holds(code) && !role.permissions.includes(code)}
              onToggle={toggle}
            />
            {broken.map(([a, b]) => (
              <p key={`${a}|${b}`} className="text-sm text-danger">
                «{permissionLabel(a)}» xung đột với «{permissionLabel(b)}» — bỏ một trong hai
              </p>
            ))}
          </div>

        </div>

        <div data-testid="role-drawer-footer" className="grid gap-s2 border-t border-line bg-sunken px-s5 py-s4">
          {error ? (
            <Alert tone="danger">
              <p>
                {error.slug === "role-in-use" ? (
                  <>
                    Còn {error.holders ?? role.holders} người mang vai trò này — đổi vai trò họ ở màn{" "}
                    <Link to="/nguoi-dung" className="font-semibold underline">
                      Người dùng
                    </Link>{" "}
                    trước.
                  </>
                ) : (
                  error.message
                )}
                {error.slug === "stale" ? (
                  <>
                    {" "}
                    <button type="button" className="font-semibold underline" onClick={() => { onReload(); setError(null); }}>
                      Tải bản mới
                    </button>
                  </>
                ) : null}
              </p>
              {error.requestId ? <p className="font-mono text-sm">Mã yêu cầu: {error.requestId}</p> : null}
            </Alert>
          ) : null}
          {notice ? (
            <p role="status" className="text-md text-ok">
              {notice}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-s2">
            <Button
              type="button"
              variant="danger"
              disabled={!role.can.delete || remove.isPending}
              title={!role.can.delete && deleteReason ? deleteReason : undefined}
              onClick={() => { setError(null); setConfirmDelete(true); }}
            >
              Xóa
            </Button>
            <Button type="button" variant="secondary" onClick={() => onClone(role)}>
              Clone
            </Button>
            {canEdit ? (
              <Button type="button" variant={canEditPerms ? "secondary" : "primary"} loading={update.isPending} disabled={!metaDirty} onClick={() => void save()}>
                Lưu
              </Button>
            ) : null}
            {canEditPerms ? (
              <Button
                type="button"
                loading={send.isPending}
                disabled={!role.can.request || !permsChanged || broken.length > 0}
                onClick={() => void sendRequest()}
              >
                {noApprover ? `🔒 ${sendLabel}` : sendLabel}
              </Button>
            ) : null}
          </div>
          {!role.can.delete && deleteReason && canEdit ? <p className="text-right text-sm text-muted">🔒 Xóa: {deleteReason}</p> : null}
        </div>
      </Dialog>
      {confirmDelete ? (
        <ConfirmDialog
          spec={{ message: `Xóa vai trò «${role.label}»? Không khôi phục được.`, danger: true }}
          pending={remove.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void doDelete()}
        />
      ) : null}
    </>
  );
}
