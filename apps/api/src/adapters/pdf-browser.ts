/** PdfRenderer on Cloudflare Browser Rendering (@cloudflare/puppeteer). Pattern proven in the SPEC-05 spike. */
import puppeteer from "@cloudflare/puppeteer";
import type { PdfRenderer } from "../ports/pdf-renderer-port";
import { fontCss } from "./pdf-fonts";

export function createBrowserPdfRenderer(browserBinding: Fetcher): PdfRenderer {
  return {
    async render(html: string): Promise<Uint8Array> {
      const browser = await puppeteer.launch(browserBinding);
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });
        await page.addStyleTag({ content: fontCss() });
        await page.evaluate("document.fonts.ready");
        return await page.pdf({
          format: "A4",
          preferCSSPageSize: true,
          printBackground: true,
          displayHeaderFooter: false,
          timeout: 30_000,
        });
      } finally {
        await browser.close();
      }
    },
  };
}
