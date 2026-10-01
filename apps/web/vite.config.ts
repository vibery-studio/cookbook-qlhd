import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type ProxyOptions } from "vite";

const apiTarget = "http://localhost:8787";
const apiPrefixes = [
  "/auth",
  "/me",
  "/roles",
  "/audit",
  "/customers",
  "/products",
  "/pricing",
  "/contracts",
  "/approvals",
  "/role-change-requests",
  "/sod-pairs",
  "/access-reviews",
  "/admin",
  "/templates",
  "/demo",
  "/healthz",
  "/readyz",
  "/docs",
  "/openapi.json",
] as const;

function apiProxy(): ProxyOptions {
  return {
    target: apiTarget,
    changeOrigin: false,
    headers: { Origin: apiTarget },
    configure(proxy) {
      proxy.on("proxyReq", (proxyRequest) => {
        proxyRequest.setHeader("Origin", apiTarget);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(apiPrefixes.map((prefix) => [prefix, apiProxy()])),
  },
});
