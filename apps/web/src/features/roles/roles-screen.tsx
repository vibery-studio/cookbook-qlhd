import { Fragment, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../app/me";
import { ROLES_KEY, RolesLoadError, useRoles } from "../../app/roles-query";
import { Alert, Button, EmptyState, ErrorState, Skeleton } from "../../ui";
import { groupCatalog, permissionLabel, sortRoles } from "./permission-labels";
import { cloneSeed, RoleFormModal, type RoleSeed } from "./role-form-modal";
import { RoleDrawer } from "./role-drawer";

export function RolesScreen() {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const query = useRoles();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<RoleSeed | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canWrite = me.permissions.includes("roles:write");
  // Hint only (the API checks again): the admin role is exempt from "only grant what you hold".
  const holds = (code: string) => me.roles.includes("admin") || me.permissions.includes(code);

  const roles = sortRoles(query.data?.items ?? []);
  const catalog = query.data?.catalog ?? [...new Set(roles.flatMap((r) => r.permissions))];
  const groups = groupCatalog(catalog);
  const selected = roles.find((r) => r.id === selectedId) ?? null;
  const colCount = roles.length + 1;

  return (
    <section className="grid gap-s4">
      <div className="flex flex-wrap items-start justify-between gap-s3">
        <div className="grid gap-s2">
          <h1 className="text-2xl font-bold leading-head text-strong">Phân quyền</h1>
          <p className="max-w-[720px] text-md text-muted text-wrap-pretty">
            Quyền đi theo vai, không theo người. Khóa tài khoản là mất sạch quyền.{" "}
            {canWrite ? "Bấm tên vai trò để sửa." : "Bảng chỉ để xem."}
          </p>
        </div>
        {canWrite ? (
          <Button
            type="button"
            disabled={query.isPending || query.isError}
            onClick={() => {
              setNotice(null);
              setForm({ label: "", description: "", permissions: [] });
            }}
          >
            + Thêm vai trò
          </Button>
        ) : null}
      </div>

      {notice ? (
        <div role="status">
          <Alert tone="success">{notice}</Alert>
        </div>
      ) : null}

      {query.isPending ? (
        <div className="grid gap-s1" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-row w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof RolesLoadError ? query.error.userMessage : "Không tải được bảng phân quyền. Thử lại sau."}
          onRetry={() => void query.refetch()}
        />
      ) : roles.length === 0 ? (
        <EmptyState title="Chưa có vai trò nào." />
      ) : (
        <div className="overflow-x-auto rounded-r3 border border-line bg-surface">
          <table data-testid="roles-matrix" className="w-full border-collapse text-md">
            <thead>
              <tr>
                <th scope="col" className="border-b border-line bg-sunken px-s3 py-s3 text-left text-sm font-medium text-muted">
                  Quyền
                </th>
                {roles.map((r) => {
                  const lock = r.locked_reason === "own_role" || r.locked_reason === "admin";
                  const content = (
                    <>
                      {r.label}
                      {lock ? (
                        <span aria-hidden="true" title={r.locked_reason === "admin" ? "Quản trị hệ thống luôn đủ quyền" : "Bạn đang mang vai trò này"}>
                          {" "}
                          🔒
                        </span>
                      ) : null}
                      <span className="block font-mono text-sm font-normal text-faint">{r.permissions.length} quyền</span>
                    </>
                  );
                  return (
                    <th key={r.id} scope="col" className="border-b border-line bg-sunken p-0 text-center text-sm font-medium text-muted" title={r.description ?? undefined}>
                      {canWrite ? (
                        <button
                          type="button"
                          data-testid="role-col"
                          className="motion-colors min-h-[var(--row-h)] w-full px-s2 py-s3 font-medium hover:bg-hover hover:text-strong"
                          onClick={() => {
                            setNotice(null);
                            setSelectedId(r.id);
                          }}
                        >
                          {content}
                        </button>
                      ) : (
                        <span className="block px-s2 py-s3">{content}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {groups.map(({ group, codes }) => (
                <Fragment key={group}>
                  <tr>
                    <th scope="colgroup" colSpan={colCount} className="border-b border-line bg-sunken px-s3 py-s2 text-left text-sm font-semibold text-muted">
                      {group}
                    </th>
                  </tr>
                  {codes.map((code) => (
                    <tr key={code} className="border-b border-line last:border-b-0">
                      <th scope="row" className="px-s3 py-s3 text-left font-normal text-strong">
                        {permissionLabel(code) === code ? null : <span>{permissionLabel(code)}</span>}
                        <code className="ml-s1 break-all rounded-r1 bg-sunken px-s1 font-mono text-sm text-muted">{code}</code>
                      </th>
                      {roles.map((r) => {
                        const has = r.permissions.includes(code);
                        return (
                          <td key={r.id} className="px-s2 py-s3 text-center">
                            <span aria-label={has ? "Có quyền" : "Không có quyền"} className={has ? "text-st-approved" : "text-faint opacity-50"}>
                              {has ? "●" : "○"}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canWrite && selected ? (
        <RoleDrawer
          key={selected.id}
          role={selected}
          catalog={catalog}
          holds={holds}
          onClose={() => setSelectedId(null)}
          onClone={(role) => {
            setSelectedId(null);
            setForm(cloneSeed(role, holds));
          }}
          onDeleted={(role) => {
            setSelectedId(null);
            setNotice(`Đã xóa vai trò «${role.label}».`);
          }}
          onReload={() => void qc.invalidateQueries({ queryKey: ROLES_KEY })}
        />
      ) : null}
      {canWrite && form ? (
        <RoleFormModal
          seed={form}
          catalog={catalog}
          holds={holds}
          onClose={() => setForm(null)}
          onCreated={(role) => {
            setForm(null);
            setNotice(`Đã tạo vai trò «${role.label}».`);
          }}
        />
      ) : null}
    </section>
  );
}
