import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "../../lib/client";
import { problemMessage } from "../../lib/problem-messages";
import { formatVietnamTimestamp } from "../../lib/vn-date";
import { cn } from "../../lib/cn";
import { Button, EmptyState, ErrorState, Skeleton } from "../../ui";
import { AUDIT_ACTIONS, KNOWN_AUDIT_ACTIONS, auditSentence, type AuditTone } from "./audit-sentence";

const PAGE = 30;

const iconTone: Record<AuditTone, string> = {
  neutral: "bg-hover",
  danger: "bg-st-rejected-bg",
  accent: "bg-accent-soft",
  ok: "bg-st-approved-bg",
  pending: "bg-st-pending-bg",
};

class AuditLoadError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
  }
}

async function fetchPage(action: string, cursor: string | undefined) {
  const query: { limit: number; action?: string; cursor?: string } = { limit: PAGE };
  if (action) query.action = action;
  if (cursor) query.cursor = cursor;
  const { data, error, response } = await client.typed.GET("/audit", { params: { query } });
  if (response.ok && data) return data;
  const problem =
    error && typeof error === "object" && "type" in error
      ? (error as { type: string; title: string; status: number })
      : { type: "about:blank", title: response.statusText, status: response.status };
  throw new AuditLoadError(problemMessage(problem).message);
}

export function AuditScreen() {
  const [action, setAction] = useState("");
  const query = useInfiniteQuery({
    queryKey: ["audit", action],
    queryFn: ({ pageParam }) => fetchPage(action, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section className="grid gap-s4">
      <div className="grid gap-s2">
        <h1 className="text-2xl font-bold leading-head text-strong">Nhật ký</h1>
        <p className="max-w-[720px] text-md text-muted text-wrap-pretty">
          Mọi hành động quan trọng đều được ghi lại kèm người thực hiện, thời gian và IP. Ghi ở tầng nền, không sửa được.
        </p>
      </div>

      <label className="flex flex-wrap items-center gap-s2 text-md text-muted">
        Hành động
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="min-h-row rounded-r2 border border-line-strong bg-surface px-s3 text-md text-strong max-mobile:w-full"
        >
          <option value="">Tất cả</option>
          {KNOWN_AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {AUDIT_ACTIONS[a]?.text ?? a} ({a})
            </option>
          ))}
        </select>
      </label>

      {query.isPending ? (
        <div className="grid gap-s1" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-row w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof AuditLoadError ? query.error.userMessage : "Không tải được nhật ký. Thử lại sau."}
          onRetry={() => void query.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState title={action ? "Chưa có sự kiện nào thuộc hành động này." : "Chưa có sự kiện nào trong nhật ký."} />
      ) : (
        <>
          <ul className="grid gap-[2px]">
            {items.map((ev) => {
              const s = auditSentence(ev);
              const denied = ev.action === "permission.denied";
              const actor = ev.actor_name ?? "Hệ thống";
              return (
                <li
                  key={ev.id}
                  data-testid="audit-row"
                  data-denied={denied ? "true" : undefined}
                  className={cn(
                    "flex items-center gap-s3 rounded-r2 border px-s4 py-s3 max-mobile:flex-wrap",
                    denied ? "border-danger-border bg-st-rejected-bg text-danger" : "border-line bg-surface",
                  )}
                >
                  <span aria-hidden="true" className={cn("grid size-s6 flex-none place-items-center rounded-r2 text-md", iconTone[s.tone])}>
                    {s.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-md break-words", denied ? "text-danger" : "text-strong")} title={`${actor} ${s.text}`}>
                      <b className="font-semibold">{actor}</b> {s.text}
                      {s.code ? (
                        <code className="ml-s1 rounded-r1 bg-surface px-s1 font-mono text-sm">{s.code}</code>
                      ) : null}
                    </p>
                    <p className="font-mono text-sm text-muted break-all">IP {ev.ip ?? "—"}</p>
                  </div>
                  <span className="rounded-r1 border border-line bg-sunken px-s2 font-mono text-sm text-muted break-all">{ev.action}</span>
                  <span className="whitespace-nowrap font-mono text-sm text-faint">{formatVietnamTimestamp(ev.ts)}</span>
                </li>
              );
            })}
          </ul>
          {query.hasNextPage ? (
            <Button variant="secondary" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage} className="justify-self-center">
              {query.isFetchingNextPage ? "Đang tải…" : "Xem thêm"}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
