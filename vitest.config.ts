import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/sqlite-store.test.ts",
      "**/checkpoint-store.test.ts",
      "**/checkpoint-integration.test.ts",
    ],
    alias: {
      "bun:sqlite": new URL("./vitest-bun-sqlite-mock.ts", import.meta.url).pathname,
    },
  },
});
