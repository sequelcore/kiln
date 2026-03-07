import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/core",
      "packages/runtime",
      "packages/cli",
      "packages/sdk",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
      exclude: [
        "**/dist/**",
        "**/node_modules/**",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/test/**",
        "**/__tests__/**",
        "**/*.d.ts",
        "**/types/**",
      ],
    },
  },
});
