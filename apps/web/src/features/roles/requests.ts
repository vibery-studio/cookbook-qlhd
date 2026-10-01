import { useQuery } from "@tanstack/react-query";
import type { components } from "@runway/client";
import { client } from "../../lib/client";
import { diffCounts } from "./role-diff";

export type ChangeRequest = components["schemas"]["ChangeRequest"];
export type SodPair = components["schemas"]["SodPair"];

export const CHANGE_REQUESTS_KEY = ["role-change-requests"] as const;
export const SOD_PAIRS_KEY = ["sod-pairs"] as const;

export async function fetchChangeRequests(): Promise<ChangeRequest[]> {
  const { data, response } = await client.typed.GET("/role-change-requests", {});
  if (response.ok && data) return data.items;
  throw new Error("change-requests");
}

/** All requests (newest first), `can`/`locked_reason` for the caller. Shared by the Yêu cầu tab, the drawer and the nav pill. */
export function useChangeRequests(enabled: boolean) {
  return useQuery({ queryKey: CHANGE_REQUESTS_KEY, queryFn: fetchChangeRequests, enabled, staleTime: 0, refetchOnWindowFocus: true });
}

export async function fetchSodPairs(): Promise<SodPair[]> {
  const { data, response } = await client.typed.GET("/sod-pairs", {});
  if (response.ok && data) return data.items;
  throw new Error("sod-pairs");
}

export function useSodPairs() {
  return useQuery({ queryKey: SOD_PAIRS_KEY, queryFn: fetchSodPairs, staleTime: 0 });
}

/** Nav pill: pending requests the caller may approve; nothing at 0 or before the list loads. */
export function approvableCount(items: ReadonlyArray<{ status: string; can: { approve: boolean } }> | undefined): number | undefined {
  if (!items) return undefined;
  const n = items.filter((r) => r.status === "pending" && r.can.approve).length;
  return n > 0 ? n : undefined;
}

/** "+2 · −1" for a request. */
export function diffText(added: readonly unknown[], removed: readonly unknown[]): string {
  return diffCounts(added.length, removed.length);
}

const dayMonth = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" });

/** "08/10" in Vietnam time, from unix seconds. */
export function formatDayMonth(seconds: number): string {
  const part = (type: string) => dayMonth.formatToParts(new Date(seconds * 1000)).find((p) => p.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}`;
}

/** Declared pairs that the set holds both halves of. */
export function violatedPairs(perms: ReadonlySet<string>, pairs: readonly Pick<SodPair, "perm_a" | "perm_b">[]): Array<[string, string]> {
  return pairs.filter((p) => perms.has(p.perm_a) && perms.has(p.perm_b)).map((p) => [p.perm_a, p.perm_b]);
}

export const STATUS_LABELS: Readonly<Record<ChangeRequest["status"], string>> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Đã từ chối",
  withdrawn: "Đã rút",
  expired: "Hết hạn",
  cancelled: "Đã hủy",
};
