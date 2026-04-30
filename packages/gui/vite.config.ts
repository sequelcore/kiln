/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { fileURLToPath } from "node:url";

const gatewayPort = Number.parseInt(process.env.GUI_GATEWAY_PORT ?? "4810", 10);
const resolvedGatewayPort = Number.isFinite(gatewayPort) && gatewayPort > 0 ? gatewayPort : 4810;

export default defineConfig({
  base: "/gui/",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    TanStackRouterVite({ routesDirectory: "src/routes", generatedRouteTree: "src/routeTree.gen.ts" }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5183,
    proxy: {
      "/health": {
        target: `http://localhost:${resolvedGatewayPort}`,
        changeOrigin: true,
      },
      "/gui/api": {
        target: `http://localhost:${resolvedGatewayPort}`,
        changeOrigin: true,
      },
      "/gui-api": {
        target: `http://localhost:${resolvedGatewayPort}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gui-api/, ""),
      },
      "/gui-ws": {
        target: `ws://localhost:${resolvedGatewayPort}`,
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gui-ws/, ""),
      },
      "/gui/ws": {
        target: `ws://localhost:${resolvedGatewayPort}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["**/tests/parity/**", "**/node_modules/**", "**/dist/**"],
  },
});
