import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("GUI Vite startup config", () => {
  it("pre-bundles the shared gateway contracts workspace package in dev", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../vite.config.ts"), "utf8");

    expect(source).toContain("optimizeDeps");
    expect(source).toContain('"@kilnai/gateway-contracts"');
  });
});
