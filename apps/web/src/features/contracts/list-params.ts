import type { ContractFilters, ContractStatus } from "./api";
import { TABS } from "./status";
import { DOC_TYPES, DOC_TYPE_LABEL, DOC_TYPE_SHORT, type DocType } from "./doc-type-labels";

const ULID = /^[0-9A-Z]{26}$/;

export type ListParams = { tab: ContractStatus | "all"; type: DocType | undefined; filters: ContractFilters };

/** Type tabs of the "Tài liệu" list; `?loai=` carries the value (absent = Tất cả). */
export const TYPE_TABS: ReadonlyArray<{ value: DocType | "all"; label: string }> = [
  { value: "all", label: "Tất cả" },
  ...DOC_TYPES.map((t) => ({ value: t, label: DOC_TYPE_SHORT[t] })),
];

const lower = (t: DocType): string => DOC_TYPE_LABEL[t].toLocaleLowerCase("vi");
export const typeEmptyTitle = (t: DocType): string => `Chưa có ${lower(t)} nào`;
export const createLabel = (t: DocType): string => `Tạo ${lower(t)}`;

const ulid = (v: string | null): string | undefined => (v && ULID.test(v) ? v : undefined);

/** URL -> list state. Only ULIDs and the tab name live in the URL; anything else is ignored. */
export function parseListParams(sp: URLSearchParams): ListParams {
  const tab = sp.get("tab");
  const loai = sp.get("loai");
  const type = DOC_TYPES.find((t) => t === loai);
  const found = TABS.find((t) => t.value === tab);
  const filters: ContractFilters = {};
  const customerId = ulid(sp.get("khach"));
  const createdBy = ulid(sp.get("nguoi-tao"));
  const templateId = ulid(sp.get("mau"));
  if (customerId) filters.customerId = customerId;
  if (createdBy) filters.createdBy = createdBy;
  if (templateId) filters.templateId = templateId;
  return { tab: found?.value ?? "all", type, filters };
}

export function hasFilters(f: ContractFilters): boolean {
  return Boolean(f.customerId || f.createdBy || f.templateId);
}
