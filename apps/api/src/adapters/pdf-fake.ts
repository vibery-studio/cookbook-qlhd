/** PdfRenderer for vitest (PDF_RENDERER=fake): a fixed, minimal PDF — no browser. Never used in deployed envs. */
import type { PdfRenderer } from "../ports/pdf-renderer-port";

const FAKE_PDF = new TextEncoder().encode("%PDF-1.4\n% runway fake renderer\n%%EOF\n");

export const fakePdfRenderer: PdfRenderer = {
  render: () => Promise.resolve(FAKE_PDF.slice()),
};
