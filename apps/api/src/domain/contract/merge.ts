const KEY_RE = /^[a-z][a-z0-9_]*$/;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function addLeftover(leftover: string[], seen: Set<string>, value: string): void {
  if (seen.has(value)) return;
  seen.add(value);
  leftover.push(value);
}

function isNonEmpty(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

function findMatchingIf(body: string, from: number, end: number): { contentEnd: number; closeEnd: number } | null {
  let depth = 1;
  let cursor = from;
  while (cursor < end) {
    const open = body.indexOf("{{", cursor);
    if (open < 0 || open >= end) return null;
    const close = body.indexOf("}}", open + 2);
    if (close < 0 || close + 2 > end) return null;
    const inner = body.slice(open + 2, close);
    if (inner.startsWith("#if ")) depth += 1;
    else if (inner === "/if") {
      depth -= 1;
      if (depth === 0) return { contentEnd: open, closeEnd: close + 2 };
    }
    cursor = close + 2;
  }
  return null;
}

export function mergeFields(body: string, values: Record<string, string>): { html: string; leftover: string[] } {
  const leftover: string[] = [];
  const seen = new Set<string>();

  const mergeRange = (from: number, end: number): string => {
    let html = "";
    let cursor = from;
    while (cursor < end) {
      const open = body.indexOf("{{", cursor);
      if (open < 0 || open >= end) {
        html += body.slice(cursor, end);
        break;
      }
      html += body.slice(cursor, open);
      const close = body.indexOf("}}", open + 2);
      if (close < 0 || close + 2 > end) {
        const token = body.slice(open, end);
        addLeftover(leftover, seen, token);
        html += token;
        break;
      }

      const token = body.slice(open, close + 2);
      const inner = body.slice(open + 2, close);
      if (inner.startsWith("#if ") && KEY_RE.test(inner.slice(4))) {
        const key = inner.slice(4);
        const matching = findMatchingIf(body, close + 2, end);
        if (matching === null) {
          addLeftover(leftover, seen, key);
          html += token;
          cursor = close + 2;
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(values, key)) {
          const content = mergeRange(close + 2, matching.contentEnd);
          addLeftover(leftover, seen, key);
          html += token + content + body.slice(matching.contentEnd, matching.closeEnd);
        } else if (isNonEmpty(values[key])) {
          html += mergeRange(close + 2, matching.contentEnd);
        }
        cursor = matching.closeEnd;
        continue;
      }

      if (inner === "/if") {
        addLeftover(leftover, seen, token);
        html += token;
        cursor = close + 2;
        continue;
      }

      if (KEY_RE.test(inner) && Object.prototype.hasOwnProperty.call(values, inner)) {
        html += escapeHtml(values[inner] ?? "");
      } else {
        addLeftover(leftover, seen, KEY_RE.test(inner) ? inner : token);
        html += token;
      }
      cursor = close + 2;
    }
    return html;
  };

  return { html: mergeRange(0, body.length), leftover };
}
