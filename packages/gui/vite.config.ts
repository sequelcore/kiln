import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { fileURLToPath } from "node:url";

const gatewayPort = Number.parseInt(process.env.GUI_GATEWAY_PORT ?? "4810", 10);
const resolvedGatewayPort = Number.isFinite(gatewayPort) && gatewayPort > 0 ? gatewayPort : 4810;
const guiPort = Number.parseInt(process.env.GUI_DEV_PORT ?? "5183", 10);
const resolvedGuiPort = Number.isFinite(guiPort) && guiPort > 0 ? guiPort : 5183;

function guiChunkName(id: string): string | null {
  const normalized = id.replace(/\\/g, "/");
  if (normalized.includes("/packages/gateway-contracts/dist/")) {
    return "vendor-kiln-contracts";
  }
  if (!normalized.includes("/node_modules/")) {
    return null;
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
  return null;
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
    port: resolvedGuiPort,
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
    exclude: ["@kilnai/gateway-contracts"],
  },
  build: {
    chunkSizeWarningLimit: 560,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: guiChunkName,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
