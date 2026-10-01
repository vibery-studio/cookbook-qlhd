import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { components, Problem } from "@runway/client";
import { ApiProblemError, client } from "../../lib/client";
import { problemMessage, problemSlug, type ProblemWithExtensions } from "../../lib/problem-messages";
import { ROLES_KEY, type Role, type RolesResponse } from "../../app/roles-query";

export type CreateRoleBody = components["schemas"]["CreateRoleRequest"];
export type PatchRoleBody = components["schemas"]["PatchRoleRequest"];
type Perms = CreateRoleBody["permissions"];

export const asPerms = (codes: readonly string[]): Perms => [...codes] as Perms;

function asProblem(error: unknown, status: number): Problem {
  if (error && typeof error === "object" && "type" in error && "status" in error) return error as Problem;
  return { type: "about:blank", title: "", status };
}

export type RoleError = {
  slug: string;
  message: string;
  holders?: number;
  fieldErrors: Record<string, string>;
  requestId?: string;
};

/** Vietnamese error for anything thrown by a role request (Problem+JSON or a network failure). */
export function roleError(error: unknown): RoleError {
  if (error instanceof ApiProblemError) {
    const problem = error.problem as ProblemWithExtensions;
    const m = problemMessage(problem, { label: "Tên vai trò", description: "Mô tả" }, { resource: "role" });
    return {
      slug: problemSlug(problem.type),
      message: m.message,
      ...(typeof problem.holders === "number" ? { holders: problem.holders } : {}),
      fieldErrors: m.fieldErrors,
      ...(m.requestId ? { requestId: m.requestId } : {}),
    };
  }
  return { slug: "network", message: "Hệ thống đang bận, thử lại sau.", fieldErrors: {} };
}

function putRole(qc: QueryClient, role: Role) {
  qc.setQueryData<RolesResponse>(ROLES_KEY, (old) =>
    old ? { ...old, items: old.items.map((r) => (r.id === role.id ? role : r)) } : old,
  );
}

/** A role changed: the matrix, and the caller's own /me (their permissions may have moved). */
function refresh(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ROLES_KEY });
  void qc.invalidateQueries({ queryKey: ["me"] });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { body: CreateRoleBody; idempotencyKey: string }): Promise<Role> => {
      const { data, error, response } = await client.typed.POST("/roles", {
        body: input.body,
        params: { header: { "Idempotency-Key": input.idempotencyKey } },
      });
      if (response.ok && data) return data;
      throw new ApiProblemError(asProblem(error, response.status));
    },
    onSettled: () => refresh(qc),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; body: PatchRoleBody }): Promise<Role> => {
      const { data, error, response } = await client.typed.PATCH("/roles/{id}", { params: { path: { id: input.id } }, body: input.body });
      if (response.ok && data) return data;
      throw new ApiProblemError(asProblem(error, response.status));
    },
    onSuccess: (role) => putRole(qc, role),
    onSettled: () => refresh(qc),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; expectedVersion: number }): Promise<void> => {
      const { error, response } = await client.typed.DELETE("/roles/{id}", {
        params: { path: { id: input.id }, query: { expected_version: input.expectedVersion } },
      });
      if (response.ok) return;
      throw new ApiProblemError(asProblem(error, response.status));
    },
    onSettled: () => refresh(qc),
  });
}
