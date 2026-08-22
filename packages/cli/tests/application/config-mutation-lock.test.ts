import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withConfigMutationLock } from "../../src/application/config-mutation-lock.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("configuration mutation lock waiting", () => {
  it("lets a reconciliation waiter enter after the active owner settles", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-config-lock-"));
    roots.push(root);
    const lockPath = join(root, "target.lock");
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let firstEntered!: () => void;
    const entered = new Promise<void>((resolve) => { firstEntered = resolve; });

    const first = withConfigMutationLock(lockPath, async () => {
      firstEntered();
      await blocked;
      return "first";
    });
    await entered;
    const second = withConfigMutationLock(lockPath, () => "second", { waitMs: 1_000, retryMs: 5 });
    release();

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });
});
