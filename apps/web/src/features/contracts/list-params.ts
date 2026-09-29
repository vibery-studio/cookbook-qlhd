import type { ContractFilters, ContractStatus } from "./api";
import { TABS } from "./status";

const ULID = /^[0-9A-Z]{26}$/;

export type ListParams = { tab: ContractStatus | "all"; filters: ContractFilters };

const ulid = (v: string | null): string | undefined => (v && ULID.test(v) ? v : undefined);

/** URL -> list state. Only ULIDs and the tab name live in the URL; anything else is ignored. */
export function parseListParams(sp: URLSearchParams): ListParams {
  const tab = sp.get("tab");
  const found = TABS.find((t) => t.value === tab);
  const filters: ContractFilters = {};
  const customerId = ulid(sp.get("khach"));
  const createdBy = ulid(sp.get("nguoi-tao"));
  const templateId = ulid(sp.get("mau"));
  if (customerId) filters.customerId = customerId;
  if (createdBy) filters.createdBy = createdBy;
  if (templateId) filters.templateId = templateId;
  return { tab: found?.value ?? "all", filters };
}

export function hasFilters(f: ContractFilters): boolean {
  return Boolean(f.customerId || f.createdBy || f.templateId);
}
