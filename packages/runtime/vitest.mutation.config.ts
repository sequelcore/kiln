import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    alias: {
      "bun:sqlite": fileURLToPath(new URL("../../vitest-bun-sqlite-mock.ts", import.meta.url)),
    },
    include: ["tests/execution-kernel/runtime-media-action-claim.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    teardownTimeout: 10_000,
  },
});
