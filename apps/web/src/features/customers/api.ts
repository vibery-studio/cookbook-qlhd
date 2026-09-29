import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components, Problem } from "@runway/client";
import { ApiProblemError, client } from "../../lib/client";

export type Customer = components["schemas"]["Customer"];
export type CustomerFormValues = {
  name: string;
  contact_person: string;
  tax_code: string;
  phone: string;
  email: string;
  address: string;
};

type CreateCustomerRequest = components["schemas"]["CreateCustomerRequest"];
type UpdateCustomerRequest = components["schemas"]["UpdateCustomerRequest"];

const PAGE_SIZE = 50;

type Raw<T> = Promise<{ data?: T; error?: unknown; response: Response }>;

function asProblem(error: unknown, status: number): Problem {
  if (error && typeof error === "object" && "type" in error && "status" in error) {
    return error as Problem;
  }
  return { type: "about:blank", title: "", status };
}

async function unwrap<T>(request: Raw<T>): Promise<T> {
  const { data, error, response } = await request;
  if (response.ok && data !== undefined) return data;
  throw new ApiProblemError(asProblem(error, response.status));
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function emptyCustomerForm(): CustomerFormValues {
  return {
    name: "",
    contact_person: "",
    tax_code: "",
    phone: "",
    email: "",
    address: "",
  };
}

export function customerToForm(customer: Customer): CustomerFormValues {
  return {
    name: customer.name,
    contact_person: customer.contact_person ?? "",
    tax_code: customer.tax_code ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    address: customer.address ?? "",
  };
}

/** Keep the phone exactly as entered; the API owns phone normalization. */
export function toCustomerPayload(values: CustomerFormValues): CreateCustomerRequest {
  return {
    name: values.name.trim(),
    ...(optionalText(values.contact_person) ? { contact_person: values.contact_person.trim() } : {}),
    ...(optionalText(values.tax_code) ? { tax_code: values.tax_code.trim() } : {}),
    ...(values.phone.trim() ? { phone: values.phone } : {}),
    ...(optionalText(values.email) ? { email: values.email.trim() } : {}),
    ...(optionalText(values.address) ? { address: values.address.trim() } : {}),
  };
}

async function fetchCustomers(search: string, cursor?: string): Promise<{ items: Customer[]; next_cursor: string | null }> {
  return unwrap(
    client.typed.GET("/customers", {
      params: {
        query: {
          limit: PAGE_SIZE,
          ...(search ? { q: search } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
    }) as Raw<{ items: Customer[]; next_cursor: string | null }>,
  );
}

async function fetchCustomer(id: string): Promise<Customer> {
  return unwrap(
    client.typed.GET("/customers/{id}", { params: { path: { id } } }) as Raw<Customer>,
  );
}

export function useCustomers(search: string) {
  return useInfiniteQuery({
    queryKey: ["customers", "list", search],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchCustomers(search, pageParam),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    staleTime: 0,
  });
}

export function useCustomer(id: string | undefined, enabled = Boolean(id)) {
  return useQuery({
    queryKey: ["customers", "detail", id],
    queryFn: () => fetchCustomer(id as string),
    enabled: Boolean(id) && enabled,
    staleTime: 0,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { body: CreateCustomerRequest; idempotencyKey: string }): Promise<Customer> =>
      unwrap(
        client.typed.POST("/customers", {
          body: input.body,
          params: { header: { "Idempotency-Key": input.idempotencyKey } },
        }) as Raw<Customer>,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; body: UpdateCustomerRequest }): Promise<Customer> =>
      unwrap(
        client.typed.PATCH("/customers/{id}", {
          params: { path: { id: input.id } },
          body: input.body,
        }) as Raw<Customer>,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}
