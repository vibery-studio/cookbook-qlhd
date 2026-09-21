/**
 * createClient({ baseUrl, ... }) — the public entry point. Wraps
 * openapi-fetch with:
 *   - cookie-auth (browser: credentials: include; Node: caller opts in)
 *   - CSRF headers on mutating verbs (Origin + X-Requested-With)
 *   - auto-refresh on 401 (single-flight; retry-once — see auto-refresh.ts)
 *   - Result<Success, Problem> return shape
 *
 * Types come from openapi-typescript (`src/generated/types.ts`) — the
 * `paths` interface is the single source of truth. Adding a route to
 * the API + running `pnpm --filter @runway/client generate` produces
 * a compile-time-typed method automatically.
 */
import createOpenAPIClient, { type Client } from "openapi-fetch";
import type { paths } from "../generated/types";
import { createAutoRefresh } from "./auto-refresh";
import { type Problem, type Result, err, ok } from "./result";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Success body type for a given (path, method) pair. */
type SuccessBody<Path extends keyof paths, Method extends keyof paths[Path], Status extends number> =
  paths[Path][Method] extends {
    responses: infer R;
  }
    ? R extends Record<Status, { content: { "application/json": infer T } }>
      ? T
      : never
    : never;

export interface CreateClientOptions {
  baseUrl: string;
  /**
   * Custom fetch. Defaults to global `fetch`. Provide for Node
   * environments that need a cookie-jar (e.g. `node-fetch` + tough-cookie)
   * or for injecting a spy in tests.
   */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /**
   * Called when a 401 survives an auto-refresh attempt. Consumer
   * typically redirects to login.
   */
  onUnauthorized?: () => void;
  /**
   * Origin sent on the CSRF `Origin` header for mutating requests.
   * Defaults to `baseUrl`. Override when the browser origin differs
   * from the API origin (unlikely in same-origin blueprints).
   */
  origin?: string;
}

export interface RunwayClient {
  /**
   * The raw openapi-fetch client for callers who want direct method
   * access (`typed.GET("/me")`). The friendlier per-operation wrappers
   * live at the top level (`client.me()`, `client.signup(...)`).
   */
  readonly typed: Client<paths>;

  signup(input: { email: string; password: string }): Promise<
    Result<SuccessBody<"/auth/signup", "post", 201>>
  >;
  verify(input: { token: string }): Promise<Result<SuccessBody<"/auth/verify", "post", 200>>>;
  login(input: { email: string; password: string }): Promise<
    Result<SuccessBody<"/auth/login", "post", 200>>
  >;
  logout(): Promise<Result<SuccessBody<"/auth/logout", "post", 200>>>;
  refresh(): Promise<Result<SuccessBody<"/auth/refresh", "post", 200>>>;
  me(): Promise<Result<SuccessBody<"/me", "get", 200>>>;
}

export function createClient(options: CreateClientOptions): RunwayClient {
  const origin = options.origin ?? options.baseUrl;
  const baseFetch =
    options.fetch ??
    ((input: string, init?: RequestInit) => globalThis.fetch(input, init));

  const augmentedFetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    if (MUTATING_METHODS.has(method)) {
      if (!headers.has("origin")) headers.set("origin", origin);
      if (!headers.has("x-requested-with")) headers.set("x-requested-with", "fetch");
    }
    return baseFetch(input, {
      ...init,
      headers,
      credentials: init?.credentials ?? "include",
    });
  };

  const withAutoRefresh = createAutoRefresh({
    baseUrl: options.baseUrl,
    fetcher: augmentedFetch,
    onUnauthorized: options.onUnauthorized,
  });

  const typed = createOpenAPIClient<paths>({
    baseUrl: options.baseUrl,
    fetch: async (request: Request) => {
      const init: RequestInit = {
        method: request.method,
        headers: request.headers,
        body: request.body,
        credentials: request.credentials,
      };
      return withAutoRefresh(() => augmentedFetch(request.url, init));
    },
  });

  async function toResult<S>(
    p: Promise<{ data?: S; error?: unknown; response: Response }>,
  ): Promise<Result<S>> {
    const { data, error, response } = await p;
    if (response.ok && data !== undefined) return ok<S>(response.status, data);
    const problem: Problem = isProblem(error)
      ? error
      : {
          type: "about:blank",
          title: response.statusText || "Request failed",
          status: response.status,
        };
    return err<S>(response.status, problem);
  }

  return {
    typed,

    async signup(input) {
      return toResult(
        typed.POST("/auth/signup", { body: input }) as unknown as Promise<{
          data?: SuccessBody<"/auth/signup", "post", 201>;
          error?: unknown;
          response: Response;
        }>,
      );
    },

    async verify(input) {
      return toResult(
        typed.POST("/auth/verify", { body: input }) as unknown as Promise<{
          data?: SuccessBody<"/auth/verify", "post", 200>;
          error?: unknown;
          response: Response;
        }>,
      );
    },

    async login(input) {
      return toResult(
        typed.POST("/auth/login", { body: input }) as unknown as Promise<{
          data?: SuccessBody<"/auth/login", "post", 200>;
          error?: unknown;
          response: Response;
        }>,
      );
    },

    async logout() {
      return toResult(
        typed.POST("/auth/logout", {}) as unknown as Promise<{
          data?: SuccessBody<"/auth/logout", "post", 200>;
          error?: unknown;
          response: Response;
        }>,
      );
    },

    async refresh() {
      return toResult(
        typed.POST("/auth/refresh", {}) as unknown as Promise<{
          data?: SuccessBody<"/auth/refresh", "post", 200>;
          error?: unknown;
          response: Response;
        }>,
      );
    },

    async me() {
      return toResult(
        typed.GET("/me", {}) as unknown as Promise<{
          data?: SuccessBody<"/me", "get", 200>;
          error?: unknown;
          response: Response;
        }>,
      );
    },
  };
}

function isProblem(value: unknown): value is Problem {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v["type"] === "string" && typeof v["title"] === "string" && typeof v["status"] === "number";
}
