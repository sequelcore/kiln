/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { fileURLToPath } from "node:url";

const gatewayPort = Number.parseInt(process.env.GUI_GATEWAY_PORT ?? "4810", 10);
const resolvedGatewayPort = Number.isFinite(gatewayPort) && gatewayPort > 0 ? gatewayPort : 4810;

function guiManualChunks(id: string): string | undefined {
  const normalized = id.replace(/\\/g, "/");
  if (normalized.includes("/packages/gateway-contracts/dist/")) {
    return "vendor-kiln-contracts";
  }
  if (!normalized.includes("/node_modules/")) {
    return undefined;
  }
  if (
    normalized.includes("/react/")
    || normalized.includes("/react-dom/")
    || normalized.includes("/scheduler/")
  ) {
    return "vendor-react-ui";
  }
  if (normalized.includes("/zod/")) {
    return "vendor-validation";
  }
  if (
    normalized.includes("/@tanstack/react-router/")
    || normalized.includes("/@tanstack/router-core/")
    || normalized.includes("/@tanstack/history/")
    || normalized.includes("/@tanstack/store/")
  ) {
    return "vendor-react-ui";
  }
  if (
    normalized.includes("/@tanstack/react-query/")
    || normalized.includes("/@tanstack/query-core/")
  ) {
    return "vendor-query";
  }
  if (
    normalized.includes("/class-variance-authority/")
    || normalized.includes("/clsx/")
    || normalized.includes("/tailwind-merge/")
  ) {
    return "vendor-style-utils";
  }
  if (
    normalized.includes("/@base-ui/")
    || normalized.includes("/@radix-ui/")
    || normalized.includes("/cmdk/")
    || normalized.includes("/react-remove-scroll/")
    || normalized.includes("/aria-hidden/")
    || normalized.includes("/@shadcn/")
  ) {
    return "vendor-react-ui";
  }
  if (normalized.includes("/lucide-react/") || normalized.includes("/lucide/")) {
    return "vendor-icons";
  }
  if (
    normalized.includes("/react-file-icon/")
    || normalized.includes("/react-json-view-lite/")
    || normalized.includes("/facehash/")
  ) {
    return "vendor-inspectors";
  }
  if (normalized.includes("/zustand/")) {
    return "vendor-state";
  }
  if (
    normalized.includes("/react-syntax-highlighter/")
    || normalized.includes("/highlight.js/")
    || normalized.includes("/lowlight/")
    || normalized.includes("/refractor/")
    || normalized.includes("/prismjs/")
  ) {
    return "vendor-syntax";
  }
  if (
    normalized.includes("/react-markdown/")
    || normalized.includes("/remark-")
    || normalized.includes("/rehype-")
    || normalized.includes("/unified/")
    || normalized.includes("/micromark")
    || normalized.includes("/mdast-")
    || normalized.includes("/hast-")
    || normalized.includes("/unist-")
    || normalized.includes("/vfile")
  ) {
    return "vendor-markdown";
  }
  return undefined;
}

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
  optimizeDeps: {
    include: ["@kilnai/gateway-contracts"],
  },
  build: {
    chunkSizeWarningLimit: 560,
    rollupOptions: {
      output: {
        manualChunks: guiManualChunks,
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["**/tests/parity/**", "**/node_modules/**", "**/dist/**"],
  },
});
