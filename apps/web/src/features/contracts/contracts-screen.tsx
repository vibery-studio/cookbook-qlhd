import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useCurrentUser } from "../../app/me";
import { cn } from "../../lib/cn";
import { formatVietnamTimestamp } from "../../lib/vn-date";
import { formatVietnameseMoney } from "../../lib/vn-money";
import { Button, EmptyState, ErrorState, Icon, LockedNote, Pill, Skeleton, Toast } from "../../ui";
import { useCustomer } from "../customers";
import { ContractDrawer } from "./contract-drawer";
import { ContractFormModal } from "./contract-form-modal";
import { CustomerCombobox } from "./customer-combobox";
import { errorMessage, useContractList, useTemplates, type ContractListItem } from "./api";
import { hasFilters, parseListParams } from "./list-params";
import { STATUS_TONE, TABS, numberLabel, statusLabel } from "./status";

const ULID = /^[0-9A-Z]{26}$/;
const MOBILE_QUERY = "(max-width: 767.98px)";

function useIsMobile(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(MOBILE_QUERY);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

const SELECT_CLASS =
  "motion-colors min-h-[var(--row-h)] w-full rounded-r2 border border-line-strong bg-surface px-s3 text-md text-body outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft";

export function ContractsScreen() {
  const me = useCurrentUser();
  const canWrite = me.permissions.includes("contract:write");
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const isMobile = useIsMobile();
  const { tab, filters } = parseListParams(sp);
  const paperOpen = Boolean(id) && location.pathname.endsWith("/van-ban");

  const [create, setCreate] = useState<{ templateId?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useContractList(tab === "all" ? undefined : tab, filters);
  const templates = useTemplates();
  const customerFilter = useCustomer(filters.customerId);

  // the search string that survives navigation between list <-> drawer <-> paper (tab + filters, never `tao`)
  const keep = new URLSearchParams(sp);
  keep.delete("tao");
  const search = keep.toString() ? `?${keep.toString()}` : "";

  // /hop-dong?tao=<template_id> (the templates screen): open the create modal, then drop the param
  const tao = sp.get("tao");
  useEffect(() => {
    if (!tao) return;
    if (canWrite) setCreate(ULID.test(tao) ? { templateId: tao } : {});
    const next = new URLSearchParams(sp);
    next.delete("tao");
    setSp(next, { replace: true });
  }, [tao, canWrite, sp, setSp]);

  // notices handed over by navigation (e.g. "Đã xóa nháp") and by actions; they fade by themselves
  const handedOver = (location.state as { notice?: string } | null)?.notice;
  useEffect(() => {
    if (handedOver) setNotice(handedOver);
  }, [handedOver]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const goList = useCallback((state?: { notice: string }) => void navigate({ pathname: "/hop-dong", search }, state ? { state } : undefined), [navigate, search]);
  const goDetail = useCallback((cid: string) => void navigate({ pathname: `/hop-dong/${cid}`, search }), [navigate, search]);
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    setSp(next);
  };
  const clearFilters = () => {
    const next = new URLSearchParams(sp);
    for (const k of ["khach", "nguoi-tao", "mau"]) next.delete(k);
    setSp(next);
  };

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = list.data?.pages[list.data.pages.length - 1]?.counts;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  const listError = list.isError ? errorMessage(list.error) : null;
  const filtered = hasFilters(filters);
  const emptyAll = !list.isPending && !list.isError && total === 0 && !filtered;

  const createButton = canWrite ? (
    <Button type="button" className="max-mobile:w-full" onClick={() => setCreate({})}>+ Tạo hợp đồng</Button>
  ) : (
    <LockedNote>Bạn không có quyền tạo hợp đồng (cần quyền contract:write).</LockedNote>
  );

  const templateName = (tid: string | undefined) => templates.data?.find((t) => t.id === tid)?.name ?? "Mẫu hợp đồng";

  return (
    <section className="grid gap-s5" aria-label="Danh sách hợp đồng">
      <div className="flex flex-wrap items-start justify-between gap-s4">
        <div className="grid gap-s2">
          <h1 className="text-2xl font-bold leading-head text-strong">Hợp đồng</h1>
          <p className="text-md text-muted text-wrap-pretty">Mọi hợp đồng của cả nhóm. Bấm một dòng để xem chi tiết, duyệt và phát hành.</p>
        </div>
        {emptyAll ? null : createButton}
      </div>

      {emptyAll ? null : (
        <div className="grid gap-s3">
          <div role="tablist" aria-label="Trạng thái hợp đồng" className="flex flex-wrap gap-s1 border-b border-line">
            {TABS.map((t) => {
              const n = counts ? (t.value === "all" ? total : counts[t.value]) : undefined;
              const active = tab === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setParam("tab", t.value === "all" ? null : t.value)}
                  className={cn(
                    "motion-colors -mb-px min-h-[var(--row-h)] border-b-2 px-s3 text-md font-semibold hover:text-strong",
                    active ? "border-accent text-accent" : "border-transparent text-muted",
                  )}
                >
                  {t.label}
                  {n !== undefined ? <span className="ml-s2 font-mono text-sm font-medium text-muted">{n}</span> : null}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-3 items-end gap-s3 max-mobile:grid-cols-1">
            <CustomerCombobox
              label="Khách hàng"
              value={filters.customerId ? { id: filters.customerId, name: customerFilter.data?.name ?? "Đang tải…" } : null}
              onChange={(c) => setParam("khach", c.id)}
            />
            <div className="grid gap-s2">
              <label htmlFor="filter-creator" className="text-md font-semibold leading-head text-body">Người tạo</label>
              <select id="filter-creator" className={SELECT_CLASS} value={filters.createdBy ?? ""} onChange={(e) => setParam("nguoi-tao", e.target.value || null)}>
                <option value="">Tất cả</option>
                <option value={me.id}>Của tôi</option>
              </select>
            </div>
            <div className="grid gap-s2">
              <label htmlFor="filter-template" className="text-md font-semibold leading-head text-body">Mẫu hợp đồng</label>
              <select id="filter-template" className={SELECT_CLASS} value={filters.templateId ?? ""} onChange={(e) => setParam("mau", e.target.value || null)}>
                <option value="">Tất cả</option>
                {(templates.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          {filtered ? (
            <div className="flex flex-wrap items-center gap-s2" aria-label="Bộ lọc đang dùng">
              {filters.customerId ? <Chip label={`Khách: ${customerFilter.data?.name ?? "…"}`} onRemove={() => setParam("khach", null)} /> : null}
              {filters.createdBy ? <Chip label={filters.createdBy === me.id ? "Người tạo: Của tôi" : "Người tạo: đã chọn"} onRemove={() => setParam("nguoi-tao", null)} /> : null}
              {filters.templateId ? <Chip label={`Mẫu: ${templateName(filters.templateId)}`} onRemove={() => setParam("mau", null)} /> : null}
              <Button type="button" variant="ghost" onClick={clearFilters}>Xóa bộ lọc</Button>
            </div>
          ) : null}
        </div>
      )}

      {list.isPending ? <ListSkeleton /> : null}
      {listError ? (
        listError.status === 403 ? (
          <LockedNote>{listError.message.replace(/^🔒\s*/, "")}</LockedNote>
        ) : (
          <ErrorState message={listError.message} onRetry={() => void list.refetch()} />
        )
      ) : null}
      {emptyAll ? <EmptyState title="Chưa có hợp đồng nào — Tạo hợp đồng." action={createButton} /> : null}
      {!list.isPending && !list.isError && !emptyAll && items.length === 0 ? (
        filtered ? (
          <EmptyState title="Không có hợp đồng khớp bộ lọc — Xóa bộ lọc." action={<Button type="button" variant="secondary" onClick={clearFilters}>Xóa bộ lọc</Button>} />
        ) : (
          <EmptyState title="Không có hợp đồng ở trạng thái này." />
        )
      ) : null}

      {items.length > 0 ? (
        <>
          {isMobile ? (
            <ul className="grid gap-s3" aria-label="Các hợp đồng">
              {items.map((c) => (
                <li key={c.id}>
                  <ContractCard item={c} search={search} />
                </li>
              ))}
            </ul>
          ) : (
            <ContractTable items={items} search={search} onOpen={goDetail} />
          )}
          {list.hasNextPage ? (
            <Button type="button" variant="secondary" className="justify-self-center" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              Xem thêm
            </Button>
          ) : null}
        </>
      ) : null}

      {id && ULID.test(id) ? (
        <ContractDrawer
          key={id}
          id={id}
          paperOpen={paperOpen}
          onClose={() => goList()}
          onOpenPaper={() => void navigate({ pathname: `/hop-dong/${id}/van-ban`, search })}
          onClosePaper={() => goDetail(id)}
          onGoDetail={goDetail}
          onDeleted={(message) => goList({ notice: message })}
          notify={setNotice}
        />
      ) : null}

      {id && !ULID.test(id) ? (
        <EmptyState title="Không tìm thấy hợp đồng." action={<Button variant="secondary" onClick={() => goList()}>Về danh sách</Button>} />
      ) : null}

      {create ? (
        <ContractFormModal
          mode="create"
          {...(create.templateId ? { templateId: create.templateId } : {})}
          onClose={() => setCreate(null)}
          onCreated={(c) => {
            setCreate(null);
            void navigate({ pathname: `/hop-dong/${c.id}/van-ban`, search });
          }}
        />
      ) : null}

      {notice ? createPortal(<Toast tone="success">{notice}</Toast>, document.body) : null}
    </section>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex min-h-[var(--row-h)] max-w-full items-center gap-s2 rounded-full border border-accent-border bg-accent-soft pl-s3 text-md text-strong">
      <span className="truncate">{label}</span>
      <button type="button" aria-label={`Bỏ lọc: ${label}`} onClick={onRemove} className="motion-colors inline-grid min-h-[var(--row-h)] min-w-[var(--row-h)] place-items-center rounded-full text-muted hover:text-strong">
        <Icon name="close" />
      </button>
    </span>
  );
}

function ContractTable({ items, search, onOpen }: { items: ContractListItem[]; search: string; onOpen: (id: string) => void }) {
  const head = "px-s3 py-s2 text-left text-sm font-semibold text-muted";
  return (
    <div className="overflow-hidden rounded-r3 border border-line bg-surface">
      <table className="w-full table-fixed border-collapse text-md">
        <thead className="bg-sunken">
          <tr>
            <th className={cn(head, "w-[18%]")}>Mã</th>
            <th className={cn(head, "w-[16%]")}>Hợp đồng</th>
            <th className={cn(head, "w-[20%]")}>Khách hàng</th>
            <th className={cn(head, "w-[14%] text-right")}>Giá trị</th>
            <th className={cn(head, "w-[12%]")}>Trạng thái</th>
            <th className={cn(head, "w-[10%]")}>Người tạo</th>
            <th className={cn(head, "w-[10%]")}>Cập nhật</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr
              key={c.id}
              data-testid="contract-row"
              className="motion-colors cursor-pointer border-t border-line hover:bg-hover"
              onClick={() => onOpen(c.id)}
            >
              <td className="truncate px-s3 py-s3 font-mono text-strong" title={numberLabel(c.number, c.status)}>
                <Link to={{ pathname: `/hop-dong/${c.id}`, search }} onClick={(e) => e.stopPropagation()} className="hover:underline focus-visible:underline">
                  {numberLabel(c.number, c.status)}
                </Link>
              </td>
              <td className="truncate px-s3 py-s3 text-body" title={c.template_name}>{c.template_name}</td>
              <td className="truncate px-s3 py-s3 text-body" title={c.customer_name}>{c.customer_name}</td>
              <td className="px-s3 py-s3 text-right font-mono text-strong">{formatVietnameseMoney(c.total)}</td>
              <td className="px-s3 py-s3"><Pill tone={STATUS_TONE[c.status]}>{statusLabel(c.status)}</Pill></td>
              <td className="truncate px-s3 py-s3 text-muted" title={c.created_by_name ?? undefined}>{c.created_by_name ?? "—"}</td>
              <td className="px-s3 py-s3 text-muted">{formatVietnamTimestamp(c.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContractCard({ item: c, search }: { item: ContractListItem; search: string }) {
  return (
    <Link
      to={{ pathname: `/hop-dong/${c.id}`, search }}
      data-testid="contract-card"
      className="motion-colors grid min-h-[var(--row-h)] gap-s2 rounded-r3 border border-line bg-surface p-s4 hover:bg-hover"
    >
      <div className="flex items-start justify-between gap-s3">
        <span className="min-w-0 truncate font-mono text-md font-semibold text-strong">{numberLabel(c.number, c.status)}</span>
        <Pill tone={STATUS_TONE[c.status]}>{statusLabel(c.status)}</Pill>
      </div>
      <p className="truncate text-md text-body">{c.customer_name}</p>
      <div className="flex items-center justify-between gap-s3 text-sm text-muted">
        <span className="truncate">{c.template_name}</span>
        <span className="font-mono text-md font-semibold text-strong">{formatVietnameseMoney(c.total)}</span>
      </div>
      <p className="text-sm text-muted">{c.created_by_name ?? "—"} · {formatVietnamTimestamp(c.updated_at)}</p>
    </Link>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-s2" aria-busy="true" aria-label="Đang tải hợp đồng">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-row w-full" />
      ))}
    </div>
  );
}
