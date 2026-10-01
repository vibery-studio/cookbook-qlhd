import { useQuery } from "@tanstack/react-query";
import type { components } from "@runway/client";
import { client } from "../lib/client";
import { problemMessage } from "../lib/problem-messages";
import { roleLabels } from "./me";

export type Role = components["schemas"]["Role"];
export type RolesResponse = components["schemas"]["RolesResponse"];

export const ROLES_KEY = ["roles"] as const;

export class RolesLoadError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
  }
}

export async function fetchRoles(): Promise<RolesResponse> {
  const { data, error, response } = await client.typed.GET("/roles", {});
  if (response.ok && data) return data;
  const problem =
    error && typeof error === "object" && "type" in error
      ? (error as { type: string; title: string; status: number })
      : { type: "about:blank", title: response.statusText, status: response.status };
  throw new RolesLoadError(problemMessage(problem, {}, { resource: "role" }).message);
}

/** GET /roles — `items` (with label, can, holders, version) + `catalog`. Shared by Phân quyền and Người dùng. */
export function useRoles() {
  return useQuery({ queryKey: ROLES_KEY, queryFn: fetchRoles, staleTime: 0 });
}

/** Display label of a role code: the API label, else the built-in system label, else the code itself. */
export function roleLabelOf(name: string, roles?: readonly Pick<Role, "name" | "label">[]): string {
  return roles?.find((r) => r.name === name)?.label ?? roleLabels[name] ?? name;
}

/** `(name) => label` bound to the loaded roles (falls back while loading). */
export function useRoleLabelOf(): (name: string) => string {
  const roles = useRoles().data?.items;
  return (name) => roleLabelOf(name, roles);
}
