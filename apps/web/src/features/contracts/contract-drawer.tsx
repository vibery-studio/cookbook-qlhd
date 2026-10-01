import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../app/me";
import { formatIsoDate, formatVietnamTimestamp } from "../../lib/vn-date";
import { formatVietnameseMoney } from "../../lib/vn-money";
import { useIdempotencyKeeper } from "../../lib/idempotency-key";
import { cn } from "../../lib/cn";
import { Alert, Button, EmptyState, ErrorState, LockedNote, Pill, Skeleton } from "../../ui";
import { APPROVALS_KEY } from "../approvals";
import { auditSentence } from "../audit/audit-sentence";
import {
  CONTRACTS_KEY,
  contractKey,
  deleteContract,
  errorMessage,
  postAction,
  useContract,
  useContractAudit,
  useTemplates,
  type ContractAction,
} from "./api";
import { ConfirmDialog, type ConfirmSpec } from "./confirm-dialog";
import { ContractFormModal } from "./contract-form-modal";
import { Dialog, DialogHeader } from "./dialog";
import { STEP_STATE_TEXT, buildFlow } from "./flow";
import { lockReason, visibleActions, type ActionKey } from "./lock-reasons";
import { PaperOverlay } from "./paper-overlay";
import { parseSnapshot } from "./snapshot";
import { bpsToPercentText } from "./values";
import { STATUS_TONE, numberLabel, statusLabel } from "./status";

const ACTION_LABELS: Record<ActionKey, string> = {
  edit: "Sửa",
  submit: "Gửi duyệt",
  approve: "Duyệt",
  reject: "Từ chối",
  issue: "Phát hành",
  void: "Hủy hợp đồng",
  copy: "Tạo bản thay thế",
  withdraw: "Rút về nháp",
  delete: "Xóa nháp",
};

const ACTION_DONE: Partial<Record<ActionKey, string>> = {
  submit: "Đã gửi duyệt",
  approve: "Đã duyệt",
  reject: "Đã từ chối",
  void: "Đã hủy hợp đồng",
  copy: "Đã tạo bản thay thế (nháp)",
  withdraw: "Đã rút về nháp",
};

const CONFIRMS: Partial<Record<ActionKey, ConfirmSpec>> = {
  reject: { message: "Từ chối hợp đồng này? Việc duyệt dừng lại, người tạo có thể tạo bản thay thế.", askReason: true, reasonRequired: true, danger: true },
  issue: { message: "Phát hành hợp đồng? Hệ thống cấp số hợp đồng và khóa nội dung." },
  void: { message: "Hủy hợp đồng đã phát hành? Số hợp đồng vẫn được giữ và không hoàn tác được.", askReason: true, reasonRequired: true, danger: true },
  withdraw: { message: "Hợp đồng sẽ về nháp, các bước duyệt bị hủy; gửi duyệt lại sẽ xếp người duyệt lại." },
  delete: { message: "Xóa hẳn hợp đồng nháp này? Không hoàn tác được.", danger: true },
};

const VARIANT: Partial<Record<ActionKey, "primary" | "danger">> = { submit: "primary", approve: "primary", issue: "primary", reject: "danger", void: "danger", delete: "danger" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-s2">
      <h3 className="text-md font-bold leading-head text-strong">{title}</h3>
      {children}
    </section>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-s3 border-b border-line py-s2 text-md last:border-b-0 max-mobile:grid-cols-1 max-mobile:gap-s1">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-body">{children}</dd>
    </div>
  );
}

export function ContractDrawer({
  id,
  paperOpen,
  onClose,
  onOpenPaper,
  onClosePaper,
  onGoDetail,
  onDeleted,
  notify,
}: {
  id: string;
  paperOpen: boolean;
  onClose: () => void;
  onOpenPaper: () => void;
  onClosePaper: () => void;
  onGoDetail: (id: string) => void;
  onDeleted: (message: string) => void;
  notify: (message: string) => void;
}) {
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const keeper = useIdempotencyKeeper();
  const query = useContract(id);
  const templates = useTemplates();
  const canAudit = me.permissions.includes("audit:read");
  const audit = useContractAudit(id, canAudit);

  const [confirm, setConfirm] = useState<ActionKey | null>(null);
  const [busy, setBusy] = useState<ActionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const contract = query.data;
  const problem = query.isError ? errorMessage(query.error) : null;

  function refreshLists() {
    void queryClient.invalidateQueries({ queryKey: CONTRACTS_KEY });
    void queryClient.invalidateQueries({ queryKey: APPROVALS_KEY });
    void queryClient.invalidateQueries({ queryKey: ["customers"] });
  }

  async function run(action: ActionKey, reason = "") {
    if (!contract || busy || action === "edit") return;
    setBusy(action);
    setError(null);
    try {
      if (action === "delete") {
        await deleteContract(id);
        refreshLists();
        onDeleted("Đã xóa nháp");
        queryClient.removeQueries({ queryKey: contractKey(id) });
        return;
      }
      const body: Record<string, unknown> = action === "reject" ? { note: reason } : action === "void" ? { reason } : {};
      const key = action === "withdraw" ? undefined : keeper.keyFor(`${action}:${id}:${contract.version}:${JSON.stringify(body)}`);
      const next = await postAction(action as ContractAction, id, body, key);
      keeper.reset();
      queryClient.setQueryData(contractKey(next.id), next);
      refreshLists();
      void queryClient.invalidateQueries({ queryKey: ["contract-audit", id] });
      if (action === "copy") {
        notify(ACTION_DONE.copy ?? "");
        onGoDetail(next.id);
      } else {
        notify(action === "issue" ? `Đã phát hành ${next.number ?? ""}`.trim() : (ACTION_DONE[action] ?? "Xong"));
      }
    } catch (e) {
      const info = errorMessage(e);
      if (action === "delete" && info.status === 404) {
        refreshLists();
        onDeleted("Nháp này đã được xóa");
        return;
      }
      if (info.reload) {
        void queryClient.invalidateQueries({ queryKey: contractKey(id) });
        refreshLists();
      }
      if (info.status === 403) void queryClient.invalidateQueries({ queryKey: ["me"] });
      setError(info.message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  const snap = contract ? parseSnapshot(contract.snapshot) : null;
  const flow = contract ? buildFlow(contract) : [];
  const creator = flow.find((f) => f.kind === "created")?.actor ?? null;
  const templateName = contract ? (templates.data?.find((t) => t.id === contract.template_id)?.name ?? "Mẫu hợp đồng") : "";
  const lock = contract ? { contract, meId: me.id, permissions: me.permissions } : null;
  const actions = contract && lock ? visibleActions(contract.status).map((a) => ({ a, reason: lockReason(a, lock) })) : [];
  const reasons = [...new Set(actions.flatMap((x) => (x.reason ? [x.reason] : [])))];
  // SPEC-05: issued/voided → the server makes the PDF on the first click, then serves the stored file
  const hasPdf = contract !== undefined && contract.pdf_status !== "none";

  return (
    <>
      <Dialog label="Chi tiết hợp đồng" variant="drawer" onClose={onClose} testId="contract-drawer">
        <DialogHeader
          eyebrow="Hợp đồng"
          onClose={onClose}
          title={
            contract ? (
              <div className="flex flex-wrap items-center gap-s2">
                <h2 className="font-mono text-xl font-bold leading-head text-strong">{numberLabel(contract.number, contract.status)}</h2>
                <Pill tone={STATUS_TONE[contract.status]}>{statusLabel(contract.status)}</Pill>
              </div>
            ) : (
              <Skeleton className="h-row w-full" />
            )
          }
          right={contract ? <p className="truncate text-md text-muted">{contract.customer_name}</p> : null}
        />

        <div className="shell-scroll grid min-h-0 flex-1 content-start gap-s5 overflow-y-auto px-s5 py-s5">
          {query.isPending ? (
            <div className="grid gap-s2" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-row w-full" />
              ))}
            </div>
          ) : problem ? (
            problem.status === 403 ? (
              <LockedNote>{problem.message.replace(/^🔒\s*/, "")}</LockedNote>
            ) : problem.status === 404 ? (
              <EmptyState title="Không tìm thấy hợp đồng." action={<Button variant="secondary" onClick={onClose}>Về danh sách</Button>} />
            ) : (
              <ErrorState message={problem.message} onRetry={() => void query.refetch()} />
            )
          ) : contract && snap ? (
            <>
              <Section title="Thông tin">
                <dl>
                  <InfoRow label="Mẫu">{templateName}{snap.templateVersionNo ? ` · v${snap.templateVersionNo}` : ""}</InfoRow>
                  <InfoRow label="Ngày lập">{formatIsoDate(contract.doc_date)}</InfoRow>
                  <InfoRow label="Thời hạn">{formatIsoDate(snap.start)} → {formatIsoDate(snap.end)}</InfoRow>
                  <InfoRow label="Gói">{snap.packageName ?? "—"}</InfoRow>
                  <InfoRow label="Người tạo">{creator ?? "—"}</InfoRow>
                </dl>
              </Section>

              <Section title="Dòng hàng">
                <ul className="grid">
                  {snap.lines.map((l, i) => (
                    <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-s3 border-b border-line py-s2 text-md">
                      <span className="min-w-0 text-body">
                        {l.description}
                        <span className="block text-sm text-muted">
                          {l.qty} × {formatVietnameseMoney(l.unitPrice)}
                          {l.discountBps > 0 ? ` · giảm ${bpsToPercentText(l.discountBps)}%` : ""}
                        </span>
                      </span>
                      <span className="font-mono text-right text-strong">{formatVietnameseMoney(l.amount)}</span>
                    </li>
                  ))}
                </ul>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-s3 py-s2">
                  <span className="text-md font-bold text-strong">Tổng cộng (đã gồm VAT)</span>
                  <span className="font-mono text-right text-lg font-bold text-strong">{formatVietnameseMoney(contract.total)}</span>
                </div>
                {snap.totalWords ? <p className="text-md text-muted text-wrap-pretty">Bằng chữ: {snap.totalWords}</p> : null}
              </Section>

              <Section title="Luồng duyệt">
                <ol className="grid gap-s2" data-testid="approval-flow">
                  {flow.map((f) => (
                    <li
                      key={f.key}
                      aria-current={f.current ? "step" : undefined}
                      className={cn(
                        "grid gap-s1 rounded-r2 border px-s3 py-s2 text-md",
                        f.current ? "border-accent bg-accent-soft" : "border-line bg-surface",
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-s2">
                        <span className="font-semibold text-strong">{f.label}</span>
                        {f.kind === "step" ? (
                          <Pill tone={f.state === "waiting" ? "pending" : f.state === "rejected" ? "danger" : "approved"}>{STEP_STATE_TEXT[f.state]}</Pill>
                        ) : null}
                      </div>
                      {f.actor || f.at ? (
                        <p className="text-sm text-muted">
                          {f.actor ?? ""}
                          {f.actor && f.at ? " · " : ""}
                          {f.at ? formatVietnamTimestamp(f.at) : ""}
                        </p>
                      ) : null}
                      {f.note ? <p className="text-md text-body text-wrap-pretty">{f.kind === "voided" ? "Lý do hủy: " : f.state === "rejected" ? "Lý do từ chối: " : "Ghi chú: "}{f.note}</p> : null}
                    </li>
                  ))}
                </ol>
              </Section>

              <div>
                <Button type="button" variant="secondary" onClick={onOpenPaper}>Xem văn bản hợp đồng</Button>
              </div>

              {canAudit ? (
                <Section title="Nhật ký của hợp đồng">
                  {audit.isPending ? (
                    <Skeleton className="h-row w-full" />
                  ) : audit.isError ? (
                    <ErrorState message={errorMessage(audit.error).message} onRetry={() => void audit.refetch()} />
                  ) : (
                    <>
                      <ul className="grid">
                        {audit.data.pages
                          .flatMap((p) => p.items)
                          .map((ev) => {
                            const s = auditSentence(ev);
                            return (
                              <li key={ev.id} data-testid="contract-audit-row" className="border-b border-line py-s2 text-md text-body last:border-b-0">
                                <span aria-hidden="true">{s.icon} </span>
                                <span className="font-semibold text-strong">{ev.actor_name ?? "Hệ thống"}</span> {s.text}
                                <span className="block text-sm text-muted">{formatVietnamTimestamp(ev.ts)}</span>
                              </li>
                            );
                          })}
                      </ul>
                      {audit.hasNextPage ? (
                        <Button type="button" variant="secondary" className="justify-self-start" loading={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
                          Xem thêm
                        </Button>
                      ) : null}
                    </>
                  )}
                </Section>
              ) : null}
            </>
          ) : null}
        </div>

        {contract ? (
          <div className="grid gap-s3 border-t border-line bg-sunken px-s5 py-s4">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <div className="flex flex-wrap gap-s2">
              {hasPdf ? (
                <a
                  href={`/contracts/${contract.id}/pdf`}
                  download
                  data-testid="action-pdf"
                  className="motion-colors inline-flex min-h-[var(--row-h)] items-center rounded-r2 border border-line-strong bg-surface px-s4 text-md font-semibold text-body hover:bg-hover"
                >
                  Tải PDF
                </a>
              ) : null}
              {actions.map(({ a, reason }) =>
                reason ? (
                  <Button
                    key={a}
                    type="button"
                    variant="secondary"
                    data-testid={`action-${a}`}
                    aria-disabled="true"
                    aria-describedby={`lock-${reasons.indexOf(reason)}`}
                    className="cursor-not-allowed opacity-60"
                    onClick={(event) => event.preventDefault()}
                  >
                    🔒 {ACTION_LABELS[a]}
                  </Button>
                ) : (
                  <Button
                    key={a}
                    type="button"
                    variant={VARIANT[a] ?? "secondary"}
                    data-testid={`action-${a}`}
                    loading={busy === a && confirm === null}
                    disabled={busy !== null}
                    onClick={() => {
                      setError(null);
                      if (a === "edit") setEditing(true);
                      else if (CONFIRMS[a]) setConfirm(a);
                      else void run(a);
                    }}
                  >
                    {ACTION_LABELS[a]}
                  </Button>
                ),
              )}
            </div>
            {reasons.length > 0 ? (
              <ul className="grid gap-s1 text-sm text-muted">
                {reasons.map((r, i) => (
                  <li key={r} id={`lock-${i}`} className="text-wrap-pretty">
                    🔒 {r}
                    {r === "Đã có bản thay thế" && contract.replaced_by_id ? (
                      <>
                        {" "}
                        <button type="button" className="font-semibold text-accent underline" onClick={() => onGoDetail(contract.replaced_by_id as string)}>
                          Mở bản đó
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      {confirm && CONFIRMS[confirm] ? (
        <ConfirmDialog spec={CONFIRMS[confirm]} pending={busy !== null} onCancel={() => setConfirm(null)} onConfirm={(reason) => void run(confirm, reason)} />
      ) : null}

      {editing && contract ? (
        <ContractFormModal
          mode="edit"
          contract={contract}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            notify("Đã lưu");
            void queryClient.invalidateQueries({ queryKey: ["contract-audit", id] });
          }}
        />
      ) : null}

      {paperOpen && contract ? <PaperOverlay contractId={contract.id} hasPdf={hasPdf} version={contract.version} onClose={onClosePaper} /> : null}
    </>
  );
}

