import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("GUI Vite startup config", () => {
  it("pre-bundles the shared gateway contracts workspace package in dev", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../vite.config.ts"), "utf8");

    expect(source).toContain("optimizeDeps");
    expect(source).toContain('"@kilnai/gateway-contracts"');
  });

  it("uses stable production chunks instead of hiding the chunk-size gate", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../vite.config.ts"), "utf8");

    expect(source).toContain("chunkSizeWarningLimit: 560");
    expect(source).not.toContain("chunkSizeWarningLimit: 1000");
    expect(source).toContain('"vendor-kiln-contracts"');
    expect(source).toContain('"vendor-query"');
    expect(source).toContain('"vendor-react-ui"');
    expect(source).toContain('"vendor-style-utils"');
    expect(source).toContain('"vendor-icons"');
    expect(source).toContain('"vendor-inspectors"');
  });
});
