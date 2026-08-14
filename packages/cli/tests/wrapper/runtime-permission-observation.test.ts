import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRuntimePermissionObservationStore,
  deriveClaudeRuntimePermissionRequest,
  deriveCodexRuntimePermissionRequest,
  deriveOpenCodeRuntimePermissionRequest,
} from "../../src/wrapper/runtime-permission-observation.js";

const at = new Date("2026-08-13T18:00:00.000Z");
const projectionDigest = "a".repeat(64);

async function project(): Promise<string> {
  const projectPath = await mkdtemp(join(tmpdir(), "kiln-runtime-evidence-"));
  await mkdir(join(projectPath, ".kiln"), { recursive: true });
  await writeFile(join(projectPath, ".kiln", "install-state.json"), JSON.stringify({ version: 1, targets: {
    "codex-config": { targetId: "codex-config", filePath: "portable", contentHash: projectionDigest, managedFields: [], managedFieldHashes: {}, updatedAt: at.toISOString(), permissionIntegrity: { harness: "codex" } },
    "claude-settings": { targetId: "claude-settings", filePath: "portable", contentHash: "b".repeat(64), managedFields: [], managedFieldHashes: {}, updatedAt: at.toISOString(), permissionIntegrity: { harness: "claude-code" } },
    "opencode-config": { targetId: "opencode-config", filePath: "portable", contentHash: "c".repeat(64), managedFields: [], managedFieldHashes: {}, updatedAt: at.toISOString(), permissionIntegrity: { harness: "opencode" } },
  } }), "utf8");
  return projectPath;
}

describe("runtime permission evidence", () => {
  it("derives requested profiles without claiming proof", () => {
    expect(deriveClaudeRuntimePermissionRequest({ sessionId: "s", permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true, requestedAt: at }).profile).toBe("trusted-full-access");
    expect(deriveCodexRuntimePermissionRequest({ sessionId: "s", approvalMode: "never", sandboxMode: "workspace-write", requestedAt: at }).profile).toBe("workspace-write");
    expect(deriveOpenCodeRuntimePermissionRequest({ sessionId: "s", permissionRules: [{ permission: "*", action: "allow" }], requestedAt: at }).profile).toBe("workspace-write");
  });

  it("keeps a newer startup request without observation from reusing older proof", async () => {
    const store = createRuntimePermissionObservationStore({ projectPath: await project() });
    const first = await store.recordRequested(deriveCodexRuntimePermissionRequest({ sessionId: "first", approvalMode: "on-request", sandboxMode: "read-only", requestedAt: at }));
    await store.recordObserved(first, { observedAt: at, proof: "inferred" });
    await store.recordRequested(deriveCodexRuntimePermissionRequest({ sessionId: "failed-start", approvalMode: "on-request", sandboxMode: "read-only", requestedAt: new Date(at.getTime() + 1) }));
    const latest = await store.readLatestExact({ harness: "codex", targetId: "codex-config", projectionDigest });
    expect(latest?.requested.sessionDigest).not.toBe(first.sessionDigest);
    expect(latest?.observed).toBeUndefined();
  });

  it("does not pair an observation from another session or projection", async () => {
    const store = createRuntimePermissionObservationStore({ projectPath: await project() });
    const first = await store.recordRequested(deriveCodexRuntimePermissionRequest({ sessionId: "first", approvalMode: "on-request", sandboxMode: "read-only", requestedAt: at }));
    const second = await store.recordRequested(deriveCodexRuntimePermissionRequest({ sessionId: "second", approvalMode: "on-request", sandboxMode: "read-only", requestedAt: new Date(at.getTime() + 1) }));
    await store.recordObserved(first, { observedAt: new Date(at.getTime() + 2), proof: "proven" });
    expect((await store.readLatestExact({ harness: "codex", targetId: "codex-config", projectionDigest }))?.observed).toBeUndefined();
    expect(await store.readLatestExact({ harness: "codex", targetId: "codex-config", projectionDigest: "d".repeat(64) })).toBeUndefined();
    expect(second.sessionDigest).not.toBe(first.sessionDigest);
  });

  it("persists only digests and portable version evidence", async () => {
    const projectPath = await project();
    const store = createRuntimePermissionObservationStore({ projectPath });
    const requested = await store.recordRequested(deriveCodexRuntimePermissionRequest({ sessionId: "raw-session-id", approvalMode: "on-request", sandboxMode: "read-only", requestedAt: at, runtimeVersion: { kind: "sdk", version: "0.147.0" } }));
    await store.recordObserved(requested, { observedAt: at, proof: "inferred" });
    const files = await readdir(join(store.evidenceDirectory, "codex"));
    const serialized = (await Promise.all(files.filter((name) => name.endsWith(".json")).map((name) => readFile(join(store.evidenceDirectory, "codex", name), "utf8")))).join("\n");
    expect(serialized).not.toContain(projectPath);
    expect(serialized).not.toContain("raw-session-id");
    expect(serialized).not.toContain("approvalMode");
    expect(serialized).toContain("0.147.0");
  });

  it("fails closed before effect when the exact projection is absent", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "kiln-runtime-evidence-"));
    const store = createRuntimePermissionObservationStore({ projectPath });
    await expect(store.recordRequested(deriveCodexRuntimePermissionRequest({ sessionId: "s", approvalMode: "on-request", sandboxMode: "read-only", requestedAt: at }))).rejects.toThrow("exact native permission projection");
  });
});
