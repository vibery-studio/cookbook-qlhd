import { useEffect, useId, useRef, useState } from "react";
import { Button, Skeleton } from "../../ui";
import { cn } from "../../lib/cn";
import { formatVietnameseMoney } from "../../lib/vn-money";
import { newRow, type LineRow } from "./values";
import type { Product } from "./api";
import { vatRateText } from "./totals-box";

/** What a row shows for a product that is no longer in the on-sale list (an old draft): the snapshot's own words. */
export type KnownProduct = { id: string; code: string; name: string; unit: string };

const MAX_LINES = 50;
const LOCKED = "Chưa có giá hôm nay";

const matches = (p: Product, q: string) => {
  const t = q.trim();
  return t === "" || p.code.toLowerCase().includes(t.toLowerCase()) || p.name.toLowerCase().includes(t.toLowerCase());
};

function ProductCombobox({
  label,
  value,
  fallback,
  products,
  invalid,
  onPick,
}: {
  label: string;
  value: string;
  fallback: KnownProduct | undefined;
  products: { isPending: boolean; isError: boolean; items: Product[]; refetch: () => void };
  invalid: boolean;
  onPick: (productId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const picked = products.items.find((p) => p.id === value);
  const shown = picked ?? fallback;
  const options = products.items.filter((p) => matches(p, query));

  return (
    <div ref={rootRef} className="grid gap-s1">
      <label
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-invalid={invalid || undefined}
        className={cn(
          "motion-colors flex min-h-[var(--row-h)] w-full min-w-0 cursor-text items-center gap-s2 rounded-r2 border bg-surface px-s3 text-md text-body focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft",
          invalid ? "border-danger" : "border-line-strong",
        )}
        onClick={() => setOpen(true)}
      >
        {shown && query === "" ? (
          <span className="max-w-full truncate font-medium text-strong">
            {shown.code} · {shown.name}
          </span>
        ) : null}
        <input
          type="text"
          role="searchbox"
          aria-label={`Tìm ${label.toLocaleLowerCase("vi")}`}
          autoComplete="off"
          value={query}
          placeholder={shown ? "" : "Chọn hoặc gõ mã/tên"}
          className="min-h-[var(--row-h)] min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              event.stopPropagation();
              setOpen(false);
            }
          }}
        />
      </label>
      {open ? (
        <div className="grid gap-s2 rounded-r2 border border-line bg-surface p-s2">
          {products.isPending ? (
            <Skeleton className="h-[var(--row-h)]" />
          ) : products.isError ? (
            <div className="flex items-center justify-between gap-s3 px-s2 text-md text-danger">
              <span>Không tải được danh sách sản phẩm.</span>
              <Button type="button" variant="secondary" onClick={products.refetch}>Thử lại</Button>
            </div>
          ) : options.length === 0 ? (
            <p className="px-s2 py-s2 text-md text-muted">{query.trim() ? "Không có sản phẩm khớp." : "Chưa có sản phẩm đang bán."}</p>
          ) : (
            <div id={listId} role="listbox" aria-label="Sản phẩm" className="shell-scroll grid max-h-[calc(var(--row-h)*5)] overflow-y-auto">
              {options.map((p) => {
                const locked = p.price === null;
                const pick = () => {
                  if (locked) return;
                  onPick(p.id);
                  setQuery("");
                  setOpen(false);
                };
                return (
                  <div
                    key={p.id}
                    role="option"
                    aria-selected={p.id === value}
                    aria-disabled={locked || undefined}
                    tabIndex={0}
                    className={cn(
                      "motion-colors grid min-h-[var(--row-h)] content-center rounded-r2 px-s3 py-s1 aria-selected:bg-accent-soft",
                      locked ? "cursor-not-allowed text-muted" : "cursor-pointer hover:bg-hover focus-visible:bg-hover",
                    )}
                    onClick={pick}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        pick();
                      }
                    }}
                  >
                    <span className="truncate text-md font-medium text-strong">{p.code} · {p.name}</span>
                    <span className="truncate text-sm text-muted">
                      {locked ? `🔒 ${LOCKED}` : `${formatVietnameseMoney(p.price?.unit_price_ex_vat ?? 0)} / ${p.unit} · ${vatRateText(p.price?.vat_rate_bps ?? null)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export type LineItemsProps = {
  rows: LineRow[];
  onChange: (rows: LineRow[]) => void;
  products: { isPending: boolean; isError: boolean; items: Product[]; refetch: () => void };
  /** Snapshot product details for ids missing from the on-sale list. */
  known: ReadonlyMap<string, KnownProduct>;
  /** Server amount per product id (from the preview), shown as "Thành tiền". */
  amounts: ReadonlyMap<string, number>;
  rowErrors: Record<number, string>;
  blockError: string | undefined;
};

/** The "Dòng hàng" block: one product + quantity per row, price read-only and always the server's (DEC-13 A). */
export function LineItems({ rows, onChange, products, known, amounts, rowErrors, blockError }: LineItemsProps) {
  const update = (key: string, patch: Partial<LineRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <fieldset data-testid="line-items" className="grid gap-s3 border-0 p-0">
      <legend className="mb-s2 text-md font-semibold leading-head text-body">Dòng hàng</legend>
      {rows.map((row, i) => {
        const n = i + 1;
        const product = products.items.find((p) => p.id === row.productId);
        const error = rowErrors[i];
        const amount = amounts.get(row.productId);
        return (
          <div key={row.key} data-testid="line-row" className="grid gap-s2 rounded-r2 border border-line p-s3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-s2">
              <ProductCombobox
                label={`Sản phẩm dòng ${n}`}
                value={row.productId}
                fallback={known.get(row.productId)}
                products={products}
                invalid={Boolean(error)}
                onPick={(id) => update(row.key, { productId: id })}
              />
              <Button type="button" variant="ghost" aria-label={`Xóa dòng ${n}`} onClick={() => onChange(rows.filter((r) => r.key !== row.key))}>
                Xóa
              </Button>
            </div>
            <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-s3">
              <input
                type="text"
                inputMode="numeric"
                aria-label={`Số lượng dòng ${n}`}
                aria-invalid={error ? true : undefined}
                autoComplete="off"
                value={row.qty}
                onChange={(e) => update(row.key, { qty: e.target.value })}
                className={cn(
                  "motion-colors min-h-[var(--row-h)] w-full rounded-r2 border bg-surface px-s3 text-md text-body outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft",
                  error ? "border-danger" : "border-line-strong",
                )}
              />
              <p className="text-sm text-muted">
                {product?.price
                  ? `${formatVietnameseMoney(product.price.unit_price_ex_vat)} / ${product.unit} · chưa VAT · ${vatRateText(product.price.vat_rate_bps)}`
                  : "Giá do máy chủ tính"}
                {amount !== undefined ? <span className="ml-s2 font-mono text-strong">= {formatVietnameseMoney(amount)}</span> : null}
              </p>
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
          </div>
        );
      })}
      {blockError ? <p className="text-sm text-danger">{blockError}</p> : null}
      <div>
        <Button type="button" variant="secondary" disabled={rows.length >= MAX_LINES} onClick={() => onChange([...rows, newRow()])}>
          + Thêm dòng
        </Button>
      </div>
    </fieldset>
  );
}
