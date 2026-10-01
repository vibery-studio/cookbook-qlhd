import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components, Problem } from "@runway/client";
import { ApiProblemError, client } from "../../lib/client";
import { networkProblemMessage, problemMessage } from "../../lib/problem-messages";

export type CurrentReview = components["schemas"]["CurrentAccessReview"];
export type ReviewItem = components["schemas"]["AccessReviewItem"];

export const CURRENT_REVIEW_KEY = ["access-review", "current"] as const;

function asProblem(error: unknown, status: number): Problem {
  if (error && typeof error === "object" && "type" in error && "status" in error) return error as Problem;
  return { type: "about:blank", title: "", status };
}

export function reviewErrorText(error: unknown): string {
  return error instanceof ApiProblemError ? problemMessage(error.problem).message : networkProblemMessage();
}

async function fetchCurrent(): Promise<CurrentReview> {
  const { data, error, response } = await client.typed.GET("/access-reviews/current", {});
  if (response.ok && data) return data;
  throw new ApiProblemError(asProblem(error, response.status));
}

/** The open review (else this quarter's) with the caller's rows. Gate: reviews:write or roles:write. */
export function useCurrentReview(enabled: boolean) {
  return useQuery({ queryKey: CURRENT_REVIEW_KEY, queryFn: fetchCurrent, enabled, staleTime: 0, refetchOnWindowFocus: true });
}

function useReviewMutation<T>(run: (input: T) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    // A "Gỡ" disables the account: refresh the people list too. A stale/changed row (409) reloads the table.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: CURRENT_REVIEW_KEY });
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useStartReview() {
  return useReviewMutation<void>(async () => {
    const { error, response } = await client.typed.POST("/access-reviews", {});
    if (response.ok) return;
    throw new ApiProblemError(asProblem(error, response.status));
  });
}

export function useDecideItem() {
  return useReviewMutation<{ reviewId: string; userId: string; decision: "keep" | "remove" }>(async ({ reviewId, userId, decision }) => {
    const { error, response } = await client.typed.POST("/access-reviews/{id}/items/{userId}", {
      params: { path: { id: reviewId, userId } },
      body: { decision },
    });
    if (response.ok) return;
    throw new ApiProblemError(asProblem(error, response.status));
  });
}

export function useCloseReview() {
  return useReviewMutation<{ reviewId: string }>(async ({ reviewId }) => {
    const { error, response } = await client.typed.POST("/access-reviews/{id}/close", { params: { path: { id: reviewId } } });
    if (response.ok) return;
    throw new ApiProblemError(asProblem(error, response.status));
  });
}
