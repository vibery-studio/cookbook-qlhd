import { useState } from "react";
import { Link } from "react-router";
import type { Role } from "../../app/roles-query";
import { Alert, Button, Field, LockedNote } from "../../ui";
import { ConfirmDialog } from "../contracts/confirm-dialog";
import { Dialog, DialogHeader } from "../contracts/dialog";
import { asPerms, roleError, useDeleteRole, useUpdateRole, type RoleError } from "./api";
import { PermissionChecklist } from "./permission-checklist";
import { roleDiffLabel } from "./role-diff";

type Edits = { label: string; description: string; permissions: Set<string> };

export const SYSTEM_REASON = "Vai trò hệ thống — không xóa/đổi tên";
const LOCK_TEXT = {
  admin: "Quản trị hệ thống luôn đủ quyền — không sửa hay xóa được.",
  own_role: "Bạn đang mang vai trò này nên không tự sửa được. Nhờ người khác có quyền quản lý vai trò.",
  system: SYSTEM_REASON,
} as const;

const fromRole = (r: Role): Edits => ({ label: r.label, description: r.description ?? "", permissions: new Set(r.permissions) });

/** SPEC-06 DEC-3: the 560px role drawer. Edits are local until Lưu (one PATCH, one CAS, one audit line). */
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
  const [edits, setEdits] = useState<Edits | null>(null);
  const [error, setError] = useState<RoleError | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useUpdateRole();
  const remove = useDeleteRole();

  const value = edits ?? fromRole(role);
  const canEdit = role.can.edit;
  const isSystem = role.is_system;
  const permsChanged = value.permissions.size !== role.permissions.length || role.permissions.some((c) => !value.permissions.has(c));
  const dirty = permsChanged || value.label.trim() !== role.label || value.description.trim() !== (role.description ?? "");
  const saveLabel = roleDiffLabel(role.permissions, [...value.permissions]);

  function change(next: Partial<Edits>) {
    setEdits({ ...value, ...next });
    setError(null);
    setSaved(false);
  }

  function toggle(code: string) {
    const next = new Set(value.permissions);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    change({ permissions: next });
  }

  async function save() {
    if (update.isPending || !dirty) return;
    const label = value.label.trim();
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
          ...(value.description.trim() !== (role.description ?? "") ? { description: value.description.trim() } : {}),
          ...(permsChanged ? { permissions: asPerms([...value.permissions]) } : {}),
        },
      });
      setEdits(null);
      setError(null);
      setSaved(true);
    } catch (e) {
      setSaved(false);
      setError(roleError(e));
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

          <div className="grid gap-s4">
            <Field
              id="role-label"
              label="Tên vai trò"
              name="label"
              value={value.label}
              maxLength={60}
              autoComplete="off"
              disabled={!canEdit || isSystem}
              onChange={(e) => change({ label: e.target.value })}
              {...(error?.fieldErrors["label"] ? { error: error.fieldErrors["label"] } : {})}
            />
            <Field
              id="role-description"
              label="Mô tả"
              name="description"
              value={value.description}
              maxLength={200}
              autoComplete="off"
              disabled={!canEdit}
              onChange={(e) => change({ description: e.target.value })}
            />
          </div>

          <PermissionChecklist
            catalog={catalog}
            selected={value.permissions}
            lockedAll={!canEdit}
            cannotGrant={(code) => !holds(code) && !role.permissions.includes(code)}
            onToggle={toggle}
          />

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
          {saved ? (
            <p role="status" className="text-md text-ok">
              Đã lưu.
            </p>
          ) : null}
        </div>

        <div className="grid gap-s2 border-t border-line bg-sunken px-s5 py-s4">
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
              <Button type="button" loading={update.isPending} disabled={!dirty} onClick={() => void save()}>
                {saveLabel}
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
