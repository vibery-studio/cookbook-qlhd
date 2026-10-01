import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components, Problem } from "@runway/client";
import { ApiProblemError, client } from "../../lib/client";
import { problemMessage, problemSlug, type ProblemOptions, type ProblemWithExtensions } from "../../lib/problem-messages";

export type Product = components["schemas"]["Product"];
export type ProductDetail = components["schemas"]["ProductDetail"];
export type PriceHistoryItem = components["schemas"]["PriceHistoryItem"];
export type CreateProductBody = components["schemas"]["CreateProductBody"];
export type PatchProductBody = components["schemas"]["PatchProductBody"];
export type AddPriceBody = components["schemas"]["AddPriceBody"];

export type ProductTab = "all" | "service" | "goods" | "inactive";
export const PRODUCTS_KEY = ["products"] as const;

type Raw<T> = Promise<{ data?: T; error?: unknown; response: Response }>;

function asProblem(error: unknown, status: number): Problem {
  if (error && typeof error === "object" && "type" in error && "status" in error) return error as Problem;
  return { type: "about:blank", title: "", status };
}

async function unwrap<T>(request: Raw<T>): Promise<T> {
  const { data, error, response } = await request;
  if (response.ok && data !== undefined) return data;
  throw new ApiProblemError(asProblem(error, response.status));
}

export type ProductError = {
  slug: string;
  message: string;
  fieldErrors: Record<string, string>;
  requestId?: string;
  forbidden: boolean;
};

export const productFieldLabels: Record<string, string> = {
  code: "Mã",
  name: "Tên sản phẩm",
  unit: "Đơn vị tính",
  duration_value: "Thời hạn",
  duration_unit: "Thời hạn",
  unit_price_ex_vat: "Giá chưa VAT",
  vat_rate_bps: "Thuế suất",
  effective_from: "Áp dụng từ ngày",
  "first_price.unit_price_ex_vat": "Giá chưa VAT",
  "first_price.vat_rate_bps": "Thuế suất",
  "first_price.effective_from": "Áp dụng từ ngày",
};

/** Vietnamese error for a product / price request (Problem+JSON or a network failure). */
export function productError(error: unknown, resource: NonNullable<ProblemOptions["resource"]> = "product"): ProductError {
  if (error instanceof ApiProblemError) {
    const problem = error.problem as ProblemWithExtensions;
    const m = problemMessage(problem, productFieldLabels, { resource });
    const slug = problemSlug(problem.type);
    return {
      slug,
      message: m.message,
      fieldErrors: m.fieldErrors,
      ...(m.requestId ? { requestId: m.requestId } : {}),
      forbidden: problem.status === 403 || slug === "forbidden",
    };
  }
  return { slug: "network", message: "Hệ thống đang bận, thử lại sau.", fieldErrors: {}, forbidden: false };
}

export function useProducts(tab: ProductTab, q: string) {
  return useQuery({
    queryKey: [...PRODUCTS_KEY, "list", tab, q],
    queryFn: () =>
      unwrap(
        client.typed.GET("/products", {
          params: {
            query: {
              limit: 100,
              ...(tab === "service" || tab === "goods" ? { kind: tab } : {}),
              ...(tab === "all" ? {} : { active: tab === "inactive" ? "false" : "true" }),
              ...(q ? { q } : {}),
            },
          },
        }) as Raw<{ date: string; items: Product[] }>,
      ),
    staleTime: 0,
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: [...PRODUCTS_KEY, "detail", id],
    queryFn: () => unwrap(client.typed.GET("/products/{id}", { params: { path: { id } } }) as Raw<ProductDetail>),
    staleTime: 0,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: CreateProductBody; idempotencyKey: string }): Promise<Product> =>
      unwrap(client.typed.POST("/products", { body: input.body, params: { header: { "Idempotency-Key": input.idempotencyKey } } }) as Raw<Product>),
    onSettled: () => qc.invalidateQueries({ queryKey: PRODUCTS_KEY }),
  });
}

export function usePatchProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: PatchProductBody }): Promise<Product> =>
      unwrap(client.typed.PATCH("/products/{id}", { params: { path: { id: input.id } }, body: input.body }) as Raw<Product>),
    onSettled: () => qc.invalidateQueries({ queryKey: PRODUCTS_KEY }),
  });
}

export function useAddPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: AddPriceBody; idempotencyKey: string }) =>
      unwrap(
        client.typed.POST("/products/{id}/prices", {
          params: { path: { id: input.id }, header: { "Idempotency-Key": input.idempotencyKey } },
          body: input.body,
        }) as Raw<unknown>,
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: PRODUCTS_KEY }),
  });
}

export function useCancelPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; priceId: string }): Promise<void> => {
      const { error, response } = await (client.typed.DELETE("/products/{id}/prices/{priceId}", {
        params: { path: { id: input.id, priceId: input.priceId } },
      }) as Raw<unknown>);
      if (!response.ok) throw new ApiProblemError(asProblem(error, response.status));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PRODUCTS_KEY }),
  });
}
