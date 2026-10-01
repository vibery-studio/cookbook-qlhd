import { cn } from "../../../lib/cn";
import { Pill } from "../../../ui";
import { badgesFor, type FieldRow, type FieldType } from "./import-logic";
import { SELECT_CLASS } from "../../products/price-fields";

const TYPE_LABELS: Record<FieldType, string> = {
  text: "Văn bản",
  paragraph: "Đoạn văn",
  money: "Tiền",
  number: "Số",
  percent: "Phần trăm",
  date: "Ngày",
  choice: "Chọn một",
  lines: "Bảng dòng hàng",
  goods: "Bảng hàng hóa",
};
const TYPES = Object.keys(TYPE_LABELS) as FieldType[];

const INPUT_CLASS =
  "motion-colors min-h-[var(--row-h)] w-full min-w-[120px] rounded-r2 border border-line-strong bg-surface px-s3 text-md text-body outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft";

type Patch = Partial<Pick<FieldRow, "label" | "type" | "required" | "source" | "optionsText">>;

export function FieldTable({
  rows,
  sources,
  errorsByKey,
  onChange,
}: {
  rows: readonly FieldRow[];
  sources: readonly string[];
  errorsByKey: Record<string, string[]>;
  onChange: (key: string, patch: Patch) => void;
}) {
  return (
    <div className="shell-scroll overflow-x-auto">
      <table data-testid="import-fields" aria-label="Các trường của mẫu" className="w-full min-w-[620px] text-left text-md">
        <thead>
          <tr className="border-b border-line text-sm text-muted">
            <th scope="col" className="py-s2 pr-s3 font-semibold">Trường</th>
            <th scope="col" className="py-s2 pr-s3 font-semibold">Nhãn</th>
            <th scope="col" className="py-s2 pr-s3 font-semibold">Kiểu</th>
            <th scope="col" className="py-s2 pr-s3 font-semibold">Bắt buộc</th>
            <th scope="col" className="py-s2 font-semibold">Nguồn</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const errors = errorsByKey[r.key] ?? [];
            const options = sources.includes(r.source) ? sources : [...sources, r.source];
            return (
              <tr key={r.key} data-testid="import-field-row" data-key={r.key} className={cn("border-b border-line align-top", errors.length > 0 && "bg-danger-bg")}>
                <td className="py-s2 pr-s3"><div className="grid gap-s1">
                  <span className="flex flex-wrap items-center gap-s2">
                    <code className="font-mono text-sm text-strong">{r.key}</code>
                    <span className="text-sm text-muted">×{r.count}</span>
                  </span>
                  <span className="flex flex-wrap gap-s1">
                    {badgesFor(r).map((b) => (
                      <Pill key={b} tone={b === "Tiền nhập tay" ? "danger" : "neutral"}>
                        {b}
                      </Pill>
                    ))}
                  </span>
                  {errors.map((message) => (
                    <p key={message} role="alert" className="text-sm text-danger">
                      {message}
                    </p>
                  ))}
                  </div>
                </td>
                <td className="py-s2 pr-s3">
                  <input aria-label={`Nhãn ${r.key}`} className={INPUT_CLASS} value={r.label} onChange={(e) => onChange(r.key, { label: e.target.value })} />
                </td>
                <td className="py-s2 pr-s3">
                  <select aria-label={`Kiểu ${r.key}`} className={SELECT_CLASS} value={r.type} onChange={(e) => onChange(r.key, { type: e.target.value as FieldType })}>
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-s2 pr-s3">
                  <input
                    type="checkbox"
                    aria-label={`Bắt buộc ${r.key}`}
                    className="size-5 accent-[var(--color-accent)]"
                    checked={r.required}
                    onChange={(e) => onChange(r.key, { required: e.target.checked })}
                  />
                </td>
                <td className="py-s2"><div className="grid gap-s2">
                  <select aria-label={`Nguồn ${r.key}`} className={SELECT_CLASS} value={r.source} onChange={(e) => onChange(r.key, { source: e.target.value })}>
                    {options.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {r.type === "choice" ? (
                    <input
                      aria-label={`Lựa chọn ${r.key}`}
                      placeholder="Các lựa chọn, cách nhau bởi dấu phẩy"
                      className={INPUT_CLASS}
                      value={r.optionsText}
                      onChange={(e) => onChange(r.key, { optionsText: e.target.value })}
                    />
                  ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
