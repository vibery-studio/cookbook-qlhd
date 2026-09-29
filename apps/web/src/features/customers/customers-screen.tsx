import { useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "../../app/me";
import { queryClient } from "../../lib/client";
import { Button, EmptyState, ErrorState, Field, LockedNote, Skeleton, Toast } from "../../ui";
import { customerError, withoutLockPrefix } from "./errors";
import { CustomerModal, type CustomerModalProps } from "./customer-modal";
import { useCustomers, type Customer } from "./api";
import { formatIssuedLine } from "./issued-line";
import { useDebouncedValue } from "./use-debounced-value";

type ModalState = CustomerModalProps;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]?.[0] ?? ""}${words[words.length - 1]?.[0] ?? ""}`.toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || "KH";
}

export function CustomersScreen() {
  const user = useCurrentUser();
  const canWrite = user.permissions.includes("contract:write");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const customers = useCustomers(debouncedSearch);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const items = useMemo(() => customers.data?.pages.flatMap((page) => page.items) ?? [], [customers.data]);
  const queryError = customers.isError ? customerError(customers.error) : null;
  const isForbidden = queryError?.forbidden ?? false;

  useEffect(() => {
    if (isForbidden) void queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [isForbidden]);

  function openCreate() {
    setNotice(null);
    setModal({ mode: "create", idempotencyKey: crypto.randomUUID(), onClose: () => setModal(null), onSaved: (message) => { setModal(null); setNotice(message); } });
  }

  function openEdit(customer: Customer) {
    setNotice(null);
    setModal({ mode: "edit", customer, onClose: () => setModal(null), onSaved: (message) => { setModal(null); setNotice(message); } });
  }

  // an empty list carries its own single action (EmptyState); the toolbar would repeat it
  const emptyList = !customers.isPending && !customers.isError && items.length === 0 && !debouncedSearch;
  const emptyAction = debouncedSearch ? (
    <Button type="button" variant="secondary" onClick={() => setSearch("")}>Xóa tìm kiếm</Button>
  ) : canWrite ? (
    <Button type="button" onClick={openCreate}>+ Thêm khách</Button>
  ) : (
    <LockedNote>Bạn không có quyền thêm khách hàng.</LockedNote>
  );

  return (
    <section className="grid gap-s5" aria-label="Danh sách khách hàng">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-s4 max-mobile:grid-cols-1">
        <Field
          id="customer-search"
          label="Tìm khách hàng"
          name="customer-search"
          type="search"
          placeholder="Tìm theo tên, MST, SĐT hoặc email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoComplete="off"
        />
        {emptyList ? null : canWrite ? (
          <Button type="button" className="max-mobile:w-full" onClick={openCreate}>+ Thêm khách</Button>
        ) : (
          <LockedNote>Bạn không có quyền thêm hoặc sửa khách hàng.</LockedNote>
        )}
      </div>

      {queryError?.forbidden ? <LockedNote>{withoutLockPrefix(queryError.message)}</LockedNote> : null}
      {customers.isPending ? <CustomerSkeleton /> : null}
      {!customers.isPending && customers.isError && !queryError?.forbidden ? (
        <div className="grid gap-s2">
          <ErrorState message={queryError?.message ?? "Hệ thống đang bận, thử lại sau."} onRetry={() => void customers.refetch()} />
          {queryError?.requestId ? <p className="font-mono text-sm text-faint">Mã hỗ trợ: {queryError.requestId}</p> : null}
        </div>
      ) : null}
      {!customers.isPending && !customers.isError && items.length === 0 ? (
        <EmptyState
          title={debouncedSearch ? `Không có khách khớp ‘${debouncedSearch}’ — Xóa tìm kiếm` : "Chưa có khách nào — thêm khách đầu tiên để bắt đầu."}
          action={emptyAction}
        />
      ) : null}
      {!customers.isPending && !customers.isError && items.length > 0 ? (
        <>
          <ul className="grid grid-cols-3 gap-s4 max-mobile:grid-cols-1" aria-label="Các khách hàng">
            {items.map((customer) => <CustomerCard key={customer.id} customer={customer} canWrite={canWrite} onEdit={openEdit} />)}
          </ul>
          {customers.hasNextPage ? (
            <Button type="button" variant="secondary" className="justify-self-center" loading={customers.isFetchingNextPage} onClick={() => void customers.fetchNextPage()}>
              Xem thêm
            </Button>
          ) : null}
        </>
      ) : null}

      {notice ? <Toast tone="success">{notice}</Toast> : null}
      {modal ? <CustomerModal key={modal.mode === "create" ? modal.idempotencyKey : modal.customer.id} {...modal} /> : null}
    </section>
  );
}

function CustomerCard({ customer, canWrite, onEdit }: { customer: Customer; canWrite: boolean; onEdit: (customer: Customer) => void }) {
  return (
    <li className="min-w-0">
      <article className="grid min-w-0 gap-s4 rounded-r3 border border-line bg-surface p-s4 motion-colors hover:border-line-strong hover:bg-hover">
        <div className="flex min-w-0 items-start gap-s3">
          <div className="grid h-[var(--row-h)] w-[var(--row-h)] shrink-0 place-items-center rounded-r2 bg-accent-soft text-md font-bold text-accent" aria-hidden="true">
            {initials(customer.name)}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-md font-semibold leading-head text-strong" title={customer.name}>{customer.name}</h2>
            <p className="truncate text-sm text-muted" title={customer.contact_person ?? undefined}>{customer.contact_person || "Chưa có người đại diện"}</p>
          </div>
        </div>
        <div className="grid gap-s1 text-sm text-muted">
          <p className="truncate" title={customer.tax_code ?? undefined}>{customer.tax_code ? `MST ${customer.tax_code}` : "Chưa có mã số thuế"}</p>
          <p className="truncate" title={customer.phone ?? undefined}>{customer.phone || "Chưa có số điện thoại"}</p>
        </div>
        <p className="text-sm font-medium text-body" data-testid="customer-issued">{formatIssuedLine(customer.issued_count, customer.issued_total)}</p>
        {canWrite ? <Button type="button" variant="secondary" className="w-full" onClick={() => onEdit(customer)}>Sửa thông tin</Button> : null}
      </article>
    </li>
  );
}

function CustomerSkeleton() {
  return (
    <ul className="grid grid-cols-3 gap-s4 max-mobile:grid-cols-1" aria-busy="true" aria-label="Đang tải khách hàng">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="grid gap-s4 rounded-r3 border border-line bg-surface p-s4">
          <div className="flex items-start gap-s3">
            <Skeleton className="h-[var(--row-h)] w-[var(--row-h)] shrink-0" />
            <div className="grid min-w-0 flex-1 gap-s2">
              <Skeleton className="h-s4 w-3/4" />
              <Skeleton className="h-s3 w-1/2" />
            </div>
          </div>
          <div className="grid gap-s2">
            <Skeleton className="h-s3 w-2/3" />
            <Skeleton className="h-s3 w-1/2" />
          </div>
          <Skeleton className="h-[var(--row-h)] w-full" />
        </li>
      ))}
    </ul>
  );
}
