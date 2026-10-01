import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useIdempotencyKeeper } from "../../lib/idempotency-key";
import { formatIsoDate } from "../../lib/vn-date";
import { formatVietnameseMoney } from "../../lib/vn-money";
import { Alert, Button, Field } from "../../ui";
import { APPROVALS_KEY } from "../approvals";
import { CONTRACTS_KEY, contractKey, errorMessage, updateContract, type Contract, type ContractValues } from "./api";
import { createChild } from "./children-api";
import { Dialog, DialogHeader } from "./dialog";
import { DOC_TYPE_LABEL, type DocType } from "./doc-type-labels";
import { parseSnapshot } from "./snapshot";
import { TotalsBox, vatRateText } from "./totals-box";

export type ChildFormProps =
  | { mode: "create"; parent: Contract; type: DocType; onClose: () => void; onCreated: (child: Contract) => void }
  | { mode: "edit"; contract: Contract; onClose: () => void; onSaved: (child: Contract) => void };

/** Today + `days` in Vietnam time, "YYYY-MM-DD" (a preview only: the server sets the real due date). */
export function vnDatePlus(days: number, now = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function LockedLines({ snap }: { snap: ReturnType<typeof parseSnapshot> }) {
  return (
    <div className="shell-scroll overflow-x-auto">
      <table aria-label="Dòng hàng (khóa)" className="w-full text-left text-md">
        <thead>
          <tr className="border-b border-line text-sm text-muted">
            <th scope="col" className="py-s2 pr-s2 font-medium">Tên</th>
            <th scope="col" className="px-s2 py-s2 text-right font-medium">SL</th>
            <th scope="col" className="px-s2 py-s2 text-right font-medium">Đơn giá chưa VAT</th>
            <th scope="col" className="px-s2 py-s2 text-right font-medium">Thuế suất</th>
            <th scope="col" className="py-s2 pl-s2 text-right font-medium">Thành tiền chưa VAT</th>
          </tr>
        </thead>
        <tbody>
          {snap.lines.map((l, i) => (
            <tr key={i} data-testid="locked-line-row" className="border-b border-line align-top">
              <td className="py-s2 pr-s2 text-body">{l.name}</td>
              <td className="font-mono px-s2 py-s2 text-right">{l.qty}</td>
              <td className="font-mono px-s2 py-s2 text-right">{formatVietnameseMoney(l.unitPriceExVat)}</td>
              <td className="px-s2 py-s2 text-right">{vatRateText(l.vatRateBps)}</td>
              <td className="font-mono py-s2 pl-s2 text-right text-strong">{formatVietnameseMoney(l.amountExVat)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReadOnlyRow({ label, children }: { label: string; children: string }) {
  return (
    <div className="grid gap-s2">
      <p className="text-md font-semibold leading-head text-body">{label}</p>
      <p className="font-mono flex min-h-[var(--row-h)] items-center rounded-r2 border border-line bg-sunken px-s3 text-md text-strong">{children}</p>
    </div>
  );
}

/**
 * SPEC-09 3.4: make a child (HĐ from an issued BG, DNTT from an issued HĐ) or edit a child draft.
 * Lines, prices and the discount are the parent's — shown locked (🔒), never sent; only hand-typed values go up.
 */
export function ChildFormModal(props: ChildFormProps) {
  const { onClose } = props;
  const queryClient = useQueryClient();
  const keeper = useIdempotencyKeeper();
  const editing = props.mode === "edit" ? props.contract : undefined;
  const type: DocType = props.mode === "create" ? props.type : props.contract.type;
  const label = DOC_TYPE_LABEL[type];
  const source = props.mode === "create" ? props.parent : null;
  const snap = useMemo(() => parseSnapshot((source ?? editing)?.snapshot), [source, editing]);
  const parentType = source ? source.type : (editing?.parent?.type ?? (type === "payment_request" ? "contract" : "quote"));
  const parentNumber = source ? source.number : (editing?.parent?.number ?? snap.parent?.number ?? null);
  const parentLabel = DOC_TYPE_LABEL[parentType].toLowerCase();
  const parentRef = `${parentLabel} ${parentNumber ?? ""}`.trim();

  const [signer, setSigner] = useState(String(snap.inputs["chuc_vu_nguoi_ky"] ?? ""));
  const [start, setStart] = useState(editing ? (snap.start ?? "") : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const title = props.mode === "create" ? (type === "contract" ? `Lập hợp đồng từ báo giá ${parentNumber ?? ""}`.trim() : `Lập ${label.toLowerCase()}`) : `Sửa ${label.toLowerCase()} nháp`;
  const hasFields = type === "contract";
  const amount = type === "payment_request" ? (editing ? (snap.amountRequested ?? editing.total) : source ? source.total : 0) : 0;
  const due = type === "payment_request" ? (editing ? snap.paymentDue : vnDatePlus(7)) : null;

  function values(): ContractValues {
    const v: ContractValues = {};
    if (hasFields) {
      if (signer.trim()) v.chuc_vu_nguoi_ky = signer.trim();
      if (start) v.ngay_bat_dau = start;
    }
    return v;
  }

  async function submit() {
    if (pending) return;
    setErrors({});
    setMessage(null);
    setPending(true);
    try {
      let child: Contract;
      if (props.mode === "create") {
        const body = { type, values: values() };
        child = await createChild(props.parent.id, body, keeper.keyFor(JSON.stringify(body)));
      } else {
        child = await updateContract(props.contract.id, { expected_version: props.contract.version, values: values() });
      }
      queryClient.setQueryData(contractKey(child.id), child);
      void queryClient.invalidateQueries({ queryKey: CONTRACTS_KEY });
      void queryClient.invalidateQueries({ queryKey: APPROVALS_KEY });
      if (props.mode === "create") {
        void queryClient.invalidateQueries({ queryKey: contractKey(props.parent.id) });
        props.onCreated(child);
      } else props.onSaved(child);
    } catch (error) {
      const info = errorMessage(error);
      const next: Record<string, string> = {};
      for (const [path, text] of Object.entries(info.fieldErrors)) next[path.replace(/^values\./, "")] = text;
      setErrors(next);
      setMessage(info.message);
      if (info.reload) {
        const id = props.mode === "create" ? props.parent.id : props.contract.id;
        void queryClient.invalidateQueries({ queryKey: contractKey(id) });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog label={title} variant="modal" onClose={onClose}>
      <DialogHeader title={title} onClose={onClose} />
      <form
        className="shell-scroll grid min-h-0 flex-1 content-start gap-s4 overflow-y-auto px-s5 py-s5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="text-md text-muted text-wrap-pretty">
          {DOC_TYPE_LABEL[type]} này lập từ {parentRef}; khách hàng, dòng hàng và giá lấy nguyên từ đó.
        </p>

        {type === "payment_request" ? (
          <>
            <ReadOnlyRow label="Số tiền đề nghị">{formatVietnameseMoney(amount)}</ReadOnlyRow>
            <ReadOnlyRow label="Hạn thanh toán">{formatIsoDate(due)}</ReadOnlyRow>
            <p className="text-sm text-muted">🔒 Giữ số tiền {parentRef}; hạn thanh toán do hệ thống tính (+7 ngày kể từ ngày lập).</p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-strong" data-testid="locked-lines-note">
              🔒 Giữ giá báo giá {parentNumber ?? ""}
            </p>
            <LockedLines snap={snap} />
            <TotalsBox data={{ subtotalExVat: snap.subtotalExVat, discountAmount: snap.discountAmount, vatGroups: snap.vatGroups, total: snap.total }} />
          </>
        )}

        {hasFields ? (
          <>
            <Field
              id="child-signer"
              label="Chức vụ người ký"
              value={signer}
              autoComplete="off"
              autoFocus
              {...(errors["chuc_vu_nguoi_ky"] ? { error: errors["chuc_vu_nguoi_ky"] } : {})}
              onChange={(e) => setSigner(e.target.value)}
            />
            <Field
              id="child-start"
              label="Ngày bắt đầu"
              type="date"
              value={start}
              hint="Bỏ trống: lấy ngày lập"
              {...(errors["ngay_bat_dau"] ? { error: errors["ngay_bat_dau"] } : {})}
              onChange={(e) => setStart(e.target.value)}
            />
          </>
        ) : null}

        {message ? <Alert tone="danger">{message}</Alert> : null}
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
      <div className="flex flex-wrap justify-end gap-s2 border-t border-line bg-sunken px-s5 py-s4">
        <Button type="button" variant="ghost" onClick={onClose}>Hủy</Button>
        {props.mode === "edit" && !hasFields ? null : (
          <Button type="button" loading={pending} onClick={() => void submit()}>
            {props.mode === "create" ? "Tạo & xem văn bản" : "Lưu"}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
