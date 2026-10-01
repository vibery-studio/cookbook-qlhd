/**
 * Document types (SPEC-09 FR-1, DEC-10 B; PLAN-09 §2b — locked by C-09-002). Pure: no db, no clock, no Hono.
 * A "document" is a `contracts` row with a `type` (DEC-1 A). `SERIES` (prefixes) lives in `number.ts` (C-09-003).
 */

export const DOC_TYPES = ["quote", "contract", "payment_request", "delivery_note"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Which child types each type may give birth to (BG → HĐ → DNTT; PXK stands alone). */
export const CHILD_OF: Readonly<Record<DocType, readonly DocType[]>> = {
  quote: ["contract"],
  contract: ["payment_request"],
  payment_request: [],
  delivery_note: [],
};

/** Inverse of `CHILD_OF`: the parent types a type may hang under. */
export const PARENT_OF: Readonly<Record<DocType, readonly DocType[]>> = {
  quote: [],
  contract: ["quote"],
  payment_request: ["contract"],
  delivery_note: [],
};

/** The permission that makes a document of each type (DEC-10 B). Read/submit/approve/issue stay `contract:*`. */
export const WRITE_PERM = {
  quote: "quote:write",
  contract: "contract:write",
  payment_request: "payment_request:write",
  delivery_note: "delivery_note:write",
} as const satisfies Record<DocType, string>;

/** "Not dead" statuses: at most one live child per (parent, child type) — `uq_contracts_parent_child_live` (DEC-4). */
export const LIVE_STATUSES = ["draft", "pending", "approved", "issued"] as const;

export type ChildReasonCode = "parent-not-issued" | "quote-expired" | "child-exists" | "forbidden";

export interface ChildRule {
  type: DocType;
  allowed: boolean;
  reason_code: ChildReasonCode | null;
}

export interface ChildRuleParent {
  type: DocType;
  status: string;
  /** YYYY-MM-DD; only a BG carries one */
  valid_until: string | null;
}

export function isDocType(value: string): value is DocType {
  return (DOC_TYPES as readonly string[]).includes(value);
}

export function isLiveStatus(status: string): boolean {
  return (LIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * `can.create_child` (FR-10, P-9): one entry per type in `CHILD_OF[parent.type]` (`[]` for DNTT/PXK). First failing reason
 * wins, in this order: parent-not-issued → quote-expired → child-exists → forbidden. A BG is in date while
 * `valid_until >= today` ("đến hết ngày", P-6); a BG without `valid_until` counts as expired (the CAS's `>=` is false on NULL).
 * The API decides; this only mirrors it for the 🔒 hint.
 */
export function childRules(input: {
  parent: ChildRuleParent;
  liveChildren: ReadonlyArray<{ type: DocType; status: string }>;
  today: string;
  perms: readonly string[];
}): ChildRule[] {
  const { parent, liveChildren, today, perms } = input;
  return CHILD_OF[parent.type].map((type): ChildRule => {
    let reason: ChildReasonCode | null = null;
    if (parent.status !== "issued") reason = "parent-not-issued";
    else if (parent.type === "quote" && (parent.valid_until === null || parent.valid_until < today)) reason = "quote-expired";
    else if (liveChildren.some((c) => c.type === type && isLiveStatus(c.status))) reason = "child-exists";
    else if (!perms.includes(WRITE_PERM[type])) reason = "forbidden";
    return { type, allowed: reason === null, reason_code: reason };
  });
}
