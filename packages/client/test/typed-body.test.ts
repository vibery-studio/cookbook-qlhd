import { describe, it, expect } from "vitest";
import { createClient } from "../src/runtime/client";

// A browser's fetch() rejects a ReadableStream body without `duplex: "half"` before any
// network I/O — every typed write from the SPA failed that way. `new Request(url, init)` applies
// the same WHATWG rule here.
describe("typed client request body", () => {
  it("sends the JSON body on a write, and again on the retry after a refresh", async () => {
    const bodies: string[] = [];
    let writes = 0;
    const client = createClient({
      baseUrl: "http://api",
      fetch: async (input, init) => {
        const req = new Request(input, init);
        if (req.url.endsWith("/auth/refresh")) return new Response("{}", { status: 200 });
        bodies.push(await req.text());
        writes += 1;
        return writes === 1
          ? new Response(JSON.stringify({ status: 401 }), { status: 401 })
          : new Response(JSON.stringify({ id: "c1" }), { status: 201, headers: { "content-type": "application/json" } });
      },
    });

    const { response } = await client.typed.POST("/customers", {
      body: { name: "Cửa hàng Hoa Mai" },
      params: { header: { "Idempotency-Key": "018f0000-0000-7000-8000-000000000000" } },
    });

    expect(response.status).toBe(201);
    expect(bodies).toEqual([JSON.stringify({ name: "Cửa hàng Hoa Mai" }), JSON.stringify({ name: "Cửa hàng Hoa Mai" })]);
  });
});
