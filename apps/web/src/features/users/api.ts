import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { components, Problem } from "@runway/client";
import { ApiProblemError, client } from "../../lib/client";
import { networkProblemMessage, problemMessage, problemSlug } from "../../lib/problem-messages";

export type AdminUser = components["schemas"]["AdminUser"];
export type ActivationLink = { url: string; expiresAt: number };

const PAGE_SIZE = 50;

type Raw<T> = Promise<{ data?: T; error?: unknown; response: Response }>;

async function unwrap<T>(request: Raw<T>): Promise<T | undefined> {
  const { data, error, response } = await request;
  if (response.ok) return data;
  const problem: Problem =
    error && typeof error === "object" && "type" in error && "status" in error
      ? (error as Problem)
      : { type: "about:blank", title: "", status: response.status };
  throw new ApiProblemError(problem);
}

/** Vietnamese message for any failure; `conflict` on invite means the email is taken. */
export function errorText(error: unknown, context?: "invite"): string {
  if (error instanceof ApiProblemError) {
    if (context === "invite" && problemSlug(error.problem.type) === "conflict") return "Email này đã có tài khoản";
    return problemMessage(error.problem).message;
  }
  return networkProblemMessage();
}

export function useUsers() {
  return useInfiniteQuery({
    queryKey: ["users"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const data = await unwrap(
        client.typed.GET("/admin/users", { params: { query: { limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) } } }) as Raw<{
          items: AdminUser[];
          next_cursor: string | null;
        }>,
      );
      return data ?? { items: [], next_cursor: null };
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: 0,
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; display_name: string; role: string; key: string }): Promise<ActivationLink> => {
      const { key, ...body } = input;
      const data = await unwrap(
        client.typed.POST("/admin/users", { body, params: { header: { "Idempotency-Key": key } } }) as Raw<{
          activation_url: string;
          expires_at: number;
        }>,
      );
      if (!data) throw new ApiProblemError({ type: "about:blank", title: "", status: 500 });
      return { url: data.activation_url, expiresAt: data.expires_at };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useReinvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<ActivationLink> => {
      const data = await unwrap(
        client.typed.POST("/admin/users/{id}/invite", { params: { path: { id } } }) as Raw<{
          activation_url: string;
          expires_at: number;
        }>,
      );
      if (!data) throw new ApiProblemError({ type: "about:blank", title: "", status: 500 });
      return { url: data.activation_url, expiresAt: data.expires_at };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; role?: string; status?: "active" | "disabled" }) => {
      const { id, ...body } = input;
      await unwrap(client.typed.PATCH("/admin/users/{id}", { params: { path: { id } }, body }) as Raw<AdminUser>);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}
