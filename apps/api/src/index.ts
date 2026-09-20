import { Hono } from "hono";
import type { Bindings } from "./env";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/healthz", (c) => c.json({ ok: true }));

export default {
  fetch: app.fetch,
};
