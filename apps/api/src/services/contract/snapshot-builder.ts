import { getCustomer } from "../../dao/customer-dao";
import { linesAt } from "../../dao/product-pricing-dao";
import { getCurrentVersion, getTemplateVersionById } from "../../dao/template-dao";
import { findUserById } from "../../dao/user-dao";
import { buildChildSnapshot, type ChildParentInput } from "../../domain/contract/child-snapshot";
import type { DocType } from "../../domain/contract/doc-types";
import { snapshotHash } from "../../domain/contract/hash";
import { buildSnapshot, type BuildResult } from "../../domain/contract/snapshot";
import type {
  ApprovalPolicy,
  CustomerInput,
  DocLineInput,
  FieldRule,
  LineRef,
  Snapshot,
  TemplateField,
  TemplateVersionInput,
} from "../../domain/contract/types";
import type { Db } from "../../db/client";
import { todayInVN } from "../../utils/vn-date";
import { resolveLines } from "../pricing-service";
import type { BuildFailure, DocTypeFailure } from "./types";

const MAX_SNAPSHOT_BYTES = 256 * 1024;

export interface LoadAndBuildInput {
  templateVersionId?: string;
  templateId?: string;
  customerId: string;
  lines: LineRef[];
  values: Record<string, unknown>;
  now: Date;
  manualStart: boolean;
  /** SPEC-09 FR-1: the document's type (= `templates.type`); default `contract`. */
  type?: DocType;
  /** the document's creator — `creator:name` (BG "Nhân viên phụ trách") */
  creatorId: string;
}

export interface BuiltSnapshot {
  snapshot: Snapshot;
  snapshotJson: string;
  snapshotHash: string;
  templateVersion: TemplateVersionInput;
}

export type LoadAndBuildResult =
  | { kind: "ok"; built: BuiltSnapshot }
  | BuildFailure
  | { kind: "not-found"; what: "customer" | "template" };

function decodeTemplateVersion(row: Awaited<ReturnType<typeof getTemplateVersionById>>): TemplateVersionInput {
  if (row === null) throw new Error("decodeTemplateVersion: missing row");
  return {
    id: row.id,
    template_id: row.templateId,
    version_no: row.versionNo,
    body: row.body,
    fields: JSON.parse(row.fields) as TemplateField[],
    field_rules: JSON.parse(row.fieldRules) as FieldRule[],
    default_line_items: JSON.parse(row.defaultLineItems) as unknown[],
    default_clauses: JSON.parse(row.defaultClauses) as unknown[],
    approval_policy: JSON.parse(row.approvalPolicy) as ApprovalPolicy,
  };
}

function customerInput(customer: Awaited<ReturnType<typeof getCustomer>>): CustomerInput {
  if (customer === null) throw new Error("customerInput: missing customer");
  return {
    id: customer.id,
    name: customer.name,
    contact_person: customer.contact_person,
    phone: customer.phone,
    email: customer.email,
    tax_code: customer.tax_code,
    address: customer.address,
  };
}

/**
 * A stored snapshot's inputs → the requested lines + the manual values (for edit / copy: re-priced on the new date).
 * A child's inputs also carry `frozen_from` + its forced `giam_gia` (C-09-004) — dropped here: a child is rebuilt from its
 * parent (`loadAndBuildChild`), never from these.
 */
export function splitInputs(snapshot: Pick<Snapshot, "inputs">): { lines: LineRef[]; values: Record<string, unknown> } {
  const { lines, frozen_from: frozenFrom, ...values } = snapshot.inputs ?? { lines: [] };
  if (frozenFrom !== undefined) delete values.giam_gia;
  return { lines: Array.isArray(lines) ? lines.map((l) => ({ product_id: l.product_id, qty: l.qty })) : [], values };
}

function mapBuildFailure(result: Exclude<BuildResult, { ok: true }>): BuildFailure {
  if (result.kind === "missing-fields") return result;
  if (result.kind === "unresolved-placeholder") return result;
  return { kind: "invalid", errors: result.errors };
}

async function creatorNameOf(db: Db, userId: string): Promise<string | undefined> {
  const user = await findUserById(db, userId);
  return user?.displayName ?? undefined;
}

async function loadVersion(db: Db, input: { templateVersionId?: string; templateId?: string }) {
  return input.templateVersionId !== undefined
    ? getTemplateVersionById(db, input.templateVersionId)
    : input.templateId !== undefined
      ? getCurrentVersion(db, input.templateId)
      : null;
}

/** Serialize + size-check + hash a built snapshot. */
function finish(snapshot: Snapshot, version: TemplateVersionInput): LoadAndBuildResult {
  const snapshotJson = JSON.stringify(snapshot);
  const snapshotBytes = new TextEncoder().encode(snapshotJson).byteLength;
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
    return {
      kind: "invalid",
      errors: [{ path: "snapshot", message: "Snapshot không được vượt quá 256 KB." }],
    };
  }
  return { kind: "ok", built: { snapshot, snapshotJson, snapshotHash: snapshotHash(snapshot), templateVersion: version } };
}

/**
 * PXK lines (SPEC-09 FR-12, P-7): the generic line rules without the price one — unknown id → duplicate → inactive
 * (PLAN-08 P-2 order, same messages as `resolveLines`). The goods-only rule is the document's (`buildSnapshot`).
 */
async function resolveGoodsLines(
  db: Db,
  refs: readonly LineRef[],
  date: string,
): Promise<{ kind: "ok"; lines: DocLineInput[] } | Extract<BuildFailure, { kind: "line-invalid" }>> {
  const found = await linesAt(
    db,
    refs.map((r) => r.product_id),
    date,
  );
  const seen = new Set<string>();
  const problems: Array<{ slug: "validation" | "product-inactive"; path: string; message: string }> = [];
  const lines: DocLineInput[] = [];
  refs.forEach((ref, i) => {
    const path = `lines.${i}.product_id`;
    const hit = found.get(ref.product_id);
    if (hit === undefined) {
      problems.push({ slug: "validation", path, message: `Dòng ${i + 1}: sản phẩm không tồn tại.` });
      return;
    }
    if (seen.has(ref.product_id)) {
      problems.push({ slug: "validation", path, message: `Dòng ${i + 1}: ${hit.product.name} đã có ở dòng khác.` });
      return;
    }
    seen.add(ref.product_id);
    if (!hit.product.active) {
      problems.push({ slug: "product-inactive", path, message: `Dòng ${i + 1}: ${hit.product.name} đã ngừng bán.` });
      return;
    }
    const p = hit.product;
    lines.push({ product_id: p.id, code: p.code, name: p.name, kind: p.kind, unit: p.unit, duration_value: p.duration_value, duration_unit: p.duration_unit, qty: ref.qty });
  });
  if (problems.length === 0) return { kind: "ok", lines };
  const slug = problems.some((p) => p.slug === "validation") ? "validation" : "product-inactive";
  return { kind: "line-invalid", slug, errors: problems.filter((p) => p.slug === slug).map(({ path, message }) => ({ path, message })) };
}

/** Load all live inputs, then build one immutable standalone document snapshot (HĐ, BG priced today; PXK unpriced). */
export async function loadAndBuild(db: Db, input: LoadAndBuildInput): Promise<LoadAndBuildResult> {
  const versionRow = await loadVersion(db, input);
  if (versionRow === null) return { kind: "not-found", what: "template" };

  const customerRow = await getCustomer(db, input.customerId);
  if (customerRow === null) return { kind: "not-found", what: "customer" };

  const type = input.type ?? "contract";
  const docDate = todayInVN(input.now);
  // PLAN-08 P-2: per-line rules first (unknown / duplicate / inactive / no price), then the document rule in buildSnapshot.
  // A PXK needs no price (DEC-12 A).
  const resolved = type === "delivery_note" ? await resolveGoodsLines(db, input.lines, docDate) : await resolveLines(db, input.lines, docDate);
  if (resolved.kind !== "ok") return resolved;
  const version = decodeTemplateVersion(versionRow);
  const creatorName = await creatorNameOf(db, input.creatorId);
  const result = buildSnapshot({
    version,
    customer: customerInput(customerRow),
    lines: resolved.lines,
    values: input.values,
    docDate,
    manualStart: input.manualStart,
    type,
    ...(creatorName === undefined ? {} : { creatorName }),
  });
  if (!result.ok) return mapBuildFailure(result);
  return finish(result.snapshot, version);
}

export interface LoadAndBuildChildInput {
  /** the parent as stored (its snapshot is immutable once issued) */
  parent: ChildParentInput;
  childType: DocType;
  templateVersionId?: string;
  templateId?: string;
  customerId: string;
  values: Record<string, unknown>;
  now: Date;
  manualStart: boolean;
  creatorId: string;
}

export type LoadAndBuildChildResult = LoadAndBuildResult | Extract<DocTypeFailure, { kind: "child-type" | "lines-locked" | "nothing-to-pay" }>;

/**
 * A child (HĐ ← BG, DNTT ← HĐ) rebuilt from its parent's stored snapshot (C-09-004 `buildChildSnapshot`): frozen lines + price,
 * never `resolveLines`. Used by edit + copy of a child (the parent CAS / guard stays with the caller).
 */
export async function loadAndBuildChild(db: Db, input: LoadAndBuildChildInput): Promise<LoadAndBuildChildResult> {
  const versionRow = await loadVersion(db, input);
  if (versionRow === null) return { kind: "not-found", what: "template" };
  const customerRow = await getCustomer(db, input.customerId);
  if (customerRow === null) return { kind: "not-found", what: "customer" };

  const version = decodeTemplateVersion(versionRow);
  const creatorName = await creatorNameOf(db, input.creatorId);
  const result = buildChildSnapshot({
    parent: input.parent,
    childType: input.childType,
    version,
    customer: customerInput(customerRow),
    values: input.values,
    docDate: todayInVN(input.now),
    manualStart: input.manualStart,
    ...(creatorName === undefined ? {} : { creatorName }),
  });
  if (!result.ok) {
    if (result.kind === "child-type" || result.kind === "lines-locked" || result.kind === "nothing-to-pay") return { kind: result.kind };
    return mapBuildFailure(result);
  }
  return finish(result.snapshot, version);
}
