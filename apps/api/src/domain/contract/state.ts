import type { ContractStatus } from "./types";

const TRANSITIONS: ReadonlySet<string> = new Set([
  "draft->pending",
  "pending->approved",
  "pending->rejected",
  "approved->issued",
  "issued->voided",
]);

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return TRANSITIONS.has(`${from}->${to}`);
}
