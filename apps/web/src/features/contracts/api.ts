import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { components, Problem } from "@runway/client";
import { ApiProblemError, client } from "../../lib/client";
import { problemMessage } from "../../lib/problem-messages";

export type Contract = components["schemas"]["Contract"];
export type ContractListItem = components["schemas"]["ContractListItem"];
export type ContractCounts = components["schemas"]["ContractCounts"];
export type ContractValues = components["schemas"]["ContractValues"];
export type ContractStatus = Contract["status"];
export type TemplateListItem = components["schemas"]["TemplateListItem"];
export type TemplateDetail = components["schemas"]["TemplateDetail"];
export type TemplateField = components["schemas"]["TemplateField"];
export type AuditEvent = components["schemas"]["AuditEvent"];

export const CONTRACTS_KEY = ["contracts"] as const;
export const contractKey = (id: string) => ["contract", id] as const;
export const PAGE_SIZE = 50;

export type Raw<T> = Promise<{ data?: T; error?: unknown; response: Response }>;

function asProblem(error: unknown, status: number): Problem {
  if (error && typeof error === "object" && "type" in error && "status" in error) return error as Problem;
  return { type: "about:blank", title: "", status };
}

export async function unwrap<T>(request: Raw<T>): Promise<T> {
  const { data, error, response } = await request;
  if (response.ok && data !== undefined) return data;
  throw new ApiProblemError(asProblem(error, response.status));
}

/** Vietnamese message for anything thrown by a request (Problem+JSON or a network failure). */
export function errorMessage(error: unknown): { message: string; status?: number; reload: boolean; fieldErrors: Record<string, string> } {
  if (error instanceof ApiProblemError) {
    const m = problemMessage(error.problem, {}, { resource: "contract" });
    return { message: m.message, status: error.problem.status, reload: m.reload === true, fieldErrors: m.fieldErrors };
  }
  return { message: "Hệ thống đang bận, thử lại sau.", reload: false, fieldErrors: {} };
}

export type ContractFilters = { customerId?: string; createdBy?: string; templateId?: string };

export function useContractList(status: ContractStatus | undefined, filters: ContractFilters) {
  return useInfiniteQuery({
    queryKey: ["contracts", { status: status ?? null, filters }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        client.typed.GET("/contracts", {
          params: {
            query: {
              limit: PAGE_SIZE,
              ...(status ? { status } : {}),
              ...(filters.customerId ? { customer_id: filters.customerId } : {}),
              ...(filters.createdBy ? { created_by: filters.createdBy } : {}),
              ...(filters.templateId ? { template_id: filters.templateId } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }) as Raw<components["schemas"]["ContractList"]>,
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: 0,
  });
}

export function useContract(id: string, enabled = true) {
  return useQuery({
    queryKey: contractKey(id),
    enabled,
    queryFn: () => unwrap(client.typed.GET("/contracts/{id}", { params: { path: { id } } }) as Raw<Contract>),
    staleTime: 0,
  });
}

export function useContractAudit(id: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["contract-audit", id],
    initialPageParam: undefined as string | undefined,
    enabled,
    queryFn: ({ pageParam }) =>
      unwrap(
        client.typed.GET("/contracts/{id}/audit", {
          params: { path: { id }, query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } },
        }) as Raw<components["schemas"]["AuditList"]>,
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: 0,
  });
}

/** Same key + shape as the templates screen (an array of list items): the cache is shared. */
export function useTemplates() {
  return useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await unwrap(client.typed.GET("/templates", {}) as Raw<components["schemas"]["TemplateList"]>)).items,
  });
}

export function useTemplate(id: string | undefined) {
  return useQuery({
    queryKey: ["template", id],
    enabled: Boolean(id),
    queryFn: () => unwrap(client.typed.GET("/templates/{id}", { params: { path: { id: id as string } } }) as Raw<TemplateDetail>),
  });
}

type AnyPost = (path: string, init: unknown) => Raw<Contract>;

export type ContractAction = "submit" | "approve" | "reject" | "issue" | "void" | "copy" | "withdraw";

export function postAction(action: ContractAction, id: string, body: Record<string, unknown>, idempotencyKey?: string): Promise<Contract> {
  const post = (client.typed as unknown as { POST: AnyPost }).POST;
  return unwrap(
    post(`/contracts/{id}/${action}`, {
      params: { path: { id }, ...(idempotencyKey ? { header: { "Idempotency-Key": idempotencyKey } } : {}) },
      body,
    }),
  );
}

export async function createContract(body: components["schemas"]["CreateContractRequest"], idempotencyKey: string): Promise<Contract> {
  return unwrap(
    client.typed.POST("/contracts", { body, params: { header: { "Idempotency-Key": idempotencyKey } } }) as Raw<Contract>,
  );
}

export async function updateContract(id: string, body: components["schemas"]["UpdateContractRequest"]): Promise<Contract> {
  return unwrap(client.typed.PATCH("/contracts/{id}", { params: { path: { id } }, body }) as Raw<Contract>);
}

export async function deleteContract(id: string): Promise<void> {
  const { error, response } = await client.typed.DELETE("/contracts/{id}", { params: { path: { id } } });
  if (response.ok) return;
  throw new ApiProblemError(asProblem(error, response.status));
}
