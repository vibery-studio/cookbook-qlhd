import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components, Problem } from "@runway/client";
import { ApiProblemError, client } from "../../lib/client";
import { ROLES_KEY } from "../../app/roles-query";

/** C-11-001 — cơ chế duyệt 2 lớp khi đổi quyền (GET: roles:write | security:write; PUT: security:write). */
export type TwoLayer = components["schemas"]["TwoLayerSetting"];
export const TWO_LAYER_KEY = ["security", "two-layer"] as const;

function asProblem(error: unknown, status: number): Problem {
  if (error && typeof error === "object" && "type" in error && "status" in error) return error as Problem;
  return { type: "about:blank", title: "", status };
}

export function useTwoLayer() {
  return useQuery({
    queryKey: TWO_LAYER_KEY,
    queryFn: async (): Promise<TwoLayer> => {
      const { data, error, response } = await client.typed.GET("/security/two-layer", {});
      if (response.ok && data) return data;
      throw new ApiProblemError(asProblem(error, response.status));
    },
  });
}

export function useSetTwoLayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { enabled: boolean; reason: string }): Promise<TwoLayer> => {
      const { data, error, response } = await client.typed.PUT("/security/two-layer", { body });
      if (response.ok && data) return data;
      throw new ApiProblemError(asProblem(error, response.status));
    },
    onSuccess: (data) => qc.setQueryData(TWO_LAYER_KEY, data),
    onSettled: () => void qc.invalidateQueries({ queryKey: ROLES_KEY }),
  });
}
