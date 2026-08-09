import { CredentialPool, type Credential } from "@kilnai/core";
import { describe, expect, it, vi } from "vitest";
import { PooledHarnessSession } from "../../src/wrapper/pooled-harness-session.js";
import type {
  ExecutionSessionEphemeralHarnessStateEvidence,
  ExecutionSessionEvent,
} from "@kilnai/core";
import type { IKilnSession, SessionCapabilities, SessionRunOptions } from "../../src/wrapper/session.js";

const CAPABILITIES: SessionCapabilities = {
  mcp: false,
  streaming: true,
  resumable: false,
  resume: false,
  costTrackingMode: "computed",
  supportedTools: [],
  maxContextTokens: null,
  priority: 3,
  fallbackTo: null,
  permissionPolicy: { approval: "on-request", sandbox: "read-only" },
};

class MockSession implements IKilnSession {
  readonly sessionId: string;
  readonly providerSessionId = undefined;
  readonly capabilities = CAPABILITIES;
  readonly observedHarnessVersion?: string;

  constructor(
    sessionId: string,
    private readonly events: readonly ExecutionSessionEvent[],
    private pendingEvidence: readonly ExecutionSessionEphemeralHarnessStateEvidence[] = [],
    observedHarnessVersion?: string,
  ) {
    this.sessionId = sessionId;
    this.observedHarnessVersion = observedHarnessVersion;
  }

  async *run(_options: SessionRunOptions): AsyncIterable<ExecutionSessionEvent> {
    for (const event of this.events) {
      yield event;
    }
  }

  async dispose(): Promise<void> {}

  drainEphemeralHarnessStateEvidence(): readonly ExecutionSessionEphemeralHarnessStateEvidence[] {
    const evidence = this.pendingEvidence;
    this.pendingEvidence = [];
    return evidence;
  }
}

describe("PooledHarnessSession", () => {
  it("uses configured runtime session identity before an inner harness session is active", () => {
    const session = new PooledHarnessSession({
      runtimeSessionId: "kiln-tui:session-1",
      provider: "codex",
      pool: new CredentialPool<{ homeDir: string }>("codex"),
      createSession: () => new MockSession("inner-session", []),
      createDefaultSession: () => new MockSession("default-session", []),
    });

    expect(session.sessionId).toBe("kiln-tui:session-1");
  });

  it("keeps configured runtime session identity when using the default harness session", async () => {
    const pool = new CredentialPool<{ homeDir: string }>("opencode");
    const session = new PooledHarnessSession({
      runtimeSessionId: "kiln-tui:session-1",
      provider: "opencode",
      pool,
      createSession: () => new MockSession("pooled-session", []),
      createDefaultSession: () => new MockSession("kiln-tui:session-1", [
        { type: "text_delta", content: "default output" },
      ]),
    });

    await expect(collect(session.run({ prompt: "do work" }))).resolves.toEqual([
      { type: "text_delta", content: "default output" },
    ]);
    expect(session.sessionId).toBe("kiln-tui:session-1");
  });

  it("retains the observed inner harness version after the pooled session is disposed", async () => {
    const session = new PooledHarnessSession({
      provider: "claude-code",
      pool: new CredentialPool<{ homeDir: string }>("claude-code"),
      createSession: () => new MockSession("pooled-session", []),
      createDefaultSession: () => new MockSession("default-session", [
        { type: "text_delta", content: "output" },
      ], [], "2.1.226"),
    });

    await collect(session.run({ prompt: "inspect" }));
    await session.dispose();

    expect(session.observedHarnessVersion).toBe("2.1.226");
  });

  it("rotates to the next wrapper home after a 429 and discards failed-attempt events", async () => {
    const pool = new CredentialPool<{ homeDir: string }>("codex", {
      credentials: [
        credential("first", "C:/codex/first"),
        credential("second", "C:/codex/second"),
      ],
    });
    const seenHomes: string[] = [];
    const createDefaultSession = vi.fn();

    const session = new PooledHarnessSession({
      provider: "codex",
      pool,
      createDefaultSession,
      createSession: (auth) => {
        seenHomes.push(auth.homeDir);
        if (auth.homeDir.endsWith("/first")) {
          return new MockSession("first-session", [
            { type: "text_delta", content: "partial output must be discarded" },
            { type: "error", code: "CODEX_EXIT_ERROR", message: "codex exited with 429", isRetryable: false },
            { type: "completed", totalUsd: 0, durationMs: 1, outcome: "failed", isPreflightCrash: false },
          ]);
        }
        return new MockSession("second-session", [
          { type: "text_delta", content: "final output" },
          { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false },
        ]);
      },
    });

    const events = await collect(session.run({ prompt: "do work" }));

    expect(seenHomes).toEqual(["C:/codex/first", "C:/codex/second"]);
    expect(createDefaultSession).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "text_delta", content: "final output" },
      { type: "completed", totalUsd: 0, durationMs: 1, outcome: "completed", isPreflightCrash: false },
    ]);
  });

  it("uses the default session when no harness pool entries exist", async () => {
    const pool = new CredentialPool<{ homeDir: string }>("opencode");
    const createSession = vi.fn();
    const session = new PooledHarnessSession({
      provider: "opencode",
      pool,
      createSession,
      createDefaultSession: () => new MockSession("default-session", [
        { type: "text_delta", content: "default output" },
      ]),
    });

    await expect(collect(session.run({ prompt: "do work" }))).resolves.toEqual([
      { type: "text_delta", content: "default output" },
    ]);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("forwards evidence finalized by the selected pooled session during disposal", async () => {
    const pool = new CredentialPool<{ homeDir: string }>("codex", {
      credentials: [credential("selected", "C:/codex/selected")],
    });
    const evidence: ExecutionSessionEphemeralHarnessStateEvidence = {
      capabilityId: "claude-code-private-plan-artifacts-v1",
      harness: "claude-code",
      artifactCount: 1,
      createdCount: 1,
      modifiedCount: 0,
      deletedCount: 0,
      artifactDigest: "a".repeat(64),
      cleanupStatus: "completed",
      unexpectedDelta: false,
    };
    const session = new PooledHarnessSession({
      provider: "codex",
      pool,
      createSession: () => new MockSession("selected-session", [], [evidence]),
      createDefaultSession: () => new MockSession("default-session", []),
    });

    await collect(session.run({ prompt: "do work" }));
    await session.dispose();

    expect(session.drainEphemeralHarnessStateEvidence?.()).toEqual([evidence]);
    expect(session.drainEphemeralHarnessStateEvidence?.()).toEqual([]);
  });
});

function credential(id: string, homeDir: string): Credential<{ homeDir: string }> {
  return {
    id,
    label: id,
    providerId: "codex",
    source: "manual",
    priority: 0,
    auth: { homeDir },
    requestCount: 0,
    lastSuccess: null,
    lastExhausted: null,
    cooldownUntil: null,
    invalidReason: null,
    softLeaseCount: 0,
  };
}

async function collect(events: AsyncIterable<ExecutionSessionEvent>): Promise<ExecutionSessionEvent[]> {
  const collected: ExecutionSessionEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
