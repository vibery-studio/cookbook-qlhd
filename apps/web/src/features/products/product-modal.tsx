import { useState } from "react";
import { Alert, Button, Field, Modal } from "../../ui";
import { PriceFields, SELECT_CLASS, localFieldErrors, type PriceValues } from "./price-fields";
import { productError, useCreateProduct, type CreateProductBody, type ProductError } from "./api";
import { parseMoney, parseVatOption, todayIso } from "./product-view";

type Kind = "service" | "goods";

/** "Thêm sản phẩm" — kind, code, name, unit, duration (service only) and the first level, which may start today (DEC-5). */
export function ProductModal({ canPrice, onClose, onSaved }: { canPrice: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const today = todayIso();
  const [kind, setKind] = useState<Kind>("service");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [duration, setDuration] = useState("1");
  const [durationUnit, setDurationUnit] = useState<"month" | "day">("month");
  const [price, setPrice] = useState<PriceValues>({ price: "", vat: "kct", from: today });
  const [vatTouched, setVatTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ProductError | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const create = useCreateProduct();

  function pickKind(next: Kind) {
    setKind(next);
    if (!vatTouched) setPrice((p) => ({ ...p, vat: next === "goods" ? "1000" : "kct" }));
  }

  function clear(field: string) {
    setFailure(null);
    setErrors((e) => {
      if (!(field in e)) return e;
      const rest = { ...e };
      delete rest[field];
      return rest;
    });
  }

  async function submit() {
    if (create.isPending) return;
    const next: Record<string, string> = {};
    const amount = parseMoney(price.price);
    const months = Number(duration);
    if (!code.trim()) next["code"] = "Mã là bắt buộc";
    if (!name.trim()) next["name"] = "Tên sản phẩm là bắt buộc";
    if (!unit.trim()) next["unit"] = "Đơn vị tính là bắt buộc";
    if (kind === "service" && !(Number.isInteger(months) && months >= 1)) next["duration_value"] = "Thời hạn là số nguyên từ 1";
    if (canPrice) {
      if (amount === null) next["unit_price_ex_vat"] = "Giá chưa VAT là số đồng nguyên, từ 0";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(price.from) || price.from < today) next["effective_from"] = "Ngày áp dụng không được trước hôm nay";
    }
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length > 0) return;

    const body: CreateProductBody = {
      kind,
      code: code.trim(),
      name: name.trim(),
      unit: unit.trim(),
      ...(kind === "service" ? { duration_value: months, duration_unit: durationUnit } : {}),
      ...(canPrice && amount !== null ? { first_price: { unit_price_ex_vat: amount, vat_rate_bps: parseVatOption(price.vat), effective_from: price.from } } : {}),
    };
    try {
      await create.mutateAsync({ body, idempotencyKey });
      onSaved("Đã thêm sản phẩm");
    } catch (error) {
      const translated = productError(error, "product");
      setErrors(localFieldErrors(translated.fieldErrors));
      setFailure(translated);
    }
  }

  return (
    <Modal
      open
      title="Thêm sản phẩm"
      onClose={onClose}
      className="max-mobile:fixed max-mobile:inset-0 max-mobile:h-full max-mobile:max-h-none max-mobile:max-w-none max-mobile:rounded-none max-mobile:border-0"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>Hủy</Button>
          <Button type="button" loading={create.isPending} onClick={() => void submit()}>Lưu</Button>
        </>
      }
    >
      <form className="grid gap-s4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <fieldset className="grid gap-s2">
          <legend className="text-md font-semibold leading-head text-body">Loại</legend>
          <div className="flex gap-s5">
            {([["service", "Dịch vụ"], ["goods", "Hàng hóa"]] as const).map(([value, label]) => (
              <label key={value} className="inline-flex min-h-[var(--row-h)] items-center gap-s2 text-md text-body">
                <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => pickKind(value)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="product-code" label="Mã" name="code" autoComplete="off" value={code} maxLength={32}
          onChange={(e) => { setCode(e.target.value); clear("code"); }} {...(errors["code"] ? { error: errors["code"] } : {})} data-autofocus />
        <Field id="product-name" label="Tên sản phẩm" name="name" autoComplete="off" value={name} maxLength={120}
          onChange={(e) => { setName(e.target.value); clear("name"); }} {...(errors["name"] ? { error: errors["name"] } : {})} />
        <Field id="product-unit" label="Đơn vị tính" name="unit" autoComplete="off" value={unit} maxLength={20}
          onChange={(e) => { setUnit(e.target.value); clear("unit"); }} {...(errors["unit"] ? { error: errors["unit"] } : {})} />
        {kind === "service" ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-s3">
            <Field id="product-duration" label="Thời hạn" name="duration_value" inputMode="numeric" autoComplete="off" value={duration}
              onChange={(e) => { setDuration(e.target.value); clear("duration_value"); }} {...(errors["duration_value"] ? { error: errors["duration_value"] } : {})} />
            <select aria-label="Tính theo" className={SELECT_CLASS} value={durationUnit} onChange={(e) => setDurationUnit(e.target.value === "day" ? "day" : "month")}>
              <option value="month">tháng</option>
              <option value="day">ngày</option>
            </select>
          </div>
        ) : null}
        {canPrice ? (
          <PriceFields
            idPrefix="product"
            values={price}
            onChange={(n) => { if (n.vat !== undefined) setVatTouched(true); setPrice((p) => ({ ...p, ...n })); setFailure(null); }}
            errors={errors}
            minDate={today}
          />
        ) : (
          <p className="text-sm text-muted">🔒 Chỉ Quản lý, Giám đốc sửa sản phẩm/đặt giá — sản phẩm này sẽ chưa có giá.</p>
        )}
        {failure ? (
          <Alert tone="danger">
            <p>{failure.message}</p>
            {failure.requestId ? <p className="mt-s1 font-mono text-sm">Mã hỗ trợ: {failure.requestId}</p> : null}
          </Alert>
        ) : null}
      </form>
    </Modal>
  );
}
