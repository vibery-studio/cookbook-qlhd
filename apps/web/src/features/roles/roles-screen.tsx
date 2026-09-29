import { useQuery } from "@tanstack/react-query";
import { roleLabels } from "../../app/me";
import { client } from "../../lib/client";
import { problemMessage } from "../../lib/problem-messages";
import { EmptyState, ErrorState, Skeleton } from "../../ui";
import { permissionLabel, sortRoles } from "./permission-labels";

class RolesLoadError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
  }
}

async function fetchRoles() {
  const { data, error, response } = await client.typed.GET("/roles", {});
  if (response.ok && data) return data.items;
  const problem =
    error && typeof error === "object" && "type" in error
      ? (error as { type: string; title: string; status: number })
      : { type: "about:blank", title: response.statusText, status: response.status };
  throw new RolesLoadError(problemMessage(problem).message);
}

export function RolesScreen() {
  const query = useQuery({ queryKey: ["roles"], queryFn: fetchRoles });
  const roles = sortRoles(query.data ?? []);
  const codes = [...new Set(roles.flatMap((r) => r.permissions))].sort((a, b) => {
    const la = permissionLabel(a) === a ? 1 : 0;
    const lb = permissionLabel(b) === b ? 1 : 0;
    return la - lb;
  });

  return (
    <section className="grid gap-s4">
      <div className="grid gap-s2">
        <h2 className="text-2xl font-bold leading-head text-strong">Phân quyền</h2>
        <p className="max-w-[720px] text-md text-muted text-wrap-pretty">
          Quyền đi theo vai, không theo người. Khóa tài khoản là mất sạch quyền. Bảng chỉ để xem.
        </p>
      </div>

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
                {roles.map((r) => (
                  <th key={r.name} scope="col" className="border-b border-line bg-sunken px-s2 py-s3 text-center text-sm font-medium text-muted" title={r.description ?? undefined}>
                    {roleLabels[r.name] ?? r.description ?? r.name}
                    <span className="block font-mono text-sm font-normal text-faint">{r.permissions.length} quyền</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.map((code) => (
                <tr key={code} className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-s3 py-s3 text-left font-normal text-strong">
                    {permissionLabel(code) === code ? null : <span>{permissionLabel(code)}</span>}
                    <code className="ml-s1 break-all rounded-r1 bg-sunken px-s1 font-mono text-sm text-muted">{code}</code>
                  </th>
                  {roles.map((r) => {
                    const has = r.permissions.includes(code);
                    return (
                      <td key={r.name} className="px-s2 py-s3 text-center">
                        <span aria-label={has ? "Có quyền" : "Không có quyền"} className={has ? "text-st-approved" : "text-faint opacity-50"}>
                          {has ? "●" : "○"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
