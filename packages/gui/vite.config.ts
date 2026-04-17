import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

const gatewayPort = Number.parseInt(process.env.GUI_GATEWAY_PORT ?? "4810", 10);
const resolvedGatewayPort = Number.isFinite(gatewayPort) && gatewayPort > 0 ? gatewayPort : 4810;

export default defineConfig({
  plugins: [
    TanStackRouterVite({ routesDirectory: "src/routes", generatedRouteTree: "src/routeTree.gen.ts" }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5183,
    proxy: {
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
    },
  },
});
