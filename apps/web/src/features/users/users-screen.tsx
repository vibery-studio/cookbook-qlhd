import { useMemo, useState } from "react";
import { useCurrentUser } from "../../app/me";
import { useRoleLabelOf, useRoles } from "../../app/roles-query";
import { Alert, Button, EmptyState, ErrorState, Field, Modal, Pill, Skeleton } from "../../ui";
import type { PillTone } from "../../ui";
import { errorText, useInviteUser, useReinvite, useUpdateUser, useUsers } from "./api";
import type { ActivationLink, AdminUser } from "./api";
import { LinkBox } from "./link-box";
import {
  ADMIN_TARGET_REASON,
  adminTargetLocked,
  FALLBACK_ROLES,
  NOT_GRANTABLE_REASON,
  SELF_DISABLE_REASON,
  SELF_ROLE_REASON,
  selectableRoles,
  targetRoleLocked,
} from "./role-locks";
import type { RoleOption, SelectableRole } from "./role-locks";

const statusLabel: Record<AdminUser["status"], string> = { pending: "Chưa kích hoạt", active: "Đang hoạt động", disabled: "Đã khóa" };
const statusTone: Record<AdminUser["status"], PillTone> = { pending: "pending", active: "success", disabled: "danger" };

const selectClass =
  "min-h-[var(--row-h)] w-full rounded-r2 border border-line-strong bg-surface px-s3 text-md text-body outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft";

function nameOf(user: AdminUser): string {
  return user.display_name?.trim() || user.email;
}
function roleText(user: AdminUser, labelOf: (name: string) => string): string {
  return user.roles.map(labelOf).join(", ") || "Chưa có vai trò";
}

function RoleOptions({ options }: { options: SelectableRole[] }) {
  return (
    <>
      {options.map((r) => (
        <option key={r.name} value={r.name} disabled={r.locked !== undefined}>
          {r.locked ? `🔒 ${r.label} — ${r.locked}` : r.label}
        </option>
      ))}
    </>
  );
}

type Dialog =
  | { kind: "invite" }
  | { kind: "link"; link: ActivationLink; name: string }
  | { kind: "role"; user: AdminUser }
  | { kind: "status"; user: AdminUser };

export function UsersScreen() {
  const me = useCurrentUser();
  const canWrite = me.permissions.includes("users:write");
  const users = useUsers();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const reinvite = useReinvite();
  const [notice, setNotice] = useState<string | null>(null);

  const rolesQuery = useRoles();
  const labelOf = useRoleLabelOf();
  const roles: RoleOption[] = rolesQuery.data?.items ?? FALLBACK_ROLES;
  const callerIsAdmin = me.roles.includes("admin");
  const roleCtx = { callerIsAdmin, callerPermissions: me.permissions };

  const items = useMemo(() => users.data?.pages.flatMap((page) => page.items) ?? [], [users.data]);

  async function onReinvite(user: AdminUser) {
    setNotice(null);
    try {
      const link = await reinvite.mutateAsync(user.id);
      setDialog({ kind: "link", link, name: nameOf(user) });
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  return (
    <section className="grid gap-s5 p-s5" aria-labelledby="users-title">
      <header className="flex flex-wrap items-start justify-between gap-s3">
        <div className="grid gap-s1">
          <h1 id="users-title" className="text-xl font-bold leading-head text-strong">Người dùng</h1>
          <p className="text-md text-muted">Tài khoản, vai trò và trạng thái của đội ngũ nội bộ.</p>
        </div>
        {canWrite ? <Button onClick={() => setDialog({ kind: "invite" })}>+ Mời người dùng</Button> : null}
      </header>

      {notice ? <Alert tone="danger">{notice}</Alert> : null}

      {users.isPending ? (
        <div className="grid gap-s2" aria-busy="true" aria-label="Đang tải">
          <Skeleton className="h-[var(--row-h)]" />
          <Skeleton className="h-[var(--row-h)]" />
          <Skeleton className="h-[var(--row-h)]" />
        </div>
      ) : users.isError ? (
        <ErrorState message={errorText(users.error)} onRetry={() => void users.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="Chưa có người dùng nào." action={canWrite ? <Button onClick={() => setDialog({ kind: "invite" })}>+ Mời người dùng</Button> : undefined} />
      ) : (
        <>
          <ul className="grid gap-s3 md:hidden" data-testid="users-cards">
            {items.map((user) => (
              <li key={user.id} className="grid gap-s3 border border-line bg-surface p-s4">
                <div className="grid gap-s1">
                  <span className="text-md font-semibold text-strong">{nameOf(user)}</span>
                  <span className="break-all text-sm text-muted">{user.email}</span>
                </div>
                <div className="flex flex-wrap gap-s2">
                  <Pill tone="accent">{roleText(user, labelOf)}</Pill>
                  <Pill tone={statusTone[user.status]}>{statusLabel[user.status]}</Pill>
                </div>
                {canWrite ? <Actions user={user} isSelf={user.id === me.id} adminLocked={adminTargetLocked(user.roles, me.roles)} grantLocked={targetRoleLocked(user.roles, roles, callerIsAdmin, me.permissions)} onReinvite={(u) => void onReinvite(u)} onDialog={setDialog} busy={reinvite.isPending} /> : null}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto border border-line bg-surface md:block">
            <table className="w-full border-collapse text-left text-md" data-testid="users-table">
              <thead>
                <tr className="border-b border-line bg-sunken text-sm text-muted">
                  <th className="px-s4 py-s3 font-semibold">Tên hiển thị</th>
                  <th className="px-s4 py-s3 font-semibold">Email</th>
                  <th className="px-s4 py-s3 font-semibold">Vai trò</th>
                  <th className="px-s4 py-s3 font-semibold">Trạng thái</th>
                  {canWrite ? <th className="px-s4 py-s3 font-semibold">Thao tác</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((user) => (
                  <tr key={user.id} className="border-b border-line last:border-b-0 align-top">
                    <td className="px-s4 py-s3 font-semibold text-strong">{nameOf(user)}</td>
                    <td className="px-s4 py-s3 text-body">{user.email}</td>
                    <td className="px-s4 py-s3"><Pill tone="accent">{roleText(user, labelOf)}</Pill></td>
                    <td className="px-s4 py-s3"><Pill tone={statusTone[user.status]}>{statusLabel[user.status]}</Pill></td>
                    {canWrite ? (
                      <td className="px-s4 py-s3">
                        <Actions user={user} isSelf={user.id === me.id} adminLocked={adminTargetLocked(user.roles, me.roles)} grantLocked={targetRoleLocked(user.roles, roles, callerIsAdmin, me.permissions)} onReinvite={(u) => void onReinvite(u)} onDialog={setDialog} busy={reinvite.isPending} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {users.hasNextPage ? (
            <Button variant="secondary" className="justify-self-center" loading={users.isFetchingNextPage} onClick={() => void users.fetchNextPage()}>
              Xem thêm
            </Button>
          ) : null}
        </>
      )}

      {dialog?.kind === "invite" ? <InviteDialog roles={selectableRoles(roles, { ...roleCtx, mode: "invite" })} onClose={() => setDialog(null)} onDone={(link, name) => setDialog({ kind: "link", link, name })} /> : null}
      {dialog?.kind === "link" ? (
        <Modal open title="Link kích hoạt" onClose={() => setDialog(null)} footer={<Button onClick={() => setDialog(null)}>Đóng</Button>}>
          <LinkBox link={dialog.link} name={dialog.name} />
        </Modal>
      ) : null}
      {dialog?.kind === "role" ? <RoleDialog user={dialog.user} roles={selectableRoles(roles, { ...roleCtx, mode: "assign" })} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "status" ? <StatusDialog user={dialog.user} onClose={() => setDialog(null)} /> : null}
    </section>
  );
}

function Actions({
  user,
  isSelf,
  adminLocked,
  grantLocked,
  busy,
  onReinvite,
  onDialog,
}: {
  user: AdminUser;
  isSelf: boolean;
  adminLocked: boolean;
  grantLocked: boolean;
  busy: boolean;
  onReinvite: (user: AdminUser) => void | Promise<void>;
  onDialog: (dialog: Dialog) => void;
}) {
  const locked = (label: string, reason: string, testId: string) => (
    <Button
      variant="secondary"
      data-testid={testId}
      aria-disabled="true"
      title={reason}
      className="cursor-not-allowed opacity-60"
      onClick={(event) => event.preventDefault()}
    >
      🔒 {label}
    </Button>
  );
  return (
    <div className="grid justify-items-start gap-s2">
      <div className="flex flex-wrap gap-s2">
        {user.status === "pending" ? (
          <Button variant="secondary" disabled={busy} onClick={() => void onReinvite(user)}>Tạo lại link</Button>
        ) : null}
        {adminLocked ? (
          locked("Đổi vai trò", ADMIN_TARGET_REASON, "action-role")
        ) : isSelf ? (
          locked("Đổi vai trò", SELF_ROLE_REASON, "action-role")
        ) : grantLocked ? (
          locked("Đổi vai trò", NOT_GRANTABLE_REASON, "action-role")
        ) : (
          <Button variant="secondary" data-testid="action-role" onClick={() => onDialog({ kind: "role", user })}>
            Đổi vai trò
          </Button>
        )}
        {adminLocked ? (
          locked(user.status === "disabled" ? "Mở khóa" : "Khóa", ADMIN_TARGET_REASON, "action-status")
        ) : user.status === "disabled" ? (
          <Button variant="secondary" onClick={() => onDialog({ kind: "status", user })}>Mở khóa</Button>
        ) : isSelf ? (
          locked("Khóa", SELF_DISABLE_REASON, "action-status")
        ) : (
          <Button variant="danger" data-testid="action-status" onClick={() => onDialog({ kind: "status", user })}>
            Khóa
          </Button>
        )}
      </div>
      {adminLocked ? (
        <p className="text-sm text-muted">🔒 {ADMIN_TARGET_REASON}</p>
      ) : isSelf ? (
        <ul className="grid gap-s1 text-sm text-muted">
          <li>🔒 {SELF_ROLE_REASON}</li>
          {user.status !== "disabled" ? <li>🔒 {SELF_DISABLE_REASON}</li> : null}
        </ul>
      ) : grantLocked ? (
        <p className="text-sm text-muted">🔒 {NOT_GRANTABLE_REASON}</p>
      ) : null}
    </div>
  );
}

function InviteDialog({ roles, onClose, onDone }: { roles: SelectableRole[]; onClose: () => void; onDone: (link: ActivationLink, name: string) => void }) {
  const invite = useInviteUser();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState(() => (roles.find((r) => r.name === "nhan_vien" && !r.locked) ?? roles.find((r) => !r.locked))?.name ?? "");
  const [key] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);

  const valid = email.trim() !== "" && displayName.trim() !== "" && role !== "";

  async function submit() {
    setError(null);
    try {
      const link = await invite.mutateAsync({ email: email.trim(), display_name: displayName.trim(), role, key });
      onDone(link, displayName.trim());
    } catch (e) {
      setError(errorText(e, "invite"));
    }
  }

  return (
    <Modal
      open
      title="Mời người dùng"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button loading={invite.isPending} disabled={!valid} onClick={() => void submit()}>Mời</Button>
        </>
      }
    >
      <form
        className="grid gap-s4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !invite.isPending) void submit();
        }}
      >
        <Field label="Email" name="email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus />
        <Field label="Tên hiển thị" name="display_name" autoComplete="off" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <div className="grid gap-s2">
          <label htmlFor="invite-role" className="text-md font-semibold leading-head text-body">Vai trò</label>
          <select id="invite-role" className={selectClass} value={role} onChange={(e) => setRole(e.target.value)}>
            <RoleOptions options={roles} />
          </select>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </form>
    </Modal>
  );
}

function RoleDialog({ user, roles, onClose }: { user: AdminUser; roles: SelectableRole[]; onClose: () => void }) {
  const update = useUpdateUser();
  const current = user.roles[0] ?? "nhan_vien";
  const [role, setRole] = useState(() =>
    roles.some((r) => r.name === current && !r.locked) ? current : (roles.find((r) => r.name === "nhan_vien" && !r.locked) ?? roles.find((r) => !r.locked))?.name ?? current,
  );
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await update.mutateAsync({ id: user.id, role });
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Modal
      open
      title={`Đổi vai trò · ${nameOf(user)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button loading={update.isPending} disabled={role === current} onClick={() => void submit()}>Xác nhận</Button>
        </>
      }
    >
      <div className="grid gap-s4">
        <div className="grid gap-s2">
          <label htmlFor="role-select" className="text-md font-semibold leading-head text-body">Vai trò mới</label>
          <select id="role-select" data-autofocus className={selectClass} value={role} onChange={(e) => setRole(e.target.value)}>
            <RoleOptions options={roles} />
          </select>
        </div>
        <p className="text-sm text-muted">Quyền mới có hiệu lực từ lần tải lại kế tiếp của người này.</p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Modal>
  );
}

function StatusDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const update = useUpdateUser();
  const [error, setError] = useState<string | null>(null);
  const unlocking = user.status === "disabled";

  async function submit() {
    setError(null);
    try {
      await update.mutateAsync({ id: user.id, status: unlocking ? "active" : "disabled" });
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Modal
      open
      title={unlocking ? "Mở khóa tài khoản" : "Khóa tài khoản"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button variant={unlocking ? "primary" : "danger"} loading={update.isPending} onClick={() => void submit()}>
            {unlocking ? "Mở khóa" : "Khóa"}
          </Button>
        </>
      }
    >
      <div className="grid gap-s4">
        <p className="text-md text-body">
          {unlocking
            ? `${nameOf(user)} sẽ đăng nhập lại được.`
            : `${nameOf(user)} sẽ bị đăng xuất và không đăng nhập được cho tới khi mở khóa.`}
        </p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Modal>
  );
}
