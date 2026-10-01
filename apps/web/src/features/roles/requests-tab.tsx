import { useState } from "react";
import { Alert, EmptyState, ErrorState, Pill, Skeleton, type PillTone } from "../../ui";
import { formatVietnamTimestamp } from "../../lib/vn-date";
import type { RoleError } from "./api";
import { permissionLabel } from "./permission-labels";
import { RequestActions } from "./request-actions";
import { diffText, formatDayMonth, STATUS_LABELS, useChangeRequests, type ChangeRequest } from "./requests";

const TONES: Record<ChangeRequest["status"], PillTone> = {
  pending: "pending",
  approved: "approved",
  rejected: "danger",
  withdrawn: "neutral",
  expired: "neutral",
  cancelled: "neutral",
};

const th = "border-b border-line bg-sunken px-s3 py-s3 text-left text-sm font-medium text-muted";

/** Tab "Yêu cầu đổi quyền": every request, newest first; pending rows carry Duyệt · Từ chối · Rút yêu cầu by `can`. */
export function RequestsTab() {
  const query = useChangeRequests(true);
  const [error, setError] = useState<RoleError | null>(null);

  if (query.isPending) {
    return (
      <div className="grid gap-s1" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-row w-full" />
        ))}
      </div>
    );
  }
  if (query.isError) return <ErrorState message="Không tải được các yêu cầu đổi quyền. Thử lại sau." onRetry={() => void query.refetch()} />;
  const items = query.data;
  if (items.length === 0) return <EmptyState title="Không có yêu cầu nào đang chờ." />;

  return (
    <div className="grid gap-s3">
      {error ? <Alert tone="danger">{error.message}</Alert> : null}
      <div className="overflow-x-auto rounded-r3 border border-line bg-surface">
        <table data-testid="change-requests" className="w-full border-collapse text-md">
          <thead>
            <tr>
              <th scope="col" className={th}>Vai trò</th>
              <th scope="col" className={th}>Thay đổi</th>
              <th scope="col" className={th}>Người gửi</th>
              <th scope="col" className={th}>Gửi lúc</th>
              <th scope="col" className={th}>Hết hạn</th>
              <th scope="col" className={th}>Trạng thái</th>
              <th scope="col" className={th}>
                <span className="sr-only">Thao tác</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-line align-top last:border-b-0">
                <td className="px-s3 py-s3 font-medium text-strong">{r.role_label}</td>
                <td className="px-s3 py-s3">
                  <p className="font-mono text-sm text-muted">{diffText(r.added, r.removed)}</p>
                  <ul className="grid gap-[2px] text-sm text-body">
                    {r.added.map((c) => (
                      <li key={`+${c}`}>+ {permissionLabel(c)}</li>
                    ))}
                    {r.removed.map((c) => (
                      <li key={`-${c}`}>− {permissionLabel(c)}</li>
                    ))}
                  </ul>
                </td>
                <td className="px-s3 py-s3">{r.requested_by_name ?? "—"}</td>
                <td className="px-s3 py-s3 text-muted">{formatVietnamTimestamp(r.requested_at)}</td>
                <td className="px-s3 py-s3 text-muted">{formatDayMonth(r.expires_at)}</td>
                <td className="px-s3 py-s3">
                  <Pill tone={TONES[r.status]}>{STATUS_LABELS[r.status]}</Pill>
                </td>
                <td className="px-s3 py-s3">
                  <RequestActions request={r} onError={setError} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
