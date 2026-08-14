import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
  CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY_2_1_226,
  CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY_2_1_229,
  CLAUDE_PRIVATE_PLAN_ARTIFACT_LOCK_FILE,
  createClaudePrivatePlanArtifactTracker,
  resolveClaudePrivatePlanArtifactCapability,
} from "../../src/wrapper/claude-private-plan-artifacts.js";

describe("Claude private plan artifact capability", () => {
  it("admits only the exact observed Claude Code version", () => {
    expect(resolveClaudePrivatePlanArtifactCapability("2.1.220")).toBe(CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY);
    expect(resolveClaudePrivatePlanArtifactCapability("2.1.226")).toBe(CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY_2_1_226);
    expect(resolveClaudePrivatePlanArtifactCapability("2.1.229")).toBe(CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY_2_1_229);
    expect(resolveClaudePrivatePlanArtifactCapability("2.1.226")).toMatchObject({
      capabilityId: "claude-code-private-plan-artifacts-v1",
      harness: "claude-code",
      version: "2.1.226",
      relativeDirectory: "plans",
    });
    expect(resolveClaudePrivatePlanArtifactCapability("2.1.221")).toBeUndefined();
    expect(resolveClaudePrivatePlanArtifactCapability("2.1.227")).toBeUndefined();
    expect(resolveClaudePrivatePlanArtifactCapability("sonnet")).toBeUndefined();
  });

  it("restores plan artifacts in the selected pooled config dir without touching auth siblings", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "kiln-claude-config-"));
    const plansDir = join(configDir, "plans");
    const baseline = join(plansDir, "baseline.md");
    const deleted = join(plansDir, "deleted.md");
    const secretSibling = join(configDir, "credentials.json");
    try {
      await mkdir(plansDir, { recursive: true });
      await writeFile(baseline, "before\n", "utf8");
      await writeFile(deleted, "keep\n", "utf8");
      await writeFile(secretSibling, "synthetic-secret\n", "utf8");
      const tracker = createClaudePrivatePlanArtifactTracker({
        capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
        selectedConfigDir: configDir,
      });
      expect(tracker).toBeDefined();
      await tracker!.snapshot();

      await writeFile(baseline, "after\n", "utf8");
      await writeFile(join(plansDir, "created.md"), "new\n", "utf8");
      await rm(deleted);

      const evidence = await tracker!.finalize();

      expect(evidence).toMatchObject({
        capabilityId: "claude-code-private-plan-artifacts-v1",
        harness: "claude-code",
        artifactCount: 3,
        createdCount: 1,
        modifiedCount: 1,
        deletedCount: 1,
        cleanupStatus: "completed",
        unexpectedDelta: false,
      });
      expect(evidence.artifactDigest).toMatch(/^[a-f0-9]{64}$/u);
      await expect(readFile(baseline, "utf8")).resolves.toBe("before\n");
      await expect(readFile(deleted, "utf8")).resolves.toBe("keep\n");
      await expect(readdir(plansDir)).resolves.toEqual(["baseline.md", "deleted.md"]);
      await expect(readFile(secretSibling, "utf8")).resolves.toBe("synthetic-secret\n");
      expect(JSON.stringify(evidence)).not.toContain(configDir);
      expect(JSON.stringify(evidence)).not.toContain("baseline.md");
      expect(JSON.stringify(evidence)).not.toContain("synthetic-secret");
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("does not create a tracker without the selected pooled config dir", () => {
    expect(createClaudePrivatePlanArtifactTracker({
      capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
      selectedConfigDir: undefined,
    })).toBeUndefined();
  });

  it("serializes snapshot through cleanup for trackers sharing one selected home", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "kiln-claude-lock-shared-"));
    const plansDir = join(configDir, "plans");
    const baseline = join(plansDir, "baseline.md");
    try {
      await mkdir(plansDir, { recursive: true });
      await writeFile(baseline, "before\n", "utf8");
      const first = createClaudePrivatePlanArtifactTracker({
        capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
        selectedConfigDir: configDir,
      });
      const second = createClaudePrivatePlanArtifactTracker({
        capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
        selectedConfigDir: configDir,
      });
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      await first!.snapshot();
      await writeFile(baseline, "first\n", "utf8");

      let secondSnapshotFinished = false;
      const secondSnapshot = second!.snapshot().then(() => {
        secondSnapshotFinished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(secondSnapshotFinished).toBe(false);

      const firstEvidence = await first!.finalize();
      expect(firstEvidence.cleanupStatus).toBe("completed");
      await secondSnapshot;
      expect(secondSnapshotFinished).toBe(true);
      await expect(readFile(baseline, "utf8")).resolves.toBe("before\n");
      await second!.finalize();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("does not block independent selected homes behind one another", async () => {
    const firstConfigDir = await mkdtemp(join(tmpdir(), "kiln-claude-lock-first-"));
    const secondConfigDir = await mkdtemp(join(tmpdir(), "kiln-claude-lock-second-"));
    try {
      await mkdir(join(firstConfigDir, "plans"), { recursive: true });
      await mkdir(join(secondConfigDir, "plans"), { recursive: true });
      const first = createClaudePrivatePlanArtifactTracker({
        capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
        selectedConfigDir: firstConfigDir,
      });
      const second = createClaudePrivatePlanArtifactTracker({
        capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
        selectedConfigDir: secondConfigDir,
      });
      await first!.snapshot();
      const secondSnapshot = second!.snapshot();
      const resolvedWithoutFirstCleanup = await Promise.race([
        secondSnapshot.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
      ]);
      expect(resolvedWithoutFirstCleanup).toBe(true);
      await secondSnapshot;
      await second!.finalize();
      await first!.finalize();
    } finally {
      await rm(firstConfigDir, { recursive: true, force: true });
      await rm(secondConfigDir, { recursive: true, force: true });
    }
  });

  it("fails closed when the selected config dir is a symlink", async () => {
    const realConfigDir = await mkdtemp(join(tmpdir(), "kiln-claude-confinement-config-"));
    const aliasConfigDir = `${realConfigDir}-alias`;
    try {
      const created = await createDirectorySymlink(realConfigDir, aliasConfigDir);
      if (!created) return;
      await mkdir(join(realConfigDir, "plans"), { recursive: true });
      const tracker = createClaudePrivatePlanArtifactTracker({
        capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
        selectedConfigDir: aliasConfigDir,
      });
      await expect(tracker!.snapshot()).rejects.toThrow();
    } finally {
      await rm(aliasConfigDir, { recursive: true, force: true });
      await rm(realConfigDir, { recursive: true, force: true });
    }
  });

  it("fails closed when the plans root is a file or symlink", async () => {
    const fileConfigDir = await mkdtemp(join(tmpdir(), "kiln-claude-confinement-file-"));
    const symlinkConfigDir = await mkdtemp(join(tmpdir(), "kiln-claude-confinement-link-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "kiln-claude-confinement-outside-"));
    const fileLockPath = join(fileConfigDir, CLAUDE_PRIVATE_PLAN_ARTIFACT_LOCK_FILE);
    const symlinkLockPath = join(symlinkConfigDir, CLAUDE_PRIVATE_PLAN_ARTIFACT_LOCK_FILE);
    try {
      await writeFile(join(fileConfigDir, "plans"), "not-a-directory\n", "utf8");
      const fileTracker = createClaudePrivatePlanArtifactTracker({
        capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
        selectedConfigDir: fileConfigDir,
      });
      await expect(fileTracker!.snapshot()).rejects.toThrow();
      await expect(readFile(fileLockPath, "utf8")).rejects.toThrow();

      const created = await createDirectorySymlink(outsideDir, join(symlinkConfigDir, "plans"));
      if (!created) return;
      const symlinkTracker = createClaudePrivatePlanArtifactTracker({
        capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
        selectedConfigDir: symlinkConfigDir,
      });
      await expect(symlinkTracker!.snapshot()).rejects.toThrow();
      await expect(readFile(symlinkLockPath, "utf8")).rejects.toThrow();
    } finally {
      await rm(fileConfigDir, { recursive: true, force: true });
      await rm(symlinkConfigDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("fails closed when a plan descendant is a symlink", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "kiln-claude-confinement-descendant-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "kiln-claude-confinement-descendant-outside-"));
    const outsideMarker = join(outsideDir, "marker.txt");
    try {
      const plansDir = join(configDir, "plans");
      await mkdir(plansDir, { recursive: true });
      await writeFile(outsideMarker, "outside\n", "utf8");
      const created = await createDirectorySymlink(outsideDir, join(plansDir, "linked"));
      if (!created) return;
      const tracker = createClaudePrivatePlanArtifactTracker({
        capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
        selectedConfigDir: configDir,
      });
      await expect(tracker!.snapshot()).rejects.toThrow();
      await expect(readFile(outsideMarker, "utf8")).resolves.toBe("outside\n");
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("reports failed cleanup and does not restore after the plans root is replaced", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "kiln-claude-confinement-replaced-"));
    const plansDir = join(configDir, "plans");
    const originalRoot = join(configDir, "plans-original");
    const baseline = join(plansDir, "baseline.md");
    try {
      await mkdir(plansDir, { recursive: true });
      await writeFile(baseline, "before\n", "utf8");
      const tracker = createClaudePrivatePlanArtifactTracker({
        capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
        selectedConfigDir: configDir,
      });
      await tracker!.snapshot();
      await writeFile(baseline, "outside-preserved\n", "utf8");
      await rename(plansDir, originalRoot);
      await mkdir(plansDir, { recursive: true });

      const evidence = await tracker!.finalize();

      expect(evidence.cleanupStatus).toBe("failed");
      await expect(readFile(join(originalRoot, "baseline.md"), "utf8"))
        .resolves.toBe("outside-preserved\n");
      await expect(readFile(baseline, "utf8")).rejects.toThrow();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("uses an exclusive inter-process lock without stale-lock stealing", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "kiln-claude-process-lock-"));
    const plansDir = join(configDir, "plans");
    const lockPath = join(configDir, CLAUDE_PRIVATE_PLAN_ARTIFACT_LOCK_FILE);
    try {
      await mkdir(plansDir, { recursive: true });
      const tracker = createClaudePrivatePlanArtifactTracker({
        capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
        selectedConfigDir: configDir,
      });
      await tracker!.snapshot();

      const lockDocument = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
      expect(lockDocument).toMatchObject({ schema: 1, pid: process.pid });
      expect(typeof lockDocument.token).toBe("string");
      expect(JSON.stringify(lockDocument)).not.toContain(configDir);

      const blocked = await runLockWorker(configDir);
      expect(blocked.code).not.toBe(0);
      expect(blocked.stdout).toContain("failed:claude_private_plan_artifact_unavailable");

      const evidence = await tracker!.finalize();
      expect(evidence.cleanupStatus).toBe("completed");
      const afterRelease = await runLockWorker(configDir);
      expect(afterRelease.code).toBe(0);
      expect(afterRelease.stdout).toContain("entered");
      expect(afterRelease.stdout).toContain("released");

      await writeFile(lockPath, JSON.stringify({ schema: 1, pid: 1, token: "orphan-token" }), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      const orphanTracker = createClaudePrivatePlanArtifactTracker({
        capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
        selectedConfigDir: configDir,
      });
      await expect(orphanTracker!.snapshot()).rejects.toMatchObject({
        code: "claude_private_plan_artifact_unavailable",
        repairAction: "verify no active owner, then remove the lock before retrying",
      });
      const orphaned = await runLockWorker(configDir);
      expect(orphaned.code).not.toBe(0);
      expect(orphaned.stdout).toContain("failed:claude_private_plan_artifact_unavailable");
      await expect(readFile(lockPath, "utf8")).resolves.toContain("orphan-token");
    } finally {
      await rm(lockPath, { force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("fails closed for a lock symlink or non-regular lock entry", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "kiln-claude-lock-entry-"));
    const outsideDir = await mkdtemp(join(tmpdir(), "kiln-claude-lock-entry-outside-"));
    const lockPath = join(configDir, CLAUDE_PRIVATE_PLAN_ARTIFACT_LOCK_FILE);
    try {
      await mkdir(join(configDir, "plans"), { recursive: true });
      const linked = await createDirectorySymlink(outsideDir, lockPath);
      if (linked) {
        const symlinkTracker = createClaudePrivatePlanArtifactTracker({
          capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
          selectedConfigDir: configDir,
        });
        await expect(symlinkTracker!.snapshot()).rejects.toMatchObject({
          code: "claude_private_plan_artifact_unavailable",
        });
        await rm(lockPath, { force: true, recursive: true });
      }

      await mkdir(lockPath);
      const directoryTracker = createClaudePrivatePlanArtifactTracker({
        capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
        selectedConfigDir: configDir,
      });
      await expect(directoryTracker!.snapshot()).rejects.toMatchObject({
        code: "claude_private_plan_artifact_unavailable",
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("keeps the durable lock when the selected config root is replaced", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "kiln-claude-lock-replaced-"));
    const replacementDir = `${configDir}-original`;
    const lockPath = join(configDir, CLAUDE_PRIVATE_PLAN_ARTIFACT_LOCK_FILE);
    const originalLockPath = join(replacementDir, CLAUDE_PRIVATE_PLAN_ARTIFACT_LOCK_FILE);
    try {
      await mkdir(join(configDir, "plans"), { recursive: true });
      const tracker = createClaudePrivatePlanArtifactTracker({
        capability: CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
        selectedConfigDir: configDir,
      });
      await tracker!.snapshot();
      await rename(configDir, replacementDir);
      await mkdir(join(configDir, "plans"), { recursive: true });

      const evidence = await tracker!.finalize();

      expect(evidence.cleanupStatus).toBe("failed");
      await expect(readFile(originalLockPath, "utf8")).resolves.toContain("\"token\"");
      await expect(readFile(lockPath, "utf8")).rejects.toThrow();
    } finally {
      await rm(lockPath, { force: true });
      await rm(replacementDir, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  });
});

async function createDirectorySymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    await symlink(target, linkPath, "junction");
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") return false;
    throw error;
  }
}

async function runLockWorker(configDir: string): Promise<{ readonly code: number | null; readonly stdout: string }> {
  const workerPath = fileURLToPath(new URL("./claude-private-plan-artifact-lock-worker.ts", import.meta.url));
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn("bun", [workerPath, configDir], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", rejectWorker);
    child.once("close", (code) => {
      if (stderr.length > 0 && stdout.length === 0) stdout = stderr;
      resolveWorker({ code, stdout });
    });
  });
}
