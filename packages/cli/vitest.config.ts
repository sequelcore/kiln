import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: {
      "bun:sqlite": new URL("../../vitest-bun-sqlite-mock.ts", import.meta.url).pathname,
    },
    globals: true,
    setupFiles: ["./tests/setup/hermetic-home.ts"],
    testTimeout: 20_000,
    hookTimeout: 10_000,
    teardownTimeout: 10_000,
    exclude: ["**/node_modules/**", "**/dist/**", "tests/**/*.live.test.ts"],
    maxWorkers: 1,
  },
});
