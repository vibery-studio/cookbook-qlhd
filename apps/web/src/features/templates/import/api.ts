import type { components } from "@runway/client";
import { client } from "../../../lib/client";
import { unwrap, type Raw } from "../../contracts/api";
import type { ImportPreview } from "./import-logic";

type TemplateDetail = components["schemas"]["TemplateDetail"];
type CreateRequest = components["schemas"]["CreateTemplateRequest"];
type VersionRequest = components["schemas"]["CreateTemplateVersionRequest"];

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * POST the raw .docx bytes (R-7): the typed client takes the binary body through an identity serializer, so the shared
 * fetch (cookies, Origin + X-Requested-With, auto-refresh) is reused. Reads nothing back into the DB — safe to call again.
 */
export async function previewDocx(file: File, opts: { templateId?: string; linesTable?: number }): Promise<ImportPreview> {
  const bytes = await file.arrayBuffer();
  return unwrap(
    client.typed.POST("/templates/import/preview", {
      params: { query: { ...(opts.templateId ? { template_id: opts.templateId } : {}), ...(opts.linesTable !== undefined ? { lines_table: opts.linesTable } : {}) } },
      body: bytes as unknown as string,
      bodySerializer: (body: unknown) => body as BodyInit,
      headers: { "Content-Type": DOCX_MIME },
    }) as Raw<ImportPreview>,
  );
}

export function createTemplate(body: CreateRequest, idempotencyKey: string): Promise<TemplateDetail> {
  return unwrap(client.typed.POST("/templates", { params: { header: { "Idempotency-Key": idempotencyKey } }, body }) as Raw<TemplateDetail>);
}

export function createTemplateVersion(id: string, body: VersionRequest, idempotencyKey: string): Promise<TemplateDetail> {
  return unwrap(
    client.typed.POST("/templates/{id}/versions", { params: { path: { id }, header: { "Idempotency-Key": idempotencyKey } }, body }) as Raw<TemplateDetail>,
  );
}
