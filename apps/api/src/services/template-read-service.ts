/** Template read orchestration (SPEC-02 §3.8). Never sees Hono `c`; failures come back as tagged results. */
import {
  decodeTemplateCursor,
  getTemplateDetail,
  listTemplates,
} from "../dao/template-dao";
import type { TemplateDetailDto, TemplateListItemDto } from "../dao/template-types";
import type { Db } from "../db/client";

export type InvalidCursor = { kind: "invalid"; errors: Array<{ path: string; message: string }> };

export async function listTemplatePage(
  db: Db,
  input: { cursor?: string; limit: number },
): Promise<{ kind: "ok"; items: TemplateListItemDto[]; next_cursor: string | null } | InvalidCursor> {
  let after;
  if (input.cursor !== undefined) {
    after = decodeTemplateCursor(input.cursor) ?? undefined;
    if (after === undefined) return { kind: "invalid", errors: [{ path: "cursor", message: "malformed cursor" }] };
  }
  const page = await listTemplates(db, { after, limit: Math.min(input.limit, 50) });
  return { kind: "ok", ...page };
}

export async function readTemplate(
  db: Db,
  id: string,
  versionNo?: number,
): Promise<{ kind: "ok"; template: TemplateDetailDto } | { kind: "not_found" }> {
  const template = await getTemplateDetail(db, id, versionNo);
  return template === null ? { kind: "not_found" } : { kind: "ok", template };
}
