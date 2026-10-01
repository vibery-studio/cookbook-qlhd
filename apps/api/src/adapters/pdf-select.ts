/** Pick the PdfRenderer from PDF_RENDERER (SPEC-05). `null` = switched off. The browser adapter loads lazily. */
import type { Bindings } from "../env";
import type { PdfRenderer } from "../ports/pdf-renderer-port";
import { fakePdfRenderer } from "./pdf-fake";

export async function selectPdfRenderer(env: Bindings): Promise<PdfRenderer | null> {
  switch (env.PDF_RENDERER) {
    case "off":
      return null;
    case "fake":
      return fakePdfRenderer;
    default: {
      const { createBrowserPdfRenderer } = await import("./pdf-browser");
      return createBrowserPdfRenderer(env.BROWSER);
    }
  }
}
