import { cn } from "../../lib/cn";
import { formatVietnameseMoney } from "../../lib/vn-money";
import { Field } from "../../ui";
import { VAT_OPTIONS, parseMoney, parseVatOption, priceIncVat } from "./product-view";

export const SELECT_CLASS =
  "motion-colors min-h-[var(--row-h)] w-full rounded-r2 border border-line-strong bg-surface px-s3 text-md text-body outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft";

export type PriceValues = { price: string; vat: string; from: string };

/** Giá chưa VAT · Thuế suất · Áp dụng từ ngày + the live "Giá gồm VAT" (display only; the server computes). */
export function PriceFields({
  idPrefix,
  values,
  onChange,
  errors,
  minDate,
  hint,
}: {
  idPrefix: string;
  values: PriceValues;
  onChange: (next: Partial<PriceValues>) => void;
  errors: Record<string, string>;
  minDate: string;
  hint?: string;
}) {
  const ex = parseMoney(values.price);
  return (
    <>
      <Field
        id={`${idPrefix}-price`}
        label="Giá chưa VAT"
        name="unit_price_ex_vat"
        inputMode="numeric"
        autoComplete="off"
        value={values.price}
        onChange={(e) => onChange({ price: e.target.value })}
        {...(errors["unit_price_ex_vat"] ? { error: errors["unit_price_ex_vat"] } : {})}
      />
      <div className="grid gap-s2">
        <label htmlFor={`${idPrefix}-vat`} className="text-md font-semibold leading-head text-body">Thuế suất</label>
        <select id={`${idPrefix}-vat`} className={cn(SELECT_CLASS)} value={values.vat} onChange={(e) => onChange({ vat: e.target.value })}>
          {VAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {errors["vat_rate_bps"] ? <p className="text-sm text-danger" role="alert">{errors["vat_rate_bps"]}</p> : null}
      </div>
      {ex !== null ? (
        <p className="font-mono text-md text-strong" data-testid="price-inc-vat">
          Giá gồm VAT: {formatVietnameseMoney(priceIncVat(ex, parseVatOption(values.vat)))}
        </p>
      ) : null}
      <Field
        id={`${idPrefix}-from`}
        label="Áp dụng từ ngày"
        name="effective_from"
        type="date"
        min={minDate}
        value={values.from}
        onChange={(e) => onChange({ from: e.target.value })}
        {...(hint ? { hint } : {})}
        {...(errors["effective_from"] ? { error: errors["effective_from"] } : {})}
      />
    </>
  );
}

/** Server path → the field key the modals use ("first_price.x" and "x" are the same field). */
export function fieldKey(path: string): string {
  return path.replace(/^first_price\./, "");
}

export function localFieldErrors(fieldErrors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(fieldErrors).map(([path, text]) => [fieldKey(path), text]));
}
