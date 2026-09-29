import { useMemo, useState } from "react";
import { roleLabels, useCurrentUser } from "../../app/me";
import { Alert, Button, EmptyState, ErrorState, Field, Modal, Pill, Skeleton } from "../../ui";
import type { PillTone } from "../../ui";
import { errorText, useInviteUser, useReinvite, useUpdateUser, useUsers } from "./api";
import type { ActivationLink, AdminUser, AssignableRole, InviteRole } from "./api";
import { LinkBox } from "./link-box";

const statusLabel: Record<AdminUser["status"], string> = { pending: "Chưa kích hoạt", active: "Đang hoạt động", disabled: "Đã khóa" };
const statusTone: Record<AdminUser["status"], PillTone> = { pending: "pending", active: "success", disabled: "danger" };
const inviteRoles: InviteRole[] = ["giam_doc", "quan_ly", "nhan_vien"];
const assignRoles: AssignableRole[] = ["giam_doc", "quan_ly", "nhan_vien", "admin"];

const selectClass =
  "min-h-[var(--row-h)] w-full rounded-r2 border border-line-strong bg-surface px-s3 text-md text-body outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft";

function nameOf(user: AdminUser): string {
  return user.display_name?.trim() || user.email;
}
function roleText(user: AdminUser): string {
  return user.roles.map((role) => roleLabels[role] ?? role).join(", ") || "Chưa có vai trò";
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
                  <Pill tone="accent">{roleText(user)}</Pill>
                  <Pill tone={statusTone[user.status]}>{statusLabel[user.status]}</Pill>
                </div>
                {canWrite ? <Actions user={user} isSelf={user.id === me.id} onReinvite={(u) => void onReinvite(u)} onDialog={setDialog} busy={reinvite.isPending} /> : null}
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
                    <td className="px-s4 py-s3"><Pill tone="accent">{roleText(user)}</Pill></td>
                    <td className="px-s4 py-s3"><Pill tone={statusTone[user.status]}>{statusLabel[user.status]}</Pill></td>
                    {canWrite ? (
                      <td className="px-s4 py-s3">
                        <Actions user={user} isSelf={user.id === me.id} onReinvite={(u) => void onReinvite(u)} onDialog={setDialog} busy={reinvite.isPending} />
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

      {dialog?.kind === "invite" ? <InviteDialog onClose={() => setDialog(null)} onDone={(link, name) => setDialog({ kind: "link", link, name })} /> : null}
      {dialog?.kind === "link" ? (
        <Modal open title="Link kích hoạt" onClose={() => setDialog(null)} footer={<Button onClick={() => setDialog(null)}>Đóng</Button>}>
          <LinkBox link={dialog.link} name={dialog.name} />
        </Modal>
      ) : null}
      {dialog?.kind === "role" ? <RoleDialog user={dialog.user} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "status" ? <StatusDialog user={dialog.user} onClose={() => setDialog(null)} /> : null}
    </section>
  );
}

function Actions({
  user,
  isSelf,
  busy,
  onReinvite,
  onDialog,
}: {
  user: AdminUser;
  isSelf: boolean;
  busy: boolean;
  onReinvite: (user: AdminUser) => void | Promise<void>;
  onDialog: (dialog: Dialog) => void;
}) {
  const selfReason = "Bạn không thể tự khóa hoặc đổi vai trò tài khoản của chính mình.";
  return (
    <div className="grid justify-items-start gap-s2">
      <div className="flex flex-wrap gap-s2">
        {user.status === "pending" ? (
          <Button variant="secondary" disabled={busy} onClick={() => void onReinvite(user)}>Tạo lại link</Button>
        ) : null}
        <Button variant="secondary" disabled={isSelf} title={isSelf ? selfReason : undefined} onClick={() => onDialog({ kind: "role", user })}>
          Đổi vai trò
        </Button>
        {user.status === "disabled" ? (
          <Button variant="secondary" onClick={() => onDialog({ kind: "status", user })}>Mở khóa</Button>
        ) : (
          <Button variant="danger" disabled={isSelf} title={isSelf ? selfReason : undefined} onClick={() => onDialog({ kind: "status", user })}>
            Khóa
          </Button>
        )}
      </div>
      {isSelf ? <p className="text-sm text-muted">{selfReason}</p> : null}
    </div>
  );
}

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: (link: ActivationLink, name: string) => void }) {
  const invite = useInviteUser();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<InviteRole>("nhan_vien");
  const [key] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);

  const valid = email.trim() !== "" && displayName.trim() !== "";

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
          <select id="invite-role" className={selectClass} value={role} onChange={(e) => setRole(e.target.value as InviteRole)}>
            {inviteRoles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
          </select>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </form>
    </Modal>
  );
}

function RoleDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const update = useUpdateUser();
  const current = (user.roles[0] as AssignableRole | undefined) ?? "nhan_vien";
  const [role, setRole] = useState<AssignableRole>(assignRoles.includes(current) ? current : "nhan_vien");
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
          <select id="role-select" data-autofocus className={selectClass} value={role} onChange={(e) => setRole(e.target.value as AssignableRole)}>
            {assignRoles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
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
