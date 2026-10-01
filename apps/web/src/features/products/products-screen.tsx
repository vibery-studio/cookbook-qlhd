import { useState } from "react";
import { useCurrentUser } from "../../app/me";
import { cn } from "../../lib/cn";
import { Button, EmptyState, ErrorState, Field, LockedNote, Pill, Skeleton, Toast } from "../../ui";
import { useDebouncedValue } from "../customers/use-debounced-value";
import { productError, useProducts, type Product, type ProductTab } from "./api";
import { ProductDrawer } from "./product-drawer";
import { ProductModal } from "./product-modal";
import { KIND_LABEL, NO_RIGHT_TEXT, durationLabel, formatPlainMoney, nextPriceText, vatLabel } from "./product-view";
import { useIsMobile } from "./use-is-mobile";

const TABS: ReadonlyArray<{ id: ProductTab; label: string }> = [
  { id: "all", label: "Tất cả" },
  { id: "service", label: "Dịch vụ" },
  { id: "goods", label: "Hàng hóa" },
  { id: "inactive", label: "Ngừng bán" },
];

export function ProductsScreen() {
  const me = useCurrentUser();
  const canWrite = me.permissions.includes("product:write");
  const canPrice = me.permissions.includes("price:write");
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<ProductTab>("all");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), 300);
  const list = useProducts(tab, q);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const items = list.data?.items ?? [];
  const selected = items.find((p) => p.id === selectedId) ?? null;
  const error = list.isError ? productError(list.error) : null;
  const emptyAll = !list.isPending && !list.isError && items.length === 0 && tab === "all" && !q;

  const addButton = canWrite ? <Button type="button" className="max-mobile:w-full" onClick={() => { setNotice(null); setAdding(true); }}>+ Thêm sản phẩm</Button> : null;

  return (
    <section className="grid gap-s5" aria-label="Sản phẩm và giá">
      <div className="flex flex-wrap items-start justify-between gap-s4">
        <div className="grid gap-s2">
          <h1 className="text-2xl font-bold leading-head text-strong">Sản phẩm &amp; giá</h1>
          <p className="text-md text-muted text-wrap-pretty">Giá tính theo ngày lập tài liệu. Bấm một dòng để xem lịch sử giá.</p>
        </div>
        {emptyAll ? null : addButton}
      </div>
      {canWrite ? null : <LockedNote>{NO_RIGHT_TEXT}</LockedNote>}

      <div role="tablist" aria-label="Loại sản phẩm" className="flex flex-wrap gap-s1 border-b border-line">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={cn(
                "motion-colors -mb-px min-h-[var(--row-h)] border-b-2 px-s3 text-md font-semibold hover:text-strong",
                active ? "border-accent text-accent" : "border-transparent text-muted",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <Field id="product-search" label="Tìm sản phẩm" name="product-search" type="search" placeholder="Tìm theo mã hoặc tên" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />

      {list.isPending ? <ListSkeleton /> : null}
      {error ? (
        error.forbidden ? <LockedNote>{error.message.replace(/^🔒\s*/, "")}</LockedNote> : <ErrorState message={error.message} onRetry={() => void list.refetch()} />
      ) : null}
      {emptyAll ? <EmptyState title="Chưa có sản phẩm nào — Thêm sản phẩm" action={addButton ?? <LockedNote>{NO_RIGHT_TEXT}</LockedNote>} /> : null}
      {!list.isPending && !list.isError && items.length === 0 && !emptyAll ? (
        <EmptyState
          title={q ? `Không có sản phẩm khớp ‘${q}’ — Xóa tìm kiếm` : "Không có sản phẩm ở nhóm này."}
          action={q ? <Button type="button" variant="secondary" onClick={() => setSearch("")}>Xóa tìm kiếm</Button> : undefined}
        />
      ) : null}
      {items.length > 0 ? (
        isMobile ? <ProductCards items={items} onOpen={setSelectedId} /> : <ProductTable items={items} onOpen={setSelectedId} />
      ) : null}

      {selected ? <ProductDrawer key={selected.id} summary={selected} onClose={() => setSelectedId(null)} notify={setNotice} /> : null}
      {adding ? <ProductModal canPrice={canPrice} onClose={() => setAdding(false)} onSaved={(message) => { setAdding(false); setNotice(message); }} /> : null}
      {notice ? <Toast tone="success">{notice}</Toast> : null}
    </section>
  );
}

const head = "px-s3 py-s2 text-left text-sm font-semibold text-muted";

function ProductTable({ items, onOpen }: { items: Product[]; onOpen: (id: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-r3 border border-line bg-surface">
      <table className="w-full min-w-[960px] table-fixed border-collapse text-md">
        <thead className="bg-sunken">
          <tr>
            <th className={cn(head, "w-[11%]")}>Mã</th>
            <th className={cn(head, "w-[19%]")}>Tên</th>
            <th className={cn(head, "w-[9%]")}>Loại</th>
            <th className={cn(head, "w-[6%]")}>ĐVT</th>
            <th className={cn(head, "w-[8%]")}>Thời hạn</th>
            <th className={cn(head, "w-[11%] text-right")}>Giá chưa VAT</th>
            <th className={cn(head, "w-[8%]")}>Thuế suất</th>
            <th className={cn(head, "w-[11%] text-right")}>Giá gồm VAT</th>
            <th className={cn(head, "w-[17%] text-right")}>Sắp áp dụng</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} data-testid="product-row" className="motion-colors h-[var(--row-h)] cursor-pointer border-t border-line hover:bg-hover" onClick={() => onOpen(p.id)}>
              <td className="truncate px-s3 font-mono text-strong">
                <button type="button" className="hover:underline focus-visible:underline" onClick={(e) => { e.stopPropagation(); onOpen(p.id); }}>{p.code}</button>
              </td>
              <td className="truncate px-s3 text-body" title={p.name}>{p.name}{p.active ? null : <Pill tone="neutral" className="ml-s2">Ngừng bán</Pill>}</td>
              <td className="whitespace-nowrap px-s3"><Pill tone={p.kind === "service" ? "accent" : "neutral"}>{KIND_LABEL[p.kind]}</Pill></td>
              <td className="truncate px-s3 text-muted">{p.unit}</td>
              <td className="px-s3 text-muted">{durationLabel(p.duration_value, p.duration_unit)}</td>
              <td className="px-s3 text-right font-mono text-strong">{p.price ? formatPlainMoney(p.price.unit_price_ex_vat) : <span className="font-sans text-muted">Chưa có giá</span>}</td>
              <td className="px-s3 font-mono text-body">{p.price ? vatLabel(p.price.vat_rate_bps) : "—"}</td>
              <td className="px-s3 text-right font-mono text-body">{p.price ? formatPlainMoney(p.price.unit_price_inc_vat) : "—"}</td>
              <td className="px-s3 text-right font-mono text-muted">{nextPriceText(p.next_price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductCards({ items, onOpen }: { items: Product[]; onOpen: (id: string) => void }) {
  return (
    <ul className="grid gap-s3" aria-label="Các sản phẩm">
      {items.map((p) => (
        <li key={p.id}>
          <button type="button" data-testid="product-row" onClick={() => onOpen(p.id)} className="motion-colors grid w-full gap-s2 rounded-r3 border border-line bg-surface p-s4 text-left hover:border-line-strong hover:bg-hover">
            <div className="flex items-start justify-between gap-s3">
              <div className="min-w-0">
                <p className="font-mono text-md font-semibold text-strong">{p.code}</p>
                <p className="truncate text-md text-body">{p.name}{p.active ? null : <Pill tone="neutral" className="ml-s2">Ngừng bán</Pill>}</p>
              </div>
              <Pill tone={p.kind === "service" ? "accent" : "neutral"}>{KIND_LABEL[p.kind]}</Pill>
            </div>
            <p className="text-sm text-muted">{p.unit} · {durationLabel(p.duration_value, p.duration_unit)}</p>
            <p className="font-mono text-md text-strong">
              {p.price ? `${formatPlainMoney(p.price.unit_price_ex_vat)} · ${vatLabel(p.price.vat_rate_bps)} · gồm VAT ${formatPlainMoney(p.price.unit_price_inc_vat)}` : "Chưa có giá"}
            </p>
            {p.next_price ? <p className="font-mono text-sm text-muted">Sắp áp dụng: {nextPriceText(p.next_price)}</p> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-s2" aria-busy="true" aria-label="Đang tải sản phẩm">
      {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[var(--row-h)] w-full" />)}
    </div>
  );
}
