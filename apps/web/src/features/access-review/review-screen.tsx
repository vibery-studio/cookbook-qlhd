import { useState } from "react";
import { useCurrentUser } from "../../app/me";
import { ForbiddenScreen } from "../../app/forbidden-screen";
import { Alert, Button, EmptyState, ErrorState, Modal, Pill, Skeleton } from "../../ui";
import { reviewErrorText, useCloseReview, useCurrentReview, useDecideItem, useStartReview, type ReviewItem } from "./api";
import { headerText, lockText, rowStatus } from "./review-view";

function nameOf(item: ReviewItem): string {
  return item.user.display_name?.trim() || "(chưa đặt tên)";
}

export function ReviewScreen() {
  const me = useCurrentUser();
  const canSee = me.permissions.includes("reviews:write") || me.permissions.includes("roles:write");
  if (!canSee) return <ForbiddenScreen />;
  return <ReviewBody canWrite={me.permissions.includes("reviews:write")} />;
}

function ReviewBody({ canWrite }: { canWrite: boolean }) {
  const current = useCurrentReview(true);
  const start = useStartReview();
  const decide = useDecideItem();
  const close = useCloseReview();
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ReviewItem | null>(null);

  async function run(action: () => Promise<unknown>) {
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setNotice(reviewErrorText(e));
    }
  }

  const data = current.data;
  const review = data?.review ?? null;
  const open = review?.status === "open";

  return (
    <section className="grid gap-s5 p-s5" aria-labelledby="review-title">
      <header className="flex flex-wrap items-start justify-between gap-s3">
        <div className="grid gap-s1">
          <h1 id="review-title" className="text-xl font-bold leading-head text-strong">Rà soát quyền</h1>
          <p className="text-md text-muted">Mỗi quý, rà từng người: còn cần quyền này không.</p>
        </div>
        {data && review && open && canWrite ? (
          <Button
            variant="secondary"
            loading={close.isPending}
            disabled={data.items.some((i) => i.state === "open")}
            title={data.items.some((i) => i.state === "open") ? "Còn dòng chưa rà soát" : undefined}
            onClick={() => void run(() => close.mutateAsync({ reviewId: review.id }))}
          >
            Kết thúc đợt
          </Button>
        ) : null}
      </header>

      {notice ? <Alert tone="danger">{notice}</Alert> : null}

      {current.isPending ? (
        <div className="grid gap-s2" aria-busy="true" aria-label="Đang tải">
          <Skeleton className="h-[var(--row-h)]" />
          <Skeleton className="h-[var(--row-h)]" />
          <Skeleton className="h-[var(--row-h)]" />
        </div>
      ) : current.isError ? (
        <ErrorState message={reviewErrorText(current.error)} onRetry={() => void current.refetch()} />
      ) : !data || !review ? (
        <EmptyState
          title="Chưa có đợt rà soát quý này"
          action={
            canWrite ? (
              <Button loading={start.isPending} onClick={() => void run(() => start.mutateAsync())}>
                Bắt đầu rà soát
              </Button>
            ) : (
              <p className="text-sm text-muted">Giám đốc bắt đầu đợt rà soát.</p>
            )
          }
        />
      ) : (
        <>
          <p className="text-md font-semibold text-strong" data-testid="review-header">
            {headerText(review, data.progress)}
            {review.status === "closed" ? " · đã kết thúc" : ""}
          </p>
          {data.items.length === 0 ? (
            <EmptyState title="Không có dòng nào để rà soát." />
          ) : (
            <>
              <ul className="grid gap-s3 md:hidden" data-testid="review-cards">
                {data.items.map((item) => (
                  <li key={item.user.id} className="grid gap-s3 border border-line bg-surface p-s4">
                    <div className="grid gap-s1">
                      <span className="text-md font-semibold text-strong">{nameOf(item)}</span>
                      <span className="text-sm text-muted">{item.role.label}</span>
                    </div>
                    <Decision item={item} open={open} busy={decide.isPending} onKeep={() => void run(() => decide.mutateAsync({ reviewId: review.id, userId: item.user.id, decision: "keep" }))} onRemove={() => setRemoving(item)} />
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto border border-line bg-surface md:block">
                <table className="w-full border-collapse text-left text-md" data-testid="review-table">
                  <thead>
                    <tr className="border-b border-line bg-sunken text-sm text-muted">
                      <th className="px-s4 py-s3 font-semibold">Người</th>
                      <th className="px-s4 py-s3 font-semibold">Vai trò</th>
                      <th className="px-s4 py-s3 font-semibold">Quyết định</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={item.user.id} className="border-b border-line align-top last:border-b-0">
                        <td className="px-s4 py-s3 font-semibold text-strong">{nameOf(item)}</td>
                        <td className="px-s4 py-s3"><Pill tone="accent">{item.role.label}</Pill></td>
                        <td className="px-s4 py-s3">
                          <Decision item={item} open={open} busy={decide.isPending} onKeep={() => void run(() => decide.mutateAsync({ reviewId: review.id, userId: item.user.id, decision: "keep" }))} onRemove={() => setRemoving(item)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {removing && review ? (
        <RemoveDialog
          item={removing}
          pending={decide.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            void run(() => decide.mutateAsync({ reviewId: review.id, userId: removing.user.id, decision: "remove" })).then(() => setRemoving(null));
          }}
        />
      ) : null}
    </section>
  );
}

function Decision({ item, open, busy, onKeep, onRemove }: { item: ReviewItem; open: boolean; busy: boolean; onKeep: () => void; onRemove: () => void }) {
  const status = rowStatus(item);
  if (status.kind === "decided") {
    return (
      <div className="grid justify-items-start gap-s1">
        <Pill tone={status.decision === "keep" ? "success" : "danger"}>{status.label}</Pill>
        {item.decided_by_name ? <span className="text-sm text-muted">bởi {item.decided_by_name}</span> : null}
      </div>
    );
  }
  if (status.kind === "changed") return <Pill tone="neutral">{status.label}</Pill>;
  const lock = lockText(item);
  return (
    <div className="grid justify-items-start gap-s2">
      {open && (item.can.keep || item.can.remove) ? (
        <div className="flex flex-wrap gap-s2">
          {item.can.keep ? <Button variant="secondary" disabled={busy} onClick={onKeep}>Giữ</Button> : null}
          {item.can.remove ? <Button variant="danger" disabled={busy} onClick={onRemove}>Gỡ</Button> : null}
        </div>
      ) : null}
      {lock ? <p className="text-sm text-muted">🔒 {lock}</p> : null}
    </div>
  );
}

function RemoveDialog({ item, pending, onCancel, onConfirm }: { item: ReviewItem; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal
      open
      title={`Gỡ · ${nameOf(item)}`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Không</Button>
          <Button variant="danger" loading={pending} onClick={onConfirm}>Gỡ và khóa tài khoản</Button>
        </>
      }
    >
      <p className="text-md text-body">
        Gỡ nghĩa là khóa tài khoản của {nameOf(item)} ({item.role.label}): người này bị đăng xuất và không đăng nhập được cho tới khi mở khóa.
      </p>
    </Modal>
  );
}
