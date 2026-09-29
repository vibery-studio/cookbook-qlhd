import { useQuery } from "@tanstack/react-query";
import { client } from "../../lib/client";
import { problemMessage } from "../../lib/problem-messages";

/** Shared by the queue screen, the nav pill and card 003 (invalidate ["approvals"] after any decision). */
export const APPROVALS_KEY = ["approvals"] as const;
export const APPROVALS_COUNT_KEY = ["approvals", "count"] as const;

export const APPROVALS_LIMIT = 50;

export class ApprovalsLoadError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
  }
}

export async function fetchApprovalQueue() {
  const { data, error, response } = await client.typed.GET("/approvals/mine", {
    params: { query: { limit: APPROVALS_LIMIT } },
  });
  if (response.ok && data) return data;
  const problem =
    error && typeof error === "object" && "type" in error
      ? (error as { type: string; title: string; status: number })
      : { type: "about:blank", title: response.statusText, status: response.status };
  throw new ApprovalsLoadError(problemMessage(problem).message);
}

/** Pill text: nothing at 0, "50+" while another page exists, else the number. */
export function formatApprovalCount(queue: { items: readonly unknown[]; next_cursor: string | null } | undefined): number | string | undefined {
  if (!queue) return undefined;
  if (queue.next_cursor !== null) return `${APPROVALS_LIMIT}+`;
  return queue.items.length === 0 ? undefined : queue.items.length;
}

/** One query for screen + pill. staleTime 0 so a window focus always refetches; no polling. */
export function useApprovalQueue(enabled: boolean) {
  return useQuery({
    queryKey: APPROVALS_COUNT_KEY,
    queryFn: fetchApprovalQueue,
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
