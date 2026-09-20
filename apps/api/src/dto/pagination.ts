import { z } from "zod";

/**
 * Cursor-based pagination query params. `limit` is coerced from the query
 * string (always a string over the wire) and clamped to [1, 100].
 */
export const CursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CursorQueryInput = z.infer<typeof CursorQuery>;

/**
 * Wraps an item schema in the standard paginated-list envelope:
 * `{ items: T[], next_cursor: string | null }`. `next_cursor` is `null`
 * (not omitted) when there is no further page, so clients can rely on the
 * field always being present.
 */
export function paginatedResponse<T extends z.ZodTypeAny>(schema: T) {
  return z.object({
    items: z.array(schema),
    next_cursor: z.string().nullable(),
  });
}
