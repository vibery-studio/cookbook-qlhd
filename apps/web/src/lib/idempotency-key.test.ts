import { describe, expect, it } from "vitest";
import { createIdempotencyKeeper } from "./idempotency-key";

function counter() {
  let n = 0;
  return () => `key-${++n}`;
}

describe("createIdempotencyKeeper", () => {
  it("keeps the same key when the same content is sent again", () => {
    const keeper = createIdempotencyKeeper(counter());
    const first = keeper.keyFor("a");
    expect(keeper.keyFor("a")).toBe(first);
    expect(keeper.keyFor("a")).toBe(first);
  });

  it("issues a new key when the content changes", () => {
    const keeper = createIdempotencyKeeper(counter());
    const first = keeper.keyFor("a");
    const second = keeper.keyFor("b");
    expect(second).not.toBe(first);
    expect(keeper.keyFor("b")).toBe(second);
  });

  it("issues a new key after reset (modal reopened)", () => {
    const keeper = createIdempotencyKeeper(counter());
    const first = keeper.keyFor("a");
    keeper.reset();
    expect(keeper.keyFor("a")).not.toBe(first);
  });
});
