import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: {
      "bun:sqlite": new URL("../../vitest-bun-sqlite-mock.ts", import.meta.url).pathname,
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    teardownTimeout: 10_000,
    exclude: ["**/node_modules/**", "**/dist/**", "**/.kiln-worktrees/**"],
  },
});
