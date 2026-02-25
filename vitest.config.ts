import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/core",
      "packages/runtime",
      "packages/cli",
      "packages/sdk",
    ],
  },
});
