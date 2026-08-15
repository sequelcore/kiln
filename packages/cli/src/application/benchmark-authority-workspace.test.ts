import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBenchmarkAuthorityWorkspaceLease } from "./benchmark-authority-workspace.js";

describe("benchmark authority workspace", () => {
  it("owns isolated temporary authority state and removes it idempotently", () => {
    const lease = createBenchmarkAuthorityWorkspaceLease();
    expect(lease.rootPath).toContain("kiln-benchmark-authority-");
    writeFileSync(join(lease.rootPath, "authority.sqlite"), "synthetic");

    lease.cleanup();
    lease.cleanup();

    expect(existsSync(lease.rootPath)).toBe(false);
  });
});
