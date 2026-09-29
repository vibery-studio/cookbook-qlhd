/**
 * Customer orchestration (SPEC-01 FR-5, DEC-4). Never sees Hono `c`. Normalises input (trim, "" → null,
 * phone → phone_norm), then delegates to the DAO; duplicate / stale / not-found come back as tagged results.
 */
import {
  decodeCursor,
  findDuplicate,
  getCustomer,
  insertCustomer,
  isUniqueViolation,
  listCustomers,
  updateCustomerCas,
  type CustomerDto,
  type CustomerFields,
} from "../dao/customer-dao";
import type { Db } from "../db/client";
import { normalizePhone } from "../utils/phone";

export interface CustomerInput {
  name?: string;
  contact_person?: string;
  tax_code?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export type Invalid = { kind: "invalid"; errors: Array<{ path: string; message: string }> };
export type Duplicate = { kind: "duplicate"; existingId: string };

const clean = (v: string | undefined): string | null | undefined =>
  v === undefined ? undefined : v.trim() === "" ? null : v.trim();

/** Maps the provided API fields to columns (+ phone_norm); collects validation errors. */
function toColumns(input: CustomerInput): { cols: Partial<CustomerFields>; names: string[]; errors: Invalid["errors"] } {
  const cols: Partial<CustomerFields> = {};
  const names: string[] = [];
  const errors: Invalid["errors"] = [];
  const set = <K extends keyof CustomerFields>(api: string, col: K, v: CustomerFields[K] | undefined) => {
    if (v === undefined) return;
    cols[col] = v;
    names.push(api);
  };
  const name = clean(input.name);
  if (name === null) errors.push({ path: "name", message: "name is required" });
  else set("name", "name", name);
  set("contact_person", "contactPerson", clean(input.contact_person));
  set("tax_code", "taxCode", clean(input.tax_code));
  set("email", "email", clean(input.email));
  set("address", "address", clean(input.address));
  const phone = clean(input.phone);
  if (phone !== undefined) {
    if (phone === null) {
      cols.phone = null;
      cols.phoneNorm = null;
    } else {
      const norm = normalizePhone(phone);
      if (norm === null) errors.push({ path: "phone", message: "not a valid Vietnamese phone number" });
      cols.phone = phone;
      cols.phoneNorm = norm;
    }
    names.push("phone");
  }
  return { cols, names, errors };
}

export async function createCustomer(
  db: Db,
  actorId: string,
  input: CustomerInput & { name: string },
): Promise<{ kind: "ok"; customer: CustomerDto } | Invalid | Duplicate> {
  const { cols, names, errors } = toColumns(input);
  if (errors.length > 0 || cols.name === undefined) {
    return { kind: "invalid", errors: errors.length > 0 ? errors : [{ path: "name", message: "name is required" }] };
  }
  try {
    const customer = await insertCustomer(db, {
      name: cols.name,
      contactPerson: cols.contactPerson ?? null,
      taxCode: cols.taxCode ?? null,
      phone: cols.phone ?? null,
      phoneNorm: cols.phoneNorm ?? null,
      email: cols.email ?? null,
      address: cols.address ?? null,
      createdBy: actorId,
      fieldNames: names,
    });
    return { kind: "ok", customer };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const dup = await findDuplicate(db, { phoneNorm: cols.phoneNorm ?? null, taxCode: cols.taxCode ?? null });
    if (dup === null) throw err; // the winner vanished between insert and lookup — not expected (no DELETE)
    return { kind: "duplicate", existingId: dup.id };
  }
}

export async function updateCustomer(
  db: Db,
  actorId: string,
  id: string,
  input: CustomerInput & { expected_version: number },
): Promise<{ kind: "ok"; customer: CustomerDto } | { kind: "not_found" } | { kind: "stale" } | Invalid | Duplicate> {
  const { cols, names, errors } = toColumns(input);
  if (errors.length > 0) return { kind: "invalid", errors };
  try {
    const customer = await updateCustomerCas(db, {
      id,
      expectedVersion: input.expected_version,
      patch: cols,
      fieldNames: names,
      actor: actorId,
    });
    if (customer !== null) return { kind: "ok", customer };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const dup = await findDuplicate(db, {
      phoneNorm: cols.phoneNorm ?? null,
      taxCode: cols.taxCode ?? null,
      excludeId: id,
    });
    if (dup === null) throw err;
    return { kind: "duplicate", existingId: dup.id };
  }
  // CAS matched nothing: the id is unknown, or the version moved on.
  return (await getCustomer(db, id)) === null ? { kind: "not_found" } : { kind: "stale" };
}

export function getCustomerById(db: Db, id: string): Promise<CustomerDto | null> {
  return getCustomer(db, id);
}

export async function searchCustomers(
  db: Db,
  input: { q?: string; cursor?: string; limit: number },
): Promise<{ kind: "ok"; items: CustomerDto[]; next_cursor: string | null } | Invalid> {
  let after;
  if (input.cursor !== undefined) {
    after = decodeCursor(input.cursor) ?? undefined;
    if (after === undefined) return { kind: "invalid", errors: [{ path: "cursor", message: "invalid cursor" }] };
  }
  const q = input.q?.trim();
  const page = await listCustomers(db, {
    q,
    phoneNorm: q ? normalizePhone(q) : null,
    after,
    limit: input.limit,
  });
  return { kind: "ok", ...page };
}
