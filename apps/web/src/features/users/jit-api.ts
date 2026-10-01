import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components, Problem } from "@runway/client";
import { ApiProblemError, client } from "../../lib/client";

export type JitGrant = components["schemas"]["JitGrant"];
export const JIT_GRANTS_KEY = ["jit-grants"] as const;

function asProblem(error: unknown, status: number): Problem {
  if (error && typeof error === "object" && "type" in error && "status" in error) return error as Problem;
  return { type: "about:blank", title: "", status };
}

async function fetchActiveGrants(): Promise<JitGrant[]> {
  const { data, error, response } = await client.typed.GET("/admin/jit-grants", { params: { query: { active: "true" } } });
  if (response.ok && data) return data.items;
  throw new ApiProblemError(asProblem(error, response.status));
}

/** Active temporary-admin grants (users:read). */
export function useActiveJitGrants(enabled: boolean) {
  return useQuery({ queryKey: JIT_GRANTS_KEY, queryFn: fetchActiveGrants, enabled, staleTime: 0 });
}

export function useGrantJit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { user_id: string; reason: string; minutes: number; key: string }): Promise<JitGrant> => {
      const { key, ...body } = input;
      const { data, error, response } = await client.typed.POST("/admin/jit-grants", {
        body,
        params: { header: { "Idempotency-Key": key } },
      });
      if (response.ok && data) return data;
      throw new ApiProblemError(asProblem(error, response.status));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: JIT_GRANTS_KEY }),
  });
}

async function revokeGrant(id: string): Promise<void> {
  const { error, response } = await client.typed.POST("/admin/jit-grants/{id}/revoke", { params: { path: { id } } });
  if (response.ok) return;
  throw new ApiProblemError(asProblem(error, response.status));
}

/** Granter ends a grant by id (Thu hồi ngay). */
export function useRevokeJit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string }) => revokeGrant(input.id),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: JIT_GRANTS_KEY });
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

/** Recipient ends their own grant (Kết thúc sớm): find the active grant, revoke it, then /me → the menu is back at once. */
export function useEndMyJit(myId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const grants = await fetchActiveGrants();
      const mine = grants.find((g) => g.user_id === myId && g.state === "active");
      if (mine) await revokeGrant(mine.id);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: JIT_GRANTS_KEY });
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

/** Re-render every `everyMs` so countdowns stay fresh. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
