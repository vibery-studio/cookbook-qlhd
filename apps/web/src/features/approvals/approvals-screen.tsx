import { Link } from "react-router";
import { EmptyState, ErrorState, Skeleton } from "../../ui";
import { formatVietnameseMoney } from "../../lib/vn-money";
import { formatVietnamTimestamp } from "../../lib/vn-date";
import { ApprovalsLoadError, useApprovalQueue } from "./queue";

export function ApprovalsScreen() {
  const query = useApprovalQueue(true);
  const items = query.data?.items ?? [];

  return (
    <section className="grid gap-s4">
      <div className="grid gap-s2">
        <h1 className="text-2xl font-bold leading-head text-strong">Chờ tôi duyệt</h1>
        <p className="max-w-[720px] text-md text-muted text-wrap-pretty">
          Các hợp đồng đang đến lượt bạn duyệt. Bấm vào một hợp đồng để xem và quyết định.
        </p>
      </div>

      {query.isPending ? (
        <div className="grid gap-s1" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-row w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof ApprovalsLoadError ? query.error.userMessage : "Không tải được danh sách. Thử lại sau."}
          onRetry={() => void query.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState title="Không có hợp đồng nào đang chờ bạn duyệt." />
      ) : (
        <>
          <ul className="grid gap-s2" data-testid="approvals-list">
            {items.map((it) => (
              <li key={`${it.contract_id}:${it.step_no}`}>
                <Link
                  to={`/hop-dong/${it.contract_id}`}
                  data-testid="approval-row"
                  className="motion-colors grid min-h-[var(--row-h)] items-center gap-s2 rounded-r2 border border-line bg-surface px-s4 py-s3 hover:bg-hover mobile:grid-cols-[minmax(0,2fr)_auto_minmax(0,1.2fr)_minmax(0,1fr)_auto] mobile:gap-s4"
                >
                  <span className="min-w-0 break-words text-md font-semibold text-strong">{it.customer_name}</span>
                  <span className="font-mono text-md text-strong">{formatVietnameseMoney(it.total)}</span>
                  <span className="min-w-0 text-md text-muted">
                    <span className="rounded-r1 border border-line bg-sunken px-s2 text-sm">{it.label}</span>
                  </span>
                  <span className="min-w-0 break-words text-md text-muted">{it.created_by_name ?? "—"}</span>
                  <span className="whitespace-nowrap font-mono text-sm text-faint">
                    {it.submitted_at === null ? "—" : formatVietnamTimestamp(it.submitted_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {query.data?.next_cursor ? (
            <p className="text-sm text-muted">Đang hiện 50 hợp đồng đầu tiên. Duyệt xong sẽ hiện tiếp các hợp đồng còn lại.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
