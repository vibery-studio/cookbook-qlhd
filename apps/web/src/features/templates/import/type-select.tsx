import { SELECT_CLASS } from "../../products/price-fields";

/** C-10-005 widens this list (Báo giá, Đề nghị thanh toán, Phiếu xuất kho); today only the contract type exists for import. */
export const IMPORT_TYPES = [{ value: "contract", label: "Hợp đồng" }] as const;
export type ImportType = (typeof IMPORT_TYPES)[number]["value"];

export function TypeSelect({ value, onChange, disabled }: { value: ImportType; onChange: (value: ImportType) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-s2">
      <label htmlFor="import-type" className="text-md font-semibold leading-head text-body">
        Loại
      </label>
      <select
        id="import-type"
        className={SELECT_CLASS}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange((IMPORT_TYPES.find((t) => t.value === e.target.value) ?? IMPORT_TYPES[0]).value)}
      >
        {IMPORT_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}
