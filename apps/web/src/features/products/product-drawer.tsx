import { useState } from "react";
import { Alert, Button, Field, LockedNote, Pill, Skeleton, type PillTone } from "../../ui";
import { formatIsoDate } from "../../lib/vn-date";
import { Dialog, DialogHeader } from "../contracts/dialog";
import { productError, useCancelPrice, usePatchProduct, useProduct, type PriceHistoryItem, type Product, type ProductError } from "./api";
import { SELECT_CLASS } from "./price-fields";
import { PriceLevelModal } from "./price-level-modal";
import { KIND_LABEL, LEVEL_STATUS_LABEL, NO_RIGHT_TEXT, durationLabel, formatPlainMoney, vatLabel } from "./product-view";

type Edit = { name: string; unit: string; duration: string; durationUnit: "month" | "day" };
const STATUS_TONE: Record<PriceHistoryItem["status"], PillTone> = { scheduled: "pending", current: "success", past: "neutral" };

const editOf = (p: Product): Edit => ({
  name: p.name,
  unit: p.unit,
  duration: p.duration_value === null ? "" : String(p.duration_value),
  durationUnit: p.duration_unit ?? "month",
});

/** 560px product drawer: info + Lưu (CAS) · Ngừng bán/Bán lại · Lịch sử giá · + Thêm mức giá · Hủy a scheduled level. */
export function ProductDrawer({ summary, onClose, notify }: { summary: Product; onClose: () => void; notify: (message: string) => void }) {
  const detail = useProduct(summary.id);
  const patch = usePatchProduct();
  const cancel = useCancelPrice();
  const [edit, setEdit] = useState<Edit | null>(null); // null = follow the server product
  const [failure, setFailure] = useState<ProductError | null>(null);
  const [addLevel, setAddLevel] = useState(false);

  const product: Product = detail.data ?? summary;
  const levels = detail.data?.prices ?? [];
  const values = edit ?? editOf(product);
  const isService = product.kind === "service";
  const { edit: canEdit, price: canPrice } = product.can;
  const base = editOf(product);
  const dirty = values.name.trim() !== base.name || values.unit.trim() !== base.unit || (isService && (values.duration !== base.duration || values.durationUnit !== base.durationUnit));

  function change(next: Partial<Edit>) {
    setEdit({ ...values, ...next });
    setFailure(null);
  }

  async function save() {
    if (patch.isPending || !dirty) return;
    const months = Number(values.duration);
    if (!values.name.trim() || !values.unit.trim() || (isService && !(Number.isInteger(months) && months >= 1))) {
      setFailure({ slug: "validation", message: "Kiểm tra lại các ô đánh dấu.", fieldErrors: {}, forbidden: false });
      return;
    }
    try {
      await patch.mutateAsync({
        id: product.id,
        body: {
          expected_version: product.version,
          ...(values.name.trim() !== base.name ? { name: values.name.trim() } : {}),
          ...(values.unit.trim() !== base.unit ? { unit: values.unit.trim() } : {}),
          ...(isService && (values.duration !== base.duration || values.durationUnit !== base.durationUnit)
            ? { duration_value: months, duration_unit: values.durationUnit }
            : {}),
        },
      });
      setEdit(null);
      setFailure(null);
      notify("Đã lưu");
    } catch (error) {
      setFailure(productError(error));
    }
  }

  async function toggleActive() {
    if (patch.isPending) return;
    try {
      await patch.mutateAsync({ id: product.id, body: { expected_version: product.version, active: !product.active } });
      setFailure(null);
      notify(product.active ? "Đã ngừng bán" : "Đã bán lại");
    } catch (error) {
      setFailure(productError(error));
    }
  }

  async function cancelLevel(level: PriceHistoryItem) {
    if (cancel.isPending || !level) return;
    try {
      await cancel.mutateAsync({ id: product.id, priceId: level.id });
      setFailure(null);
      notify("Đã hủy mức giá");
    } catch (error) {
      setFailure(productError(error, "price"));
    }
  }

  async function reload() {
    await detail.refetch();
    setEdit(null);
    setFailure(null);
  }

  return (
    <>
      <Dialog label={`Sản phẩm · ${product.code}`} variant="drawer" onClose={onClose} testId="product-drawer">
        <DialogHeader
          eyebrow="Sản phẩm"
          onClose={onClose}
          title={<h2 className="text-xl font-bold leading-head text-strong text-wrap-pretty">{product.name}</h2>}
          right={
            <div className="flex flex-wrap items-center gap-s2">
              <span className="font-mono text-md text-muted">{product.code}</span>
              <Pill tone="accent">{KIND_LABEL[product.kind]}</Pill>
              {product.active ? null : <Pill tone="danger">Ngừng bán</Pill>}
            </div>
          }
        />
        <div className="shell-scroll grid min-h-0 flex-1 content-start gap-s5 overflow-y-auto px-s5 py-s5">
          {!canEdit || !canPrice ? <LockedNote>{NO_RIGHT_TEXT}</LockedNote> : null}

          <div className="grid gap-s4">
            <Field id="drawer-name" label="Tên sản phẩm" name="name" autoComplete="off" maxLength={120} disabled={!canEdit} value={values.name} onChange={(e) => change({ name: e.target.value })} />
            <Field id="drawer-unit" label="Đơn vị tính" name="unit" autoComplete="off" maxLength={20} disabled={!canEdit} value={values.unit} onChange={(e) => change({ unit: e.target.value })} />
            {isService ? (
              canEdit ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-s3">
                  <Field id="drawer-duration" label="Thời hạn" name="duration_value" inputMode="numeric" autoComplete="off" value={values.duration} onChange={(e) => change({ duration: e.target.value })} />
                  <select aria-label="Tính theo" className={SELECT_CLASS} value={values.durationUnit} onChange={(e) => change({ durationUnit: e.target.value === "day" ? "day" : "month" })}>
                    <option value="month">tháng</option>
                    <option value="day">ngày</option>
                  </select>
                </div>
              ) : (
                <p className="text-md text-body"><span className="font-semibold">Thời hạn: </span>{durationLabel(product.duration_value, product.duration_unit)}</p>
              )
            ) : null}
          </div>

          <section className="grid gap-s3" data-testid="price-history" aria-label="Lịch sử giá">
            <div className="flex flex-wrap items-center justify-between gap-s3">
              <h3 className="text-lg font-bold text-strong">Lịch sử giá</h3>
              {canPrice ? <Button type="button" variant="secondary" onClick={() => { setFailure(null); setAddLevel(true); }}>+ Thêm mức giá</Button> : null}
            </div>
            {detail.isPending ? <Skeleton className="h-[var(--row-h)] w-full" /> : null}
            {detail.isError ? <Alert tone="danger">{productError(detail.error).message}</Alert> : null}
            {levels.length === 0 && detail.data ? <p className="text-md text-muted">Chưa có mức giá nào.</p> : null}
            <ul className="grid gap-s3">
              {levels.map((level) => (
                <li key={level.id} data-testid="price-level" className="grid gap-s2 rounded-r2 border border-line bg-surface px-s4 py-s3">
                  <div className="flex flex-wrap items-center justify-between gap-s2">
                    <Pill tone={STATUS_TONE[level.status]}>{LEVEL_STATUS_LABEL[level.status]}</Pill>
                    {canPrice && level.status === "scheduled" ? (
                      <Button type="button" variant="ghost" loading={cancel.isPending} onClick={() => void cancelLevel(level)}>Hủy</Button>
                    ) : null}
                  </div>
                  <p className="font-mono text-md text-strong">
                    {formatPlainMoney(level.unit_price_ex_vat)} <span className="text-muted">chưa VAT · {vatLabel(level.vat_rate_bps)}</span>
                  </p>
                  <p className="font-mono text-sm text-muted">Gồm VAT {formatPlainMoney(level.unit_price_inc_vat)}</p>
                  <p className="text-sm text-muted">
                    Từ {formatIsoDate(level.effective_from)}
                    {level.effective_to ? ` đến ${formatIsoDate(level.effective_to)}` : " — hiện nay"}
                    {level.created_by_name ? ` · ${level.created_by_name} đặt` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {failure ? (
            <Alert tone="danger">
              <p>
                {failure.message}
                {failure.slug === "stale" ? (
                  <>
                    {" "}
                    <button type="button" className="font-semibold underline" onClick={() => void reload()}>Tải bản mới</button>
                  </>
                ) : null}
              </p>
              {failure.requestId ? <p className="font-mono text-sm">Mã hỗ trợ: {failure.requestId}</p> : null}
            </Alert>
          ) : null}
        </div>

        {canEdit ? (
          <div className="flex flex-wrap justify-end gap-s2 border-t border-line bg-sunken px-s5 py-s4">
            <Button type="button" variant="secondary" loading={patch.isPending} onClick={() => void toggleActive()}>
              {product.active ? "Ngừng bán" : "Bán lại"}
            </Button>
            <Button type="button" disabled={!dirty} loading={patch.isPending} onClick={() => void save()}>Lưu</Button>
          </div>
        ) : null}
      </Dialog>
      {addLevel ? (
        <PriceLevelModal
          productId={product.id}
          initialVat={product.price?.vat_rate_bps ?? null}
          onClose={() => setAddLevel(false)}
          onSaved={(message) => { setAddLevel(false); notify(message); }}
        />
      ) : null}
    </>
  );
}
