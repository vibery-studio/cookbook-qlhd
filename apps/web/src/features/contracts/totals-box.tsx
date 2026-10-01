import type { ReactNode } from "react";
import { formatVietnameseMoney } from "../../lib/vn-money";
import type { VatRateBps } from "./snapshot";

/** "KCT" for no-VAT, else "Thuế GTGT 10%" (bps → percent, integer). */
export function vatGroupLabel(rate: VatRateBps): string {
  return rate === null ? "KCT" : `Thuế GTGT ${rate / 100}%`;
}
/** Per-line rate cell: "KCT" · "10%". */
export function vatRateText(rate: VatRateBps): string {
  return rate === null ? "KCT" : `${rate / 100}%`;
}

export type TotalsData = {
  subtotalExVat: number;
  discountAmount: number;
  vatGroups: readonly { vatRateBps: VatRateBps; vat: number }[];
  total: number;
};

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-s3 py-s1">
      <span className={strong ? "text-md font-bold text-strong" : "text-md text-body"}>{label}</span>
      <span className={strong ? "font-mono text-right text-lg font-bold text-strong" : "font-mono text-right text-md text-strong"}>{value}</span>
    </div>
  );
}

/** The totals block shared by the form (from POST /pricing/preview) and the drawer (from the snapshot): same rows, same numbers. */
export function TotalsBox({ data, note, busy }: { data: TotalsData; note?: ReactNode; busy?: boolean }) {
  return (
    <div data-testid="totals" aria-busy={busy || undefined} className={busy ? "grid rounded-r2 border border-line bg-sunken px-s3 py-s2 opacity-70" : "grid rounded-r2 border border-line bg-sunken px-s3 py-s2"}>
      <Row label="Tiền trước thuế" value={formatVietnameseMoney(data.subtotalExVat)} />
      <Row label="Giảm giá" value={`${data.discountAmount > 0 ? "−" : ""}${formatVietnameseMoney(data.discountAmount)}`} />
      {data.vatGroups.map((g) => (
        <Row key={g.vatRateBps ?? "kct"} label={vatGroupLabel(g.vatRateBps)} value={formatVietnameseMoney(g.vat)} />
      ))}
      <div className="mt-s1 border-t border-line pt-s1">
        <Row label="Tổng thanh toán" value={formatVietnameseMoney(data.total)} strong />
      </div>
      {note ? <p className="pt-s1 text-sm text-muted">{note}</p> : null}
    </div>
  );
}
