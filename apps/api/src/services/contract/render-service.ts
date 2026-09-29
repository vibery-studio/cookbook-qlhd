import { getContractForRender, saveRenderedOnce } from "../../dao/contract-render-dao";
import type { Db } from "../../db/client";
import { sha256Hex } from "../../domain/contract/hash";
import { renderHtml, withVoidBand } from "../../domain/contract/render";
import { getTemplateVersionById } from "../../dao/template-dao";

export type RenderResult = { kind: "ok"; html: string; etag: string | null } | { kind: "not-found" };

function renderFailure(placeholders: string[]): never {
  throw new Error(`Contract render has unresolved placeholders: ${placeholders.join(", ")}`);
}

function paper(status: string, html: string, hash: string | null): RenderResult {
  return {
    kind: "ok",
    html: status === "voided" ? withVoidBand(html) : html,
    etag: hash,
  };
}

export async function renderContract(db: Db, id: string): Promise<RenderResult> {
  const contract = await getContractForRender(db, id);
  if (contract === null) return { kind: "not-found" };

  if ((contract.status === "issued" || contract.status === "voided") && contract.rendered_html !== null) {
    return paper(contract.status, contract.rendered_html, contract.rendered_hash);
  }

  const version = await getTemplateVersionById(db, contract.template_version_id);
  if (version === null) throw new Error(`Template version not found: ${contract.template_version_id}`);

  const number = contract.status === "issued" ? contract.number : null;
  const rendered = renderHtml(version.body, contract.snapshot, number);
  if (!rendered.ok) renderFailure(rendered.placeholders);

  if (contract.status === "issued") {
    await saveRenderedOnce(db, { id, html: rendered.html, hash: sha256Hex(rendered.html) });
    const stored = await getContractForRender(db, id);
    if (stored === null || stored.rendered_html === null) {
      throw new Error(`Issued contract paper was not stored: ${id}`);
    }
    return paper(stored.status, stored.rendered_html, stored.rendered_hash);
  }

  return { kind: "ok", html: rendered.html, etag: null };
}
