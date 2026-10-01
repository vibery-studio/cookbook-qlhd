import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useCurrentUser } from "../../app/me";
import { cn } from "../../lib/cn";
import { formatVietnamTimestamp } from "../../lib/vn-date";
import { formatVietnameseMoney } from "../../lib/vn-money";
import { Button, EmptyState, ErrorState, Icon, LockedNote, Pill, Skeleton, Toast, type PillTone } from "../../ui";
import { useCustomer } from "../customers";
import { ContractDrawer } from "./contract-drawer";
import { ContractFormModal } from "./contract-form-modal";
import { CustomerCombobox } from "./customer-combobox";
import { errorMessage, useContractList, useTemplates, type ContractListItem } from "./api";
import { DOC_TYPE_LABEL, DOC_TYPE_SHORT, type DocType } from "./doc-type-labels";
import { TYPE_TABS, createLabel, creatableTypes, hasFilters, parseListParams, typeEmptyTitle } from "./list-params";
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

const TYPE_TONE: Record<DocType, PillTone> = { quote: "accent", contract: "neutral", payment_request: "pending", delivery_note: "approved" };

/** "+ Tạo": a menu of the types this user may make (BG · HĐ · PXK; DNTT is made from an issued contract). */
function CreateMenu({ types, onPick, className }: { types: readonly DocType[]; onPick: (t: DocType) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={root} className={cn("relative", className)}>
      <Button type="button" aria-haspopup="menu" aria-expanded={open} className="max-mobile:w-full" onClick={() => setOpen((o) => !o)}>+ Tạo</Button>
      {open ? (
        <div role="menu" aria-label="Tạo tài liệu" className="absolute right-0 z-10 mt-s1 grid min-w-[16rem] gap-s1 rounded-r3 border border-line bg-surface p-s2 shadow-lg max-mobile:left-0">
          {types.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitem"
              className="motion-colors min-h-[var(--row-h)] rounded-r2 px-s3 text-left text-md font-medium text-strong hover:bg-hover focus-visible:bg-hover"
              onClick={() => {
                setOpen(false);
                onPick(t);
              }}
            >
              {DOC_TYPE_LABEL[t]}
            </button>
          ))}
          <p className="px-s3 py-s2 text-sm text-muted">Đề nghị thanh toán: lập từ hợp đồng đã phát hành</p>
        </div>
      ) : null}
    </div>
  );
}

export function ContractsScreen() {
  const me = useCurrentUser();
  const creatable = creatableTypes(me.permissions);
  const canWrite = creatable.length > 0;
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const isMobile = useIsMobile();
  const { tab, type, filters } = parseListParams(sp);
  const paperOpen = Boolean(id) && location.pathname.endsWith("/van-ban");

  const [create, setCreate] = useState<{ templateId?: string; docType?: DocType } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useContractList(tab === "all" ? undefined : tab, filters, type);
  const templates = useTemplates();
  const customerFilter = useCustomer(filters.customerId);

  // the search string that survives navigation between list <-> drawer <-> paper (type + tab + filters, never `tao`)
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
  const settled = !list.isPending && !list.isError && total === 0 && !filtered;
  const emptyAll = settled && type === undefined;
  // a type tab with nothing in it: its own sentence + a button to make the first one (SPEC-09 §3.4)
  const emptyType = settled && type !== undefined;

  const createButton = canWrite ? (
    <CreateMenu types={creatable} onPick={(t) => setCreate({ docType: t })} />
  ) : (
    <LockedNote>Bạn không có quyền lập báo giá, hợp đồng hay phiếu xuất kho.</LockedNote>
  );

  const templateName = (tid: string | undefined) => templates.data?.find((t) => t.id === tid)?.name ?? "Mẫu";

  return (
    <section className="grid gap-s5" aria-label="Danh sách tài liệu">
      <div className="flex flex-wrap items-start justify-between gap-s4">
        <div className="grid gap-s2">
          <h1 className="text-2xl font-bold leading-head text-strong">Tài liệu</h1>
          <p className="text-md text-muted text-wrap-pretty">Báo giá, hợp đồng, đề nghị thanh toán và phiếu xuất kho của cả nhóm. Bấm một dòng để xem chi tiết, duyệt và phát hành.</p>
        </div>
        {emptyAll ? null : createButton}
      </div>

      {emptyAll ? null : (
        <div className="grid gap-s3">
          <div role="tablist" aria-label="Loại tài liệu" className="flex flex-wrap gap-s1 border-b border-line">
            {TYPE_TABS.map((t) => {
              const active = (type ?? "all") === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setParam("loai", t.value === "all" ? null : t.value)}
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
              <label htmlFor="filter-template" className="text-md font-semibold leading-head text-body">Mẫu</label>
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
      {emptyAll ? <EmptyState title="Chưa có tài liệu nào — Tạo tài liệu." action={createButton} /> : null}
      {emptyType && type !== undefined ? (
        <EmptyState
          title={typeEmptyTitle(type)}
          action={
            type === "payment_request" ? (
              <p className="text-md text-muted">Lập từ hợp đồng đã phát hành.</p>
            ) : creatable.includes(type) ? (
              <Button type="button" onClick={() => setCreate({ docType: type })}>{createLabel(type)}</Button>
            ) : (
              <LockedNote>{`Bạn không có quyền lập ${DOC_TYPE_LABEL[type].toLocaleLowerCase("vi")}.`}</LockedNote>
            )
          }
        />
      ) : null}
      {!list.isPending && !list.isError && !emptyAll && !emptyType && items.length === 0 ? (
        filtered ? (
          <EmptyState title="Không có hợp đồng khớp bộ lọc — Xóa bộ lọc." action={<Button type="button" variant="secondary" onClick={clearFilters}>Xóa bộ lọc</Button>} />
        ) : (
          <EmptyState title="Không có hợp đồng ở trạng thái này." />
        )
      ) : null}

      {items.length > 0 ? (
        <>
          {isMobile ? (
            <ul className="grid gap-s3" aria-label="Các tài liệu">
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
          onGoPaper={(cid) => void navigate({ pathname: `/hop-dong/${cid}/van-ban`, search })}
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
          {...(create.docType ? { docType: create.docType } : {})}
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

function TypePill({ type }: { type: DocType }) {
  return (
    <span data-testid="type-pill" className="inline-flex">
      <Pill tone={TYPE_TONE[type]}>{DOC_TYPE_SHORT[type]}</Pill>
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
            <th className={cn(head, "w-[15%]")}>Số</th>
            <th className={cn(head, "w-[11%]")}>Loại</th>
            <th className={cn(head, "w-[13%]")}>Mẫu</th>
            <th className={cn(head, "w-[17%]")}>Khách hàng</th>
            <th className={cn(head, "w-[12%] text-right")}>Giá trị</th>
            <th className={cn(head, "w-[11%]")}>Trạng thái</th>
            <th className={cn(head, "w-[10%]")}>Người tạo</th>
            <th className={cn(head, "w-[11%]")}>Cập nhật</th>
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
              <td className="px-s3 py-s3"><TypePill type={c.type} /></td>
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
        <div className="flex shrink-0 items-center gap-s2">
          <TypePill type={c.type} />
          <Pill tone={STATUS_TONE[c.status]}>{statusLabel(c.status)}</Pill>
        </div>
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
    <div className="grid gap-s2" aria-busy="true" aria-label="Đang tải tài liệu">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-row w-full" />
      ))}
    </div>
  );
}
