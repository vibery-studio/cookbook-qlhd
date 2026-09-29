import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Snapshot } from "./types";

function canonical(value: unknown, inArray = false): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "bigint") throw new TypeError("BigInt is not JSON-serializable");
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return inArray ? "null" : "";
  }
  if (value instanceof Date) return JSON.stringify(value.toJSON());
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, true)).join(",")}]`;

  const object = value as Record<string, unknown>;
  const entries = Object.keys(object)
    .sort()
    .flatMap((key) => {
      const encoded = canonical(object[key]);
      return encoded === "" ? [] : [`${JSON.stringify(key)}:${encoded}`];
    });
  return `{${entries.join(",")}}`;
}

export function canonicalJson(v: unknown): string {
  const result = canonical(v);
  return result === "" ? "null" : result;
}

export function sha256Hex(s: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(s)));
}

export function snapshotHash(s: Snapshot): string {
  return sha256Hex(canonicalJson(s));
}
