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
    projects: [
      {
        extends: true,
        test: {
          name: "isolated",
          exclude: ["tests/**/*.integration.test.ts", "tests/managed-agent/*.live.test.ts"],
          maxWorkers: "50%",
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/**/*.integration.test.ts"],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
