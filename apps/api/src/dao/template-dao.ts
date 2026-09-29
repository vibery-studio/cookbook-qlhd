/**
 * Templates read DAO (SPEC-02 §3.6, §3.8). Pure `(db, input) → DTO`. Old versions stay readable even when the
 * template is inactive (DEC-9).
 */
import { and, asc, desc, eq, gt, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { templates, templateVersions, users } from "../db/schema";
import {
  toDetailDto,
  toListItemDto,
  toVersionDto,
  toVersionRefDto,
  type TemplateDetailDto,
  type TemplateListItemDto,
  type TemplateVersionRow,
} from "./template-types";

export interface TemplateCursor {
  name: string;
  id: string;
}

function encodeCursor(pos: TemplateCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify([pos.name, pos.id]));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Returns null for a malformed cursor. */
export function decodeTemplateCursor(cursor: string): TemplateCursor | null {
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const arr = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))) as unknown;
    if (Array.isArray(arr) && typeof arr[0] === "string" && typeof arr[1] === "string") {
      return { name: arr[0], id: arr[1] };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Templates with their current version, ordered by name then id (keyset). No `body` in list rows. */
export async function listTemplates(
  db: Db,
  input: { after?: TemplateCursor; limit: number },
): Promise<{ items: TemplateListItemDto[]; next_cursor: string | null }> {
  const after = input.after;
  const keyset =
    after === undefined
      ? undefined
      : or(gt(templates.name, after.name), and(eq(templates.name, after.name), gt(templates.id, after.id)));
  const rows = await db
    .select({ t: templates, v: templateVersions, authorName: users.displayName })
    .from(templates)
    .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
    .leftJoin(users, eq(users.id, templateVersions.createdBy))
    .where(keyset)
    .orderBy(asc(templates.name), asc(templates.id))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((r) => toListItemDto(r.t, r.v, r.authorName)),
    next_cursor: hasMore && last ? encodeCursor({ name: last.t.name, id: last.t.id }) : null,
  };
}

/** Template at `versionNo` (default: current version) + all version refs (newest first). Null: unknown template/version. */
export async function getTemplateDetail(
  db: Db,
  id: string,
  versionNo?: number,
): Promise<TemplateDetailDto | null> {
  const [t] = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
  if (!t) return null;
  const versionWhere =
    versionNo === undefined
      ? t.currentVersionId === null
        ? undefined
        : eq(templateVersions.id, t.currentVersionId)
      : and(eq(templateVersions.templateId, id), eq(templateVersions.versionNo, versionNo));
  if (versionWhere === undefined) return null;
  const [rows, refs] = await Promise.all([
    db
      .select({ v: templateVersions, authorName: users.displayName })
      .from(templateVersions)
      .leftJoin(users, eq(users.id, templateVersions.createdBy))
      .where(versionWhere)
      .limit(1),
    db
      .select({ v: templateVersions, authorName: users.displayName })
      .from(templateVersions)
      .leftJoin(users, eq(users.id, templateVersions.createdBy))
      .where(eq(templateVersions.templateId, id))
      .orderBy(desc(templateVersions.versionNo)),
  ]);
  const row = rows[0];
  if (!row) return null;
  return toDetailDto(
    t,
    toVersionDto(row.v, row.authorName),
    refs.map((r) => toVersionRefDto(r.v, r.authorName)),
  );
}

/** Any version by id, even of an inactive template (row 3 pins contracts to this). */
export async function getTemplateVersionById(db: Db, id: string): Promise<TemplateVersionRow | null> {
  const [row] = await db.select().from(templateVersions).where(eq(templateVersions.id, id)).limit(1);
  return row ?? null;
}

/** The template's current version row, or null (unknown template / no pointer). */
export async function getCurrentVersion(db: Db, templateId: string): Promise<TemplateVersionRow | null> {
  const [row] = await db
    .select({ v: templateVersions })
    .from(templates)
    .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
    .where(eq(templates.id, templateId))
    .limit(1);
  return row?.v ?? null;
}
