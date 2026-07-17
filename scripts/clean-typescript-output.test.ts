import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanTypescriptOutput } from "./clean-typescript-output.js";

describe("cleanTypescriptOutput", () => {
  it("removes only generated TypeScript outputs from the requested package", async () => {
    const packageRoot = mkdtempSync(join(tmpdir(), "kiln-clean-output-"));
    const dist = join(packageRoot, "dist");
    const buildInfo = join(packageRoot, "tsconfig.tsbuildinfo");
    const sentinel = join(packageRoot, "src", "index.ts");

    mkdirSync(join(packageRoot, "src"), { recursive: true });
    mkdirSync(dist);
    writeFileSync(join(dist, "index.js"), "generated");
    writeFileSync(buildInfo, "generated");
    writeFileSync(sentinel, "source");

    await cleanTypescriptOutput(packageRoot);

    expect(existsSync(dist)).toBe(false);
    expect(existsSync(buildInfo)).toBe(false);
    expect(existsSync(sentinel)).toBe(true);
  });
});
