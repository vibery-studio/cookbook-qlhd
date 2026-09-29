import { useEffect, useId, useRef, useState } from "react";
import { Button, Skeleton } from "../../ui";
import { cn } from "../../lib/cn";
import { useCustomerSearch, type Customer } from "../customers";

export type PickedCustomer = { id: string; name: string };

/**
 * Customer picker: an ARIA 1.1 combobox (the label is the combobox, the input inside it takes the typing).
 * The customer list is only fetched while the list is open (no customer data loaded just by showing the screen).
 */
export function CustomerCombobox({
  label,
  value,
  onChange,
  onAddNew,
  invalid,
  autoFocus,
}: {
  label: string;
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer) => void;
  /** Present only when the user may create customers (contract:write). */
  onAddNew?: () => void;
  invalid?: boolean;
  autoFocus?: boolean;
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

  function pick(customer: Customer) {
    onChange({ id: customer.id, name: customer.name });
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="grid gap-s2">
      <span className="text-md font-semibold leading-head text-body">{label}</span>
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
        {value && query === "" ? <span className="max-w-full truncate font-medium text-strong">{value.name}</span> : null}
        <input
          type="text"
          role="searchbox"
          aria-label={`Tìm ${label.toLocaleLowerCase("vi")}`}
          data-autofocus={autoFocus ? "" : undefined}
          autoComplete="off"
          value={query}
          placeholder={value ? "" : "Chọn hoặc gõ để tìm"}
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
          <Results id={listId} query={query} selectedId={value?.id} onPick={pick} />
          {onAddNew ? (
            <Button type="button" variant="ghost" className="justify-start" onClick={onAddNew}>
              + Thêm khách mới
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Results({ id, query, selectedId, onPick }: { id: string; query: string; selectedId: string | undefined; onPick: (c: Customer) => void }) {
  const search = useCustomerSearch(query);
  if (search.isPending) return <Skeleton className="h-[var(--row-h)]" />;
  if (search.isError) {
    return (
      <div className="flex items-center justify-between gap-s3 px-s2 text-md text-danger">
        <span>Không tải được danh sách khách.</span>
        <Button type="button" variant="secondary" onClick={search.refetch}>Thử lại</Button>
      </div>
    );
  }
  if (search.items.length === 0) return <p className="px-s2 py-s2 text-md text-muted">{query.trim() ? "Không có khách khớp." : "Chưa có khách nào."}</p>;
  return (
    <>
      <div id={id} role="listbox" aria-label="Khách hàng" className="shell-scroll grid max-h-[calc(var(--row-h)*5)] overflow-y-auto">
        {search.items.map((customer) => (
          <div
            key={customer.id}
            role="option"
            aria-selected={customer.id === selectedId}
            tabIndex={0}
            className="motion-colors grid min-h-[var(--row-h)] cursor-pointer content-center rounded-r2 px-s3 py-s1 hover:bg-hover focus-visible:bg-hover aria-selected:bg-accent-soft"
            onClick={() => onPick(customer)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPick(customer);
              }
            }}
          >
            <span className="truncate text-md font-medium text-strong">{customer.name}</span>
            <span className="truncate text-sm text-muted">{[customer.tax_code && `MST ${customer.tax_code}`, customer.phone].filter(Boolean).join(" · ") || "Chưa có MST/SĐT"}</span>
          </div>
        ))}
      </div>
      {search.hasMore ? (
        <Button type="button" variant="secondary" loading={search.isLoadingMore} onClick={search.loadMore}>
          Xem thêm
        </Button>
      ) : null}
    </>
  );
}
