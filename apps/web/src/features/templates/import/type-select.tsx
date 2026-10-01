import { DOC_TYPES, DOC_TYPE_LABEL, type DocType } from "../../contracts/doc-type-labels";
import { SELECT_CLASS } from "../../products/price-fields";

/** C-10-005 — the four row-4 document types; value = `DocType` key sent as `templates.type`, label from the shared labels (DOC_TYPES order). */
type ImportTypeOption = { value: DocType; label: string };
export const IMPORT_TYPES = DOC_TYPES.map((value) => ({ value, label: DOC_TYPE_LABEL[value] })) as [ImportTypeOption, ...ImportTypeOption[]];
export type ImportType = DocType;

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
