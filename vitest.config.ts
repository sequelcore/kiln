import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
    ],
    alias: {
      "bun:sqlite": new URL("./vitest-bun-sqlite-mock.ts", import.meta.url).pathname,
    },
  },
});
