import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Runtime execution-kernel boundaries", () => {
  it("owns provider-neutral account capacity contracts without importing the managed lease authority", async () => {
    const source = await readFile(new URL("../../src/execution-kernel/execution-account-capacity-authority.ts", import.meta.url), "utf8");

    expect(source).toContain("export interface AccountCapacityAcquireInput");
    expect(source).toContain("export interface AccountCapacityRecord");
    expect(source).not.toContain("managed-account-lease-authority");
  });

  it("owns governed one-round invocation outside the Model Gateway ingress directory", async () => {
    const barrel = await readFile(new URL("../../src/index.ts", import.meta.url), "utf8");
    const source = await readFile(new URL("../../src/execution-kernel/governed-one-round-invocation.ts", import.meta.url), "utf8");

    expect(barrel).toContain("./execution-kernel/governed-one-round-invocation.js");
    expect(barrel).not.toContain("./model-gateway/governed-one-round-invocation.js");
    expect(source).not.toContain("managed-account-leases");
  });
});
