import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("GUI Vite startup config", () => {
  it("resolves the shared gateway contracts workspace package directly in dev", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../vite.config.ts"), "utf8");

    expect(source).toContain("optimizeDeps");
    expect(source).toContain('exclude: ["@kilnai/gateway-contracts"]');
    expect(source).not.toContain('include: ["@kilnai/gateway-contracts"]');
  });

  it("uses stable production chunks instead of hiding the chunk-size gate", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../vite.config.ts"), "utf8");

    expect(source).toContain("chunkSizeWarningLimit: 560");
    expect(source).not.toContain("chunkSizeWarningLimit: 1000");
    expect(source).toContain("rolldownOptions");
    expect(source).toContain("codeSplitting");
    expect(source).not.toContain("rollupOptions");
    expect(source).not.toContain("manualChunks");
    expect(source).toContain('"vendor-kiln-contracts"');
    expect(source).toContain('"vendor-query"');
    expect(source).toContain('"vendor-react-ui"');
    expect(source).toContain('"vendor-style-utils"');
    expect(source).toContain('"vendor-icons"');
    expect(source).toContain('"vendor-inspectors"');
  });

  it("declares the Kiln favicon instead of relying on a missing root icon", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../index.html"), "utf8");

    expect(source).toContain('<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,');
  });

  it("allows isolated browser tests to reserve a GUI port without changing the operator default", () => {
    const viteSource = readFileSync(resolve(import.meta.dirname, "../vite.config.ts"), "utf8");
    const playwrightSource = readFileSync(resolve(import.meta.dirname, "../playwright.config.ts"), "utf8");

    expect(viteSource).toContain('process.env.GUI_DEV_PORT ?? "5183"');
    expect(playwrightSource).toContain('process.env.GUI_DEV_PORT ?? String(await reservePort())');
    expect(playwrightSource).toContain('GUI_DEV_PORT: guiPort');
  });
});
