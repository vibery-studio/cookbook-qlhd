import {
  ClientError,
  createClient,
  type Problem,
  type Result,
} from "@runway/client";
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: false,
      staleTime: 60_000,
    },
    mutations: {
      retry: false,
    },
  },
});

const browserBaseUrl = typeof window === "undefined" ? "http://localhost:8787" : window.location.origin;
const apiOrigin = import.meta.env.DEV ? "http://localhost:8787" : browserBaseUrl;

export const client = createClient({
  baseUrl: browserBaseUrl,
  origin: apiOrigin,
  onUnauthorized: () => onSessionLost(queryClient),
});

/**
 * Session gone (refresh failed): re-check /me so the guard sees its 401 and sends the user to /login.
 * Never remove the query — when /me itself triggered this, removing it mid-fetch left the guard
 * pending forever ("Đang kiểm tra phiên"). `cancelRefetch: false` lets that in-flight /me settle.
 */
export function onSessionLost(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["me"], exact: true }, { cancelRefetch: false });
}

export const apiClient = client;

export class ApiProblemError extends Error {
  override readonly name = "ApiProblemError";

  constructor(public readonly problem: Problem) {
    super(problem.type);
  }
}

export function isApiProblemError(error: unknown): error is ApiProblemError {
  return error instanceof ApiProblemError;
}

export function isClientError(error: unknown): error is ClientError {
  return error instanceof ClientError;
}

export function unwrapResult<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new ApiProblemError(result.problem);
  }
  return result.data;
}
