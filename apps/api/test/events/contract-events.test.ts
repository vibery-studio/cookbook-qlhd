import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emitContractEvent,
  onContractEvent,
  resetContractListeners,
  type ContractEvent,
} from "../../src/events/contract-events";

const evt = { name: "contract.created", contract: { id: "01J0000000000000000000000A" } } as unknown as ContractEvent;

describe("contract events (FR-10)", () => {
  afterEach(() => {
    resetContractListeners();
    vi.restoreAllMocks();
  });

  it("a throwing listener neither stops the next listener nor throws from emit", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const seen: string[] = [];
    onContractEvent(() => {
      throw new Error("boom");
    });
    onContractEvent(() => Promise.reject(new Error("async boom")));
    onContractEvent((e) => {
      seen.push(e.name);
    });
    expect(() => emitContractEvent(evt)).not.toThrow();
    expect(seen).toEqual(["contract.created"]);
  });

  it("default listener logs name + id only, no snapshot", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    emitContractEvent({ name: "contract.issued", contract: { id: "X", snapshot: { customer: { phone: "0900" } } } } as unknown as ContractEvent);
    const line = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ kind: "event", name: "contract.issued", id: "X" });
    expect(line).not.toContain("0900");
  });
});
