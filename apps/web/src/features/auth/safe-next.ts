/**
 * Keep post-login navigation inside this SPA. A next value is a path only:
 * it must have one leading slash, never a scheme, host, or backslash.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.includes("\\")) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return null;
  return value;
}
