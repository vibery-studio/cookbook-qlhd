/**
 * Arimo (metric-compatible with Arial, SIL OFL-1.1 — see assets/fonts/LICENSE) embedded as data URIs under the name
 * "Arial", only injected at PDF time so `rendered_html` / `rendered_hash` never change. Built once per isolate.
 */
import latin400 from "../assets/fonts/arimo-latin-400-normal.woff2";
import latin700 from "../assets/fonts/arimo-latin-700-normal.woff2";
import latinExt400 from "../assets/fonts/arimo-latin-ext-400-normal.woff2";
import latinExt700 from "../assets/fonts/arimo-latin-ext-700-normal.woff2";
import vi400 from "../assets/fonts/arimo-vietnamese-400-normal.woff2";
import vi700 from "../assets/fonts/arimo-vietnamese-700-normal.woff2";

// unicode-range per subset, from @fontsource/arimo 5.3.0 (latin / latin-ext / vietnamese css)
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";
const VIETNAMESE =
  "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB";

function base64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

function face(data: ArrayBuffer, weight: number, range: string): string {
  return `@font-face{font-family:"Arial";font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${base64(data)}) format("woff2");unicode-range:${range}}`;
}

let cached: string | undefined;

export function fontCss(): string {
  cached ??=
    face(latin400, 400, LATIN) +
    face(latin700, 700, LATIN) +
    face(latinExt400, 400, LATIN_EXT) +
    face(latinExt700, 700, LATIN_EXT) +
    face(vi400, 400, VIETNAMESE) +
    face(vi700, 700, VIETNAMESE);
  return cached;
}
