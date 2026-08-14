import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FilesystemAgentTaskStore } from "../../src/agent-tasks/index.js";

describe("FilesystemAgentTaskStore legacy migration", () => {
  it("publishes validated V13 before retaining the V12 source as a recoverable backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-agent-task-"));
    try {
      const legacy = [{ version: 12, id: "job-000000001", adoptedDecisionAt: "2026-08-01T00:00:00.000Z", state: "queued", objective: "Inspect.", projectId: "kiln", callerId: "caller", configuredAgentProfileId: "claude-reviewer", admissionProfileId: "foundation-readonly-plan", dispatch: { kind: "native-harness", routeId: "claude-sonnet-readonly", routeRevision: "configured-v1", providerId: "claude", model: "claude-sonnet-5", admissionProfileId: "foundation-readonly-plan", adapterCapabilityId: "managed:claude-sonnet-readonly", adapterCapabilityVersion: "v1", acknowledgement: { version: 1, source: "managed-route-admission", credentialMode: "credentialless", acknowledgedAt: "2026-08-01T00:00:00.000Z", routeId: "claude-sonnet-readonly", routeRevision: "configured-v1", providerId: "claude", model: "claude-sonnet-5", admissionProfileId: "foundation-readonly-plan", adapterCapabilityId: "managed:claude-sonnet-readonly", adapterCapabilityVersion: "v1" } }, governanceSource: "kiln-work-governance", admissionId: "admission-001", requestFingerprint: `sha256:${"a".repeat(64)}`, idempotencyKeyHash: `sha256:${"b".repeat(64)}`, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", lifecycle: [{ sequence: 1, state: "queued", observedAt: "2026-08-01T00:00:00.000Z" }] }];
      await mkdir(join(root, "managed-jobs"));
      await writeFile(join(root, "managed-jobs", "managed-jobs.json"), `${JSON.stringify(legacy)}\n`);

      const store = new FilesystemAgentTaskStore(root);
      const tasks = await store.all();
      expect(tasks[0]).toMatchObject({ version: 13, id: "job-000000001", run: { runId: "agent-run:job-000000001" } });
      expect(JSON.parse(await readFile(join(root, "agent-tasks", "agent-tasks.json"), "utf8"))).toHaveLength(1);
      await expect(readFile(join(root, "managed-jobs", "managed-jobs.v12.json"), "utf8")).resolves.toContain("job-000000001");
      await expect(readFile(join(root, "managed-jobs", "managed-jobs.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(await new FilesystemAgentTaskStore(root).all()).toEqual(tasks);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects corrupt nested V12 authority evidence before publishing V13", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-agent-task-corrupt-v12-"));
    try {
      const legacy = [{ version: 12, id: "job-corrupt-v12", adoptedDecisionAt: "2026-08-01T00:00:00.000Z", state: "queued", objective: "Inspect.", projectId: "kiln", callerId: "caller", configuredAgentProfileId: "claude-reviewer", admissionProfileId: "foundation-readonly-plan", dispatch: { kind: "native-harness", routeId: "claude-sonnet-readonly", routeRevision: "configured-v1", providerId: "claude", model: "claude-sonnet-5", admissionProfileId: "foundation-readonly-plan", adapterCapabilityId: "managed:claude-sonnet-readonly", adapterCapabilityVersion: "v1", acknowledgement: { version: 1, source: "managed-route-admission", credentialMode: "operator-secret", acknowledgedAt: "2026-08-01T00:00:00.000Z", routeId: "claude-sonnet-readonly", routeRevision: "configured-v1", providerId: "claude", model: "claude-sonnet-5", admissionProfileId: "foundation-readonly-plan", adapterCapabilityId: "managed:claude-sonnet-readonly", adapterCapabilityVersion: "v1" } }, governanceSource: "kiln-work-governance", admissionId: "admission-001", requestFingerprint: `sha256:${"a".repeat(64)}`, idempotencyKeyHash: `sha256:${"b".repeat(64)}`, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", lifecycle: [{ sequence: 1, state: "queued", observedAt: "2026-08-01T00:00:00.000Z" }] }];
      await mkdir(join(root, "managed-jobs"));
      const source = join(root, "managed-jobs", "managed-jobs.json");
      await writeFile(source, `${JSON.stringify(legacy)}\n`);

      await expect(new FilesystemAgentTaskStore(root).all()).rejects.toMatchObject({ code: "job_persistence_corrupt" });
      await expect(readFile(source, "utf8")).resolves.toContain("operator-secret");
      await expect(readFile(join(root, "agent-tasks", "agent-tasks.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("finishes retiring an identical V12 source after an interrupted V13 publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-agent-task-interrupted-v12-"));
    try {
      const legacyPath = join(root, "managed-jobs", "managed-jobs.json");
      const backupPath = join(root, "managed-jobs", "managed-jobs.v12.json");
      await mkdir(join(root, "managed-jobs"), { recursive: true });
      const legacy = [{ version: 12, id: "job-000000001", adoptedDecisionAt: "2026-08-01T00:00:00.000Z", state: "queued", objective: "Inspect.", projectId: "kiln", callerId: "caller", configuredAgentProfileId: "claude-reviewer", admissionProfileId: "foundation-readonly-plan", dispatch: { kind: "native-harness", routeId: "claude-sonnet-readonly", routeRevision: "configured-v1", providerId: "claude", model: "claude-sonnet-5", admissionProfileId: "foundation-readonly-plan", adapterCapabilityId: "managed:claude-sonnet-readonly", adapterCapabilityVersion: "v1", acknowledgement: { version: 1, source: "managed-route-admission", credentialMode: "credentialless", acknowledgedAt: "2026-08-01T00:00:00.000Z", routeId: "claude-sonnet-readonly", routeRevision: "configured-v1", providerId: "claude", model: "claude-sonnet-5", admissionProfileId: "foundation-readonly-plan", adapterCapabilityId: "managed:claude-sonnet-readonly", adapterCapabilityVersion: "v1" } }, governanceSource: "kiln-work-governance", admissionId: "admission-001", requestFingerprint: `sha256:${"a".repeat(64)}`, idempotencyKeyHash: `sha256:${"b".repeat(64)}`, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", lifecycle: [{ sequence: 1, state: "queued", observedAt: "2026-08-01T00:00:00.000Z" }] }];
      const contents = `${JSON.stringify(legacy)}\n`;
      await writeFile(legacyPath, contents);
      await writeFile(backupPath, contents);

      const firstStore = new FilesystemAgentTaskStore(root);
      await expect(firstStore.all()).resolves.toHaveLength(1);
      await writeFile(legacyPath, contents);

      await expect(new FilesystemAgentTaskStore(root).all()).resolves.toHaveLength(1);
      await expect(readFile(legacyPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(backupPath, "utf8")).resolves.toBe(contents);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
