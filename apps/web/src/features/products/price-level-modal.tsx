import { useState } from "react";
import { Alert, Button, Modal } from "../../ui";
import { PriceFields, localFieldErrors, type PriceValues } from "./price-fields";
import { productError, useAddPrice, type ProductError } from "./api";
import { parseMoney, parseVatOption, tomorrowIso, vatOptionValue } from "./product-view";

/** "Thêm mức giá" — a new level from tomorrow at the earliest (DEC-5). Levels are never edited. */
export function PriceLevelModal({
  productId,
  initialVat,
  onClose,
  onSaved,
}: {
  productId: string;
  initialVat: number | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const min = tomorrowIso();
  const [values, setValues] = useState<PriceValues>({ price: "", vat: vatOptionValue(initialVat), from: min });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ProductError | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const add = useAddPrice();

  async function submit() {
    if (add.isPending) return;
    const price = parseMoney(values.price);
    const next: Record<string, string> = {};
    if (price === null) next["unit_price_ex_vat"] = "Giá chưa VAT là số đồng nguyên, từ 0";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.from) || values.from < min) next["effective_from"] = "Ngày áp dụng phải từ ngày mai trở đi";
    setErrors(next);
    setFailure(null);
    if (price === null || Object.keys(next).length > 0) return;
    try {
      await add.mutateAsync({
        id: productId,
        idempotencyKey,
        body: { unit_price_ex_vat: price, vat_rate_bps: parseVatOption(values.vat), effective_from: values.from },
      });
      onSaved("Đã thêm mức giá");
    } catch (error) {
      const translated = productError(error, "price");
      setErrors(localFieldErrors(translated.fieldErrors));
      setFailure(translated);
    }
  }

  return (
    <Modal
      open
      title="Thêm mức giá"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>Hủy</Button>
          <Button type="button" loading={add.isPending} onClick={() => void submit()}>Lưu</Button>
        </>
      }
    >
      <form className="grid gap-s4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <PriceFields
          idPrefix="level"
          values={values}
          onChange={(n) => { setValues((v) => ({ ...v, ...n })); setFailure(null); }}
          errors={errors}
          minDate={min}
          hint="Tài liệu lập trước ngày này giữ giá cũ"
        />
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
