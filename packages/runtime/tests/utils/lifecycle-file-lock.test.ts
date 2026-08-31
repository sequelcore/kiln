import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithLifecycleFileLock } from "../../src/utils/lifecycle-file-lock.js";

describe("runWithLifecycleFileLock", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("publishes complete owner metadata and blocks a live concurrent owner", async () => {
    root = await tempRuntime();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const acquired = new Promise<void>((resolve) => { entered = resolve; });

    const first = runWithLifecycleFileLock({
      runtimeDir: root,
      processId: 101,
      createOwnerId: () => "owner-a",
      nowMilliseconds: () => 1_780_000_000_000,
      isProcessAlive: (pid) => pid === 101,
    }, async () => {
      entered();
      await held;
      return "first";
    });
    await acquired;

    expect(await readFile(join(root, "lifecycle.lock"), "utf8")).toBe(
      `${JSON.stringify({ schemaVersion: 1, ownerId: "owner-a", pid: 101, acquiredAt: 1_780_000_000_000 })}\n`,
    );
    const competingAction = vi.fn(async () => "second");
    await expect(runWithLifecycleFileLock({
      runtimeDir: root,
      processId: 202,
      createOwnerId: () => "owner-b",
      isProcessAlive: (pid) => pid === 101,
    }, competingAction)).resolves.toEqual({ state: "busy" });
    expect(competingAction).not.toHaveBeenCalled();

    release();
    await expect(first).resolves.toEqual({ state: "completed", value: "first" });
    await expect(stat(join(root, "lifecycle.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["structured", `${JSON.stringify({ schemaVersion: 1, ownerId: "dead-owner", pid: 999, acquiredAt: 1_700_000_000_000 })}\n`],
    ["legacy", "999\n"],
  ])("reclaims a dead %s owner", async (_kind, contents) => {
    root = await tempRuntime();
    await writeFile(join(root, "lifecycle.lock"), contents);

    await expect(runWithLifecycleFileLock({
      runtimeDir: root,
      processId: 202,
      createOwnerId: () => "replacement",
      isProcessAlive: () => false,
    }, async () => "recovered")).resolves.toEqual({ state: "completed", value: "recovered" });
    await expect(stat(join(root, "lifecycle.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed for a fresh invalid lock and reclaims it after the recovery grace", async () => {
    root = await tempRuntime();
    const lockPath = join(root, "lifecycle.lock");
    await writeFile(lockPath, "");
    const modifiedAt = (await stat(lockPath)).mtimeMs;
    const action = vi.fn(async () => "recovered");

    await expect(runWithLifecycleFileLock({
      runtimeDir: root,
      nowMilliseconds: () => modifiedAt + 1_000,
      invalidLockGraceMs: 30_000,
    }, action)).resolves.toEqual({ state: "busy" });
    expect(action).not.toHaveBeenCalled();

    await expect(runWithLifecycleFileLock({
      runtimeDir: root,
      nowMilliseconds: () => modifiedAt + 30_001,
      invalidLockGraceMs: 30_000,
    }, action)).resolves.toEqual({ state: "completed", value: "recovered" });
    expect(action).toHaveBeenCalledOnce();
  });

  it("releases only its own lock when the action fails", async () => {
    root = await tempRuntime();

    await expect(runWithLifecycleFileLock({ runtimeDir: root }, async () => {
      throw new Error("operation failed");
    })).rejects.toThrow("operation failed");
    await expect(stat(join(root, "lifecycle.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not unlink a replacement lock it does not own", async () => {
    root = await tempRuntime();
    const replacement = `${JSON.stringify({
      schemaVersion: 1,
      ownerId: "successor",
      pid: 303,
      acquiredAt: 1_780_000_001_000,
    })}\n`;

    await expect(runWithLifecycleFileLock({ runtimeDir: root }, async () => {
      await writeFile(join(root!, "lifecycle.lock"), replacement);
      return "completed";
    })).resolves.toEqual({ state: "completed", value: "completed" });
    await expect(readFile(join(root, "lifecycle.lock"), "utf8")).resolves.toBe(replacement);
  });
});

async function tempRuntime(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kiln-lifecycle-lock-"));
  if (process.platform !== "win32") await chmod(directory, 0o700);
  return directory;
}
