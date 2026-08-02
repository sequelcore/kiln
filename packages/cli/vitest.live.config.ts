import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: {
      "bun:sqlite": new URL("../../vitest-bun-sqlite-mock.ts", import.meta.url).pathname,
    },
    globals: true,
    include: ["tests/**/*.live.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 30_000,
  },
});
