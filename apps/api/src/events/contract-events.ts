/**
 * Contract event seam (SPEC-03 FR-10). Services call `emitContractEvent` AFTER the batch committed; a failing
 * listener must never fail the request. Later rows (mail, webhook, queue) subscribe with `onContractEvent`.
 */
import type { ContractDto } from "../dto/contracts";

export type ContractEventName =
  | "contract.created"
  | "contract.updated"
  | "contract.submitted"
  | "contract.approved"
  | "contract.rejected"
  | "contract.issued"
  | "contract.voided";

export type ContractEvent = { name: ContractEventName; contract: ContractDto };
export type ContractListener = (evt: ContractEvent) => void | Promise<void>;

/** Default listener: id + name only — never the snapshot (customer PII). */
const logListener: ContractListener = (evt) => {
  console.log(JSON.stringify({ ts: Date.now(), kind: "event", name: evt.name, id: evt.contract.id }));
};

const listeners: ContractListener[] = [logListener];

export function onContractEvent(fn: ContractListener): void {
  listeners.push(fn);
}

/** Test helper: back to just the default logger. */
export function resetContractListeners(): void {
  listeners.length = 0;
  listeners.push(logListener);
}

export function emitContractEvent(evt: ContractEvent): void {
  for (const fn of listeners) {
    try {
      const r = fn(evt);
      if (r instanceof Promise) r.catch((err: unknown) => reportListenerError(evt, err));
    } catch (err) {
      reportListenerError(evt, err);
    }
  }
}

function reportListenerError(evt: ContractEvent, err: unknown): void {
  console.error(
    JSON.stringify({
      ts: Date.now(),
      kind: "event.listener_failed",
      name: evt.name,
      id: evt.contract.id,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}
