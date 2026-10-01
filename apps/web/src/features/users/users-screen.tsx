import { useMemo, useState, type ReactNode } from "react";
import { useCurrentUser } from "../../app/me";
import { useRoleLabelOf } from "../../app/roles-query";
import { Alert, Button, EmptyState, ErrorState, Field, Modal, Pill, Skeleton } from "../../ui";
import type { PillTone } from "../../ui";
import { errorText, useInviteUser, useReinvite, useUpdateUser, useUsers } from "./api";
import type { ActivationLink, AdminUser } from "./api";
import { LinkBox } from "./link-box";
import { GrantJitDialog, JitControls } from "./jit-controls";
import { CHANGE_ROLE_LOCK_TEXT, firstOpen, OPTION_LOCK_TEXT, rowLockNotes, STATUS_LOCK_TEXT } from "./role-locks";
import type { AssignableRole } from "./role-locks";

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

/** The role select, exactly as the API lists it (FIX-06: locked options carry the API's reason). */
function RoleOptions({ options }: { options: readonly AssignableRole[] }) {
  return (
    <>
      {options.map((r) => (
        <option key={r.name} value={r.name} disabled={r.locked_reason !== null}>
          {r.locked_reason ? `🔒 ${r.label} — ${OPTION_LOCK_TEXT[r.locked_reason]}` : r.label}
        </option>
      ))}
    </>
  );
}

type Dialog =
  | { kind: "invite" }
  | { kind: "link"; link: ActivationLink; name: string }
  | { kind: "role"; user: AdminUser }
  | { kind: "status"; user: AdminUser }
  | { kind: "jit"; user: AdminUser };

export function UsersScreen() {
  const me = useCurrentUser();
  const canWrite = me.permissions.includes("users:write");
  const canGrant = me.permissions.includes("jit:grant");
  const users = useUsers();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const reinvite = useReinvite();
  const [notice, setNotice] = useState<string | null>(null);

  const labelOf = useRoleLabelOf();

  const jitFor = (user: AdminUser) => <JitControls user={user} onGrant={(u) => setDialog({ kind: "jit", user: u })} />;
  const showActions = canWrite || canGrant;

  const items = useMemo(() => users.data?.pages.flatMap((page) => page.items) ?? [], [users.data]);
  const inviteRoles = users.data?.pages[0]?.invite_roles ?? [];

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
                {showActions ? <Actions canWrite={canWrite} jit={jitFor(user)} user={user} onReinvite={(u) => void onReinvite(u)} onDialog={setDialog} busy={reinvite.isPending} /> : null}
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
                  {showActions ? <th className="px-s4 py-s3 font-semibold">Thao tác</th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((user) => (
                  <tr key={user.id} className="border-b border-line last:border-b-0 align-top">
                    <td className="px-s4 py-s3 font-semibold text-strong">{nameOf(user)}</td>
                    <td className="px-s4 py-s3 text-body">{user.email}</td>
                    <td className="px-s4 py-s3"><Pill tone="accent">{roleText(user, labelOf)}</Pill></td>
                    <td className="px-s4 py-s3"><Pill tone={statusTone[user.status]}>{statusLabel[user.status]}</Pill></td>
                    {showActions ? (
                      <td className="px-s4 py-s3">
                        <Actions canWrite={canWrite} jit={jitFor(user)} user={user} onReinvite={(u) => void onReinvite(u)} onDialog={setDialog} busy={reinvite.isPending} />
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

      {dialog?.kind === "invite" ? <InviteDialog roles={inviteRoles} onClose={() => setDialog(null)} onDone={(link, name) => setDialog({ kind: "link", link, name })} /> : null}
      {dialog?.kind === "link" ? (
        <Modal open title="Link kích hoạt" onClose={() => setDialog(null)} footer={<Button onClick={() => setDialog(null)}>Đóng</Button>}>
          <LinkBox link={dialog.link} name={dialog.name} />
        </Modal>
      ) : null}
      {dialog?.kind === "role" ? <RoleDialog user={dialog.user} roles={dialog.user.role_options} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "jit" ? <GrantJitDialog user={dialog.user} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "status" ? <StatusDialog user={dialog.user} onClose={() => setDialog(null)} /> : null}
    </section>
  );
}

/** Row actions, straight from the API's `can` / `locked_reason` (FIX-06): the web decides nothing, it only words the reason. */
function Actions({
  canWrite,
  jit,
  user,
  busy,
  onReinvite,
  onDialog,
}: {
  canWrite: boolean;
  jit: ReactNode;
  user: AdminUser;
  busy: boolean;
  onReinvite: (user: AdminUser) => void | Promise<void>;
  onDialog: (dialog: Dialog) => void;
}) {
  const locked = (label: string, reason: string | undefined, testId: string) => (
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
  const statusLabel = user.status === "disabled" ? "Mở khóa" : "Khóa";
  const roleLock = user.locked_reason.change_role;
  const statusLock = user.locked_reason.set_status;
  const notes = rowLockNotes(user);
  return (
    <div className="grid justify-items-start gap-s2">
      {canWrite ? (
        <>
          <div className="flex flex-wrap gap-s2">
            {user.can.reinvite ? (
              <Button variant="secondary" disabled={busy} onClick={() => void onReinvite(user)}>Tạo lại link</Button>
            ) : null}
            {user.can.change_role ? (
              <Button variant="secondary" data-testid="action-role" onClick={() => onDialog({ kind: "role", user })}>
                Đổi vai trò
              </Button>
            ) : (
              locked("Đổi vai trò", roleLock ? CHANGE_ROLE_LOCK_TEXT[roleLock] : undefined, "action-role")
            )}
            {user.can.set_status ? (
              <Button variant={user.status === "disabled" ? "secondary" : "danger"} data-testid="action-status" onClick={() => onDialog({ kind: "status", user })}>
                {statusLabel}
              </Button>
            ) : (
              locked(statusLabel, statusLock ? STATUS_LOCK_TEXT[statusLock] : undefined, "action-status")
            )}
          </div>
          {notes.length === 1 ? (
            <p className="text-sm text-muted">🔒 {notes[0]}</p>
          ) : notes.length > 1 ? (
            <ul className="grid gap-s1 text-sm text-muted">
              {notes.map((n) => (
                <li key={n}>🔒 {n}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {jit}
    </div>
  );
}

function InviteDialog({ roles, onClose, onDone }: { roles: readonly AssignableRole[]; onClose: () => void; onDone: (link: ActivationLink, name: string) => void }) {
  const invite = useInviteUser();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState(() => firstOpen(roles));
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

function RoleDialog({ user, roles, onClose }: { user: AdminUser; roles: readonly AssignableRole[]; onClose: () => void }) {
  const update = useUpdateUser();
  const current = user.roles[0] ?? "nhan_vien";
  const [role, setRole] = useState(() => firstOpen(roles, current) || current);
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
