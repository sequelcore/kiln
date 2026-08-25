import { describe, expect, it, vi } from "vitest";
import { attestCodexRuntimePermissions } from "./codex-runtime-permission-attestation.js";

describe("Codex runtime permission attestation", () => {
  it("binds exact installed policy, executable, child, session, and returned components", async () => {
    const requested = {
      schema: "kiln.runtime-permission-evidence" as const,
      version: 3 as const,
      kind: "requested" as const,
      harness: "codex" as const,
      sessionDigest: "a".repeat(64),
      targetId: "codex-config",
      projectionDigest: "b".repeat(64),
      effectivePolicyDigest: "c".repeat(64),
      profile: "restricted" as const,
      source: "runtime-request" as const,
      proof: "inferred" as const,
      requestedAt: "2026-08-25T08:00:00.000Z",
      components: {
        approvalControl: { requestedDigest: "d".repeat(64) },
        filesystemSandbox: { requestedDigest: "e".repeat(64) },
        networkBoundary: { requestedDigest: "f".repeat(64) },
      },
    };
    const observed = { ...requested, kind: "observed" as const, source: "runtime-observation" as const } as never;
    const recordRequested = vi.fn(async () => requested);
    const recordObserved = vi.fn(async () => observed);

    const result = await attestCodexRuntimePermissions({ projectPath: "C:/project" }, {
      inspectClient: () => ({ executable: "C:/codex.exe", version: "0.149.1" }),
      readInstalledPolicy: () => ({ approvalMode: "on-request", sandboxMode: "read-only" }),
      digestExecutable: async () => "1".repeat(64),
      runAttestation: async () => ({
        processId: 42,
        proof: {
          protocol: "codex-app-server-v2",
          threadId: "thread-secret",
          approvalMode: "on-request",
          sandboxMode: "read-only",
          networkAccess: "restricted",
        },
      }),
      createObservationStore: () => ({ recordRequested, recordObserved }),
      now: () => new Date("2026-08-25T08:00:00.000Z"),
      createSessionId: () => "session-secret",
    });

    expect(recordRequested).toHaveBeenCalledWith(expect.objectContaining({
      harness: "codex",
      sessionId: "session-secret",
      runtimeVersion: { kind: "executable", version: "0.149.1" },
      componentValues: {
        approvalControl: "approval:on-request",
        filesystemSandbox: "sandbox:read-only",
        networkBoundary: "network:restricted",
      },
    }));
    expect(recordObserved).toHaveBeenCalledWith(requested, expect.objectContaining({
      componentValues: {
        approvalControl: "approval:on-request",
        filesystemSandbox: "sandbox:read-only",
        networkBoundary: "network:restricted",
      },
      runtimeIdentity: {
        protocol: "codex-app-server-v2",
        executableDigest: "1".repeat(64),
        processId: 42,
        threadDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    }));
    expect(JSON.stringify(result)).not.toContain("C:/codex.exe");
    expect(JSON.stringify(result)).not.toContain("thread-secret");
    expect(JSON.stringify(result)).not.toContain("session-secret");
  });

  it("rejects an unadopted app-server version before spawning", async () => {
    const runAttestation = vi.fn();
    await expect(attestCodexRuntimePermissions({ projectPath: "C:/project" }, {
      inspectClient: () => ({ executable: "C:/codex.exe", version: "0.150.0" }),
      readInstalledPolicy: () => ({ approvalMode: "on-request", sandboxMode: "read-only" }),
      digestExecutable: async () => "1".repeat(64),
      runAttestation,
      createObservationStore: vi.fn() as never,
    })).rejects.toThrow("0.149.1");
    expect(runAttestation).not.toHaveBeenCalled();
  });
});
