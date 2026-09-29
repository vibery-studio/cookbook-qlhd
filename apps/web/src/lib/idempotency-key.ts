import { useRef } from "react";

export type IdempotencyKeeper = {
  /** Same key for the same content (retries); a new key when the content changes. */
  keyFor(fingerprint: string): string;
  /** Call when the modal is (re)opened. */
  reset(): void;
};

export function createIdempotencyKeeper(generate: () => string = () => crypto.randomUUID()): IdempotencyKeeper {
  let current: { fingerprint: string; key: string } | null = null;
  return {
    keyFor(fingerprint) {
      if (!current || current.fingerprint !== fingerprint) current = { fingerprint, key: generate() };
      return current.key;
    },
    reset() {
      current = null;
    },
  };
}

export function useIdempotencyKeeper(): IdempotencyKeeper {
  const ref = useRef<IdempotencyKeeper | null>(null);
  ref.current ??= createIdempotencyKeeper();
  return ref.current;
}
