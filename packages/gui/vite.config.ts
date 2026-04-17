import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

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
        target: "http://localhost:4810",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gui-api/, ""),
      },
      "/gui-ws": {
        target: "ws://localhost:4810",
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gui-ws/, ""),
      },
    },
  },
});
