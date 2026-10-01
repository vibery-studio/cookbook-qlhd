import { useSyncExternalStore } from "react";

const MOBILE_QUERY = "(max-width: 767.98px)";
const canMatch = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

/** 390px layout switch: the table becomes cards (SPEC-08 §3.6). */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (!canMatch()) return () => undefined;
      const mq = window.matchMedia(MOBILE_QUERY);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => (canMatch() ? window.matchMedia(MOBILE_QUERY).matches : false),
    () => false,
  );
}
