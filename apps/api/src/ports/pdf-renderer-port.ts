/** SPEC-05: turns frozen contract HTML into PDF bytes. Real adapter = Cloudflare Browser Rendering; tests inject a fake. */
export interface PdfRenderer {
  render(html: string): Promise<Uint8Array>;
}
