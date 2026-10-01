import { useState } from "react";
import { Alert, Button, Field } from "../../ui";
import { useIdempotencyKeeper } from "../../lib/idempotency-key";
import type { Role } from "../../app/roles-query";
import { Dialog, DialogHeader } from "../contracts/dialog";
import { asPerms, roleError, useCreateRole, type RoleError } from "./api";
import { PermissionChecklist } from "./permission-checklist";
import { permissionLabel } from "./permission-labels";

export type RoleSeed = { label: string; description: string; permissions: readonly string[]; droppedNote?: string };

/** "Thêm vai trò" — also the clone form (DEC-6: prefilled client-side, same POST /roles). */
export function RoleFormModal({
  seed,
  catalog,
  holds,
  onClose,
  onCreated,
}: {
  seed: RoleSeed;
  catalog: readonly string[];
  holds: (code: string) => boolean;
  onClose: () => void;
  onCreated: (role: Role) => void;
}) {
  const [label, setLabel] = useState(seed.label);
  const [description, setDescription] = useState(seed.description);
  const [perms, setPerms] = useState<Set<string>>(() => new Set(seed.permissions));
  const [error, setError] = useState<RoleError | null>(null);
  const create = useCreateRole();
  const keeper = useIdempotencyKeeper();

  function toggle(code: string) {
    const next = new Set(perms);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setPerms(next);
    setError(null);
  }

  async function submit() {
    if (create.isPending) return;
    const name = label.trim();
    if (name === "" || name.length > 60) {
      setError({ slug: "validation", message: "", fieldErrors: { label: "Tên vai trò từ 1 đến 60 ký tự" } });
      return;
    }
    const body = {
      label: name,
      ...(description.trim() !== "" ? { description: description.trim() } : {}),
      permissions: asPerms([...perms].sort()),
    };
    try {
      // same content → same Idempotency-Key on retry; edited content → a new one
      const role = await create.mutateAsync({ body, idempotencyKey: keeper.keyFor(JSON.stringify(body)) });
      onCreated(role);
    } catch (e) {
      setError(roleError(e));
    }
  }

  const fieldError = error?.fieldErrors["label"] ?? (error?.slug === "duplicate" ? error.message : undefined);

  return (
    <Dialog label="Thêm vai trò" variant="modal" onClose={onClose}>
      <DialogHeader title="Thêm vai trò" onClose={onClose} />
      <form
        className="shell-scroll grid min-h-0 flex-1 content-start gap-s5 overflow-y-auto px-s5 py-s5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-s4">
          <Field
            id="new-role-label"
            label="Tên vai trò"
            name="label"
            value={label}
            maxLength={60}
            autoComplete="off"
            data-autofocus
            onChange={(e) => {
              setLabel(e.target.value);
              setError(null);
            }}
            {...(fieldError ? { error: fieldError } : {})}
          />
          <Field id="new-role-description" label="Mô tả" name="description" value={description} maxLength={200} autoComplete="off" onChange={(e) => setDescription(e.target.value)} />
        </div>
        {seed.droppedNote ? <p className="text-sm text-muted text-wrap-pretty">🔒 {seed.droppedNote}</p> : null}
        <PermissionChecklist catalog={catalog} selected={perms} lockedAll={false} cannotGrant={(code) => !holds(code)} onToggle={toggle} />
        {error && error.slug !== "duplicate" && Object.keys(error.fieldErrors).length === 0 && error.message ? (
          <Alert tone="danger">
            <p>{error.message}</p>
            {error.requestId ? <p className="font-mono text-sm">Mã yêu cầu: {error.requestId}</p> : null}
          </Alert>
        ) : null}
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
      <div className="flex flex-wrap justify-end gap-s2 border-t border-line bg-sunken px-s5 py-s4">
        <Button type="button" variant="ghost" onClick={onClose}>
          Hủy
        </Button>
        <Button type="button" loading={create.isPending} onClick={() => void submit()}>
          Tạo vai trò
        </Button>
      </div>
    </Dialog>
  );
}

/** Seed for a clone: the source's label/permissions minus the codes the caller cannot grant (reported in `droppedNote`). */
export function cloneSeed(source: Role, holds: (code: string) => boolean): RoleSeed {
  const kept = source.permissions.filter(holds);
  const dropped = source.permissions.filter((c) => !holds(c));
  return {
    label: `Bản sao của ${source.label}`.slice(0, 60),
    description: source.description ?? "",
    permissions: kept,
    ...(dropped.length > 0 ? { droppedNote: `Đã bỏ sẵn các quyền bạn không có nên không cấp được: ${dropped.map(permissionLabel).join(", ")}.` } : {}),
  };
}
