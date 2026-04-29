import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: {
      "bun:sqlite": new URL("../../vitest-bun-sqlite-mock.ts", import.meta.url).pathname,
    },
    globals: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/.kiln-worktrees/**"],
  },
});
