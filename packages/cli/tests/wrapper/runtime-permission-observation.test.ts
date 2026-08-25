import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectStateBinding } from "../../src/application/project-state-root.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";
import { createPermissionProjectionIntegrity } from "../../src/config/translators/permission-projection.js";
import {
  createRuntimePermissionObservationStore,
  deriveClaudeRuntimePermissionRequest,
  deriveCodexRuntimePermissionRequest,
  deriveOpenCodeRuntimePermissionRequest,
} from "../../src/wrapper/runtime-permission-observation.js";

const at = new Date("2026-08-13T18:00:00.000Z");
const projectionDigest = "a".repeat(64);
const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function project(): Promise<{ readonly projectPath: string; readonly projectStateBinding: ProjectStateBinding }> {
  const projectPath = await mkdtemp(join(tmpdir(), "kiln-runtime-evidence-"));
  fixtures.push(projectPath);
  const binding = resolveProjectStateBinding(projectPath, { kilnHome: join(projectPath, "kiln-home") });
  await mkdir(binding.projectionsPath, { recursive: true });
  const permissionIntegrity = createPermissionProjectionIntegrity({
    harness: "codex",
    policy: { approval: "on-request", sandbox: "read-only" },
    translated: {
      backend: "codex",
      config: { approvalMode: "on-request", sandboxMode: "read-only" },
      nativeRules: { coarseOnly: true },
      representableRules: [],
      unsupportedRules: [],
      constraintInstructions: [],
      warnings: [],
    },
    enforcement: {
      approvalControl: "enforced",
      filesystemSandbox: "enforced",
      networkBoundary: "enforced",
      strength: "strong",
    },
    now: at,
  });
  await writeFile(
    join(binding.projectionsPath, "install-state.json"),
    JSON.stringify({
      version: 1,
      targets: {
        "codex-config": {
          targetId: "codex-config",
          filePath: "portable",
          contentHash: projectionDigest,
          managedFields: [],
          managedFieldHashes: {},
          updatedAt: at.toISOString(),
          permissionIntegrity,
        },
      },
    }),
    "utf8",
  );
  return { projectPath, projectStateBinding: binding };
}

describe("runtime permission evidence", () => {
  it("derives requested profiles without claiming proof", () => {
    expect(
      deriveClaudeRuntimePermissionRequest({
        sessionId: "s",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        requestedAt: at,
      }).profile,
    ).toBe("trusted-full-access");
    expect(
      deriveCodexRuntimePermissionRequest({
        sessionId: "s",
        approvalMode: "never",
        sandboxMode: "workspace-write",
        requestedAt: at,
      }).profile,
    ).toBe("workspace-write");
    expect(
      deriveOpenCodeRuntimePermissionRequest({
        sessionId: "s",
        permissionRules: [{ permission: "*", action: "allow" }],
        requestedAt: at,
      }).profile,
    ).toBe("workspace-write");
  });

  it("keeps a newer startup request without observation from reusing older proof", async () => {
    const fixture = await project();
    const store = createRuntimePermissionObservationStore(fixture);
    const first = await store.recordRequested(
      deriveCodexRuntimePermissionRequest({
        sessionId: "first",
        approvalMode: "on-request",
        sandboxMode: "read-only",
        requestedAt: at,
      }),
    );
    await store.recordObserved(first, { observedAt: at, proof: "inferred" });
    await store.recordRequested(
      deriveCodexRuntimePermissionRequest({
        sessionId: "failed-start",
        approvalMode: "on-request",
        sandboxMode: "read-only",
        requestedAt: new Date(at.getTime() + 1),
      }),
    );
    const latest = await store.readLatestExact({ harness: "codex", targetId: "codex-config", projectionDigest });
    expect(latest?.requested.sessionDigest).not.toBe(first.sessionDigest);
    expect(latest?.observed).toBeUndefined();
  });

  it("does not pair an observation from another session or projection", async () => {
    const fixture = await project();
    const store = createRuntimePermissionObservationStore(fixture);
    const first = await store.recordRequested(
      deriveCodexRuntimePermissionRequest({
        sessionId: "first",
        approvalMode: "on-request",
        sandboxMode: "read-only",
        requestedAt: at,
      }),
    );
    const second = await store.recordRequested(
      deriveCodexRuntimePermissionRequest({
        sessionId: "second",
        approvalMode: "on-request",
        sandboxMode: "read-only",
        requestedAt: new Date(at.getTime() + 1),
      }),
    );
    await store.recordObserved(first, {
      observedAt: new Date(at.getTime() + 2),
      componentValues: {
        approvalControl: "approval:on-request",
        filesystemSandbox: "sandbox:read-only",
        networkBoundary: "network:restricted",
      },
      runtimeIdentity: {
        protocol: "codex-app-server-v2",
        executableDigest: "e".repeat(64),
        processId: 42,
        threadDigest: "f".repeat(64),
      },
    });
    expect(
      (await store.readLatestExact({ harness: "codex", targetId: "codex-config", projectionDigest }))?.observed,
    ).toBeUndefined();
    expect(
      await store.readLatestExact({ harness: "codex", targetId: "codex-config", projectionDigest: "d".repeat(64) }),
    ).toBeUndefined();
    expect(second.sessionDigest).not.toBe(first.sessionDigest);
  });

  it("persists only digests and portable version evidence", async () => {
    const fixture = await project();
    const { projectPath } = fixture;
    const store = createRuntimePermissionObservationStore(fixture);
    const requested = await store.recordRequested(
      deriveCodexRuntimePermissionRequest({
        sessionId: "raw-session-id",
        approvalMode: "on-request",
        sandboxMode: "read-only",
        requestedAt: at,
        runtimeVersion: { kind: "sdk", version: "0.147.0" },
      }),
    );
    await store.recordObserved(requested, { observedAt: at, proof: "inferred" });
    const files = await readdir(join(store.evidenceDirectory, "codex"));
    const serialized = (
      await Promise.all(
        files
          .filter((name) => name.endsWith(".json"))
          .map((name) => readFile(join(store.evidenceDirectory, "codex", name), "utf8")),
      )
    ).join("\n");
    expect(serialized).not.toContain(projectPath);
    expect(serialized).not.toContain("raw-session-id");
    expect(serialized).not.toContain("approvalMode");
    expect(serialized).toContain("0.147.0");
    expect(store.evidenceDirectory).toBe(
      join(fixture.projectStateBinding.evidencePath, "runtime-permission-observations"),
    );
    expect(store.evidenceDirectory).not.toContain(join(projectPath, ".kiln"));
  });

  it("fails closed before effect when the exact projection is absent", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "kiln-runtime-evidence-"));
    fixtures.push(projectPath);
    const store = createRuntimePermissionObservationStore({ projectPath });
    await expect(
      store.recordRequested(
        deriveCodexRuntimePermissionRequest({
          sessionId: "s",
          approvalMode: "on-request",
          sandboxMode: "read-only",
          requestedAt: at,
        }),
      ),
    ).rejects.toThrow("exact native permission projection");
  });
});
