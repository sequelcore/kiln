import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  managedAgentCommand,
  loadManagedAgentCockpitFromTranscript,
  resolveManagedAgentGatewayWebSocketUrl,
  sendManagedAgentCancelControl,
  sendManagedAgentJoinControl,
  type ManagedAgentGatewaySocket,
} from "./managed-agent.js";
import { TranscriptStore } from "../wrapper/session-store.js";

const roots: string[] = [];

describe("managed-agent command", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("projects managed child invocations from canonical transcript events", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendManagedInvocationEvents(transcriptStore, "session-1");

    const projection = await loadManagedAgentCockpitFromTranscript(transcriptStore, "session-1", {
      projectedAt: "2026-05-23T00:00:00.000Z",
    });

    expect(projection.invocations).toHaveLength(1);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "child-1",
      sessionId: "session-1",
      status: "completed",
      lifecycleState: "completed",
      providerRoute: "codex/gpt-5.5",
      resourceLease: {
        cleanupStatus: "completed",
        workingDirectoryMode: "isolated-worktree",
      },
    });
  });

  it("lists and inspects managed child invocations", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendManagedInvocationEvents(transcriptStore, "session-1");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "list",
      ["--session", "session-1"],
      { projectPath: root, projectedAt: () => "2026-05-23T00:00:00.000Z" },
    );
    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "status",
      ["child-1", "--session", "session-1"],
      { projectPath: root, projectedAt: () => "2026-05-23T00:00:00.000Z" },
    );

    expect(log.mock.calls[0]?.[0]).toContain("Managed children for session session-1:");
    expect(log.mock.calls[0]?.[0]).toContain("child-1");
    expect(log.mock.calls[0]?.[0]).toContain("completed");
    expect(log.mock.calls[1]?.[0]).toContain("Managed child: child-1");
    expect(log.mock.calls[1]?.[0]).toContain("Lifecycle: completed");
    expect(log.mock.calls[1]?.[0]).toContain("Provider: codex/gpt-5.5");
    expect(log.mock.calls[1]?.[0]).toContain("Worktree: C:/repo/.kiln/worktrees/child-1");
  });

  it("prints transcript and resource pointers without inventing live controls", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendManagedInvocationEvents(transcriptStore, "session-1");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "transcript",
      ["child-1", "--session", "session-1"],
      { projectPath: root, projectedAt: () => "2026-05-23T00:00:00.000Z" },
    );
    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "resources",
      ["child-1", "--session", "session-1"],
      { projectPath: root, projectedAt: () => "2026-05-23T00:00:00.000Z" },
    );

    expect(log.mock.calls[0]?.[0]).toContain("Transcript: kiln://artifacts/child-1/transcript");
    expect(log.mock.calls[1]?.[0]).toContain("kiln://artifacts/child-1/handoff");
    expect(log.mock.calls[1]?.[0]).toContain("kiln://artifacts/child-1/worktree");
    expect(log.mock.calls[1]?.[0]).toContain("kiln://artifacts/child-1/diagnostics");
  });

  it("prints JSON for automation", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendManagedInvocationEvents(transcriptStore, "session-1");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "list",
      ["--session", "session-1", "--json"],
      { projectPath: root, projectedAt: () => "2026-05-23T00:00:00.000Z" },
    );

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      sessionId: "session-1",
      invocations: [{
        managedInvocationId: "child-1",
        status: "completed",
      }],
    });
  });

  it("resolves managed-agent gateway control websocket endpoints", () => {
    expect(resolveManagedAgentGatewayWebSocketUrl("http://127.0.0.1:4810", "cli-operator"))
      .toBe("ws://127.0.0.1:4810/gui/ws?userId=cli-operator");
    expect(resolveManagedAgentGatewayWebSocketUrl("https://kiln.example.test/base?ignored=true", "cli-operator"))
      .toBe("wss://kiln.example.test/gui/ws?userId=cli-operator");
    expect(resolveManagedAgentGatewayWebSocketUrl("ws://localhost:4810/socket", "cli-operator"))
      .toBe("ws://localhost:4810/gui/ws?userId=cli-operator");
    expect(() => resolveManagedAgentGatewayWebSocketUrl("not a url", "cli-operator"))
      .toThrow("Managed-agent gateway URL must be absolute.");
  });

  it("sends CLI cancel through the gateway-mediated managed-agent control channel", async () => {
    const sockets: FakeManagedAgentGatewaySocket[] = [];
    const resultPromise = sendManagedAgentCancelControl({
      gatewayUrl: "http://127.0.0.1:4810",
      sessionId: "session-1",
      invocationId: "child-running",
      reason: "Operator stopped duplicate work.",
      requestId: "cli-managed-agent-control-1",
      timeoutMs: 1_000,
      webSocketFactory: (url) => {
        const socket = new FakeManagedAgentGatewaySocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe("ws://127.0.0.1:4810/gui/ws?userId=cli-operator");
    sockets[0]?.open();
    expect(JSON.parse(String(sockets[0]?.sent[0]))).toMatchObject({
      type: "managed_agent_control",
      action: "cancel",
      sessionId: "session-1",
      invocationId: "child-running",
      reason: "Operator stopped duplicate work.",
      requestId: "cli-managed-agent-control-1",
    });
    sockets[0]?.message({
      type: "managed_agent_control_result",
      action: "cancel",
      sessionId: "session-1",
      invocationId: "child-running",
      status: "accepted",
      requestId: "cli-managed-agent-control-1",
      handledAt: "2026-05-23T00:00:00.000Z",
    });

    await expect(resultPromise).resolves.toMatchObject({
      status: "accepted",
      sessionId: "session-1",
      invocationId: "child-running",
    });
    expect(sockets[0]?.closed).toBe(true);
  });

  it("sends CLI join through the gateway-mediated managed-agent control channel", async () => {
    const sockets: FakeManagedAgentGatewaySocket[] = [];
    const resultPromise = sendManagedAgentJoinControl({
      gatewayUrl: "http://127.0.0.1:4810",
      sessionId: "session-1",
      invocationId: "child-running",
      requestId: "cli-managed-agent-join-1",
      timeoutMs: 1_000,
      webSocketFactory: (url) => {
        const socket = new FakeManagedAgentGatewaySocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    expect(sockets).toHaveLength(1);
    sockets[0]?.open();
    expect(JSON.parse(String(sockets[0]?.sent[0]))).toMatchObject({
      type: "managed_agent_control",
      action: "join",
      sessionId: "session-1",
      invocationId: "child-running",
      requestId: "cli-managed-agent-join-1",
    });
    sockets[0]?.message({
      type: "session_event",
      event: {
        eventId: "event-joined",
        kilnSessionId: "session-1",
        sequence: 4,
        timestamp: "2026-05-23T00:00:01.000Z",
        kind: "agent_invocation_completed",
        payload: {
          invocationId: "child-running",
          managedInvocationId: "child-running",
          lifecycleState: "completed",
          resultSummary: "Child joined.",
        },
      },
    });
    sockets[0]?.message({
      type: "managed_agent_control_result",
      action: "join",
      sessionId: "session-1",
      invocationId: "child-running",
      status: "accepted",
      requestId: "cli-managed-agent-join-1",
      handledAt: "2026-05-23T00:00:02.000Z",
    });

    await expect(resultPromise).resolves.toMatchObject({
      result: {
        status: "accepted",
        action: "join",
      },
      terminalEvent: {
        kind: "agent_invocation_completed",
      },
    });
    expect(sockets[0]?.closed).toBe(true);
  });

  it("prints CLI cancel acknowledgements without mutating transcript state locally", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendManagedInvocationEvents(transcriptStore, "session-1");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "cancel",
      [
        "child-1",
        "--session",
        "session-1",
        "--gateway",
        "http://127.0.0.1:4810",
        "--reason",
        "Operator stopped duplicate work.",
      ],
      {
        projectPath: root,
        projectedAt: () => "2026-05-23T00:00:00.000Z",
        controlRequestId: () => "cli-managed-agent-control-1",
        controlTimeoutMs: 1_000,
        webSocketFactory: () => {
          const socket = new FakeManagedAgentGatewaySocket("ws://127.0.0.1:4810/gui/ws?userId=cli-operator");
          queueMicrotask(() => {
            socket.open();
            socket.message({
              type: "managed_agent_control_result",
              action: "cancel",
              sessionId: "session-1",
              invocationId: "child-1",
              status: "accepted",
              requestId: "cli-managed-agent-control-1",
              handledAt: "2026-05-23T00:00:01.000Z",
            });
          });
          return socket;
        },
      },
    );

    expect(log.mock.calls[0]?.[0]).toContain("Cancel accepted for managed child child-1.");
    const projection = await loadManagedAgentCockpitFromTranscript(transcriptStore, "session-1", {
      projectedAt: "2026-05-23T00:00:02.000Z",
    });
    expect(projection.invocations[0]?.status).toBe("completed");
  });

  it("prints CLI join terminal evidence without mutating transcript state locally", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendManagedInvocationEvents(transcriptStore, "session-1");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "join",
      ["child-1", "--session", "session-1", "--gateway", "http://127.0.0.1:4810"],
      {
        projectPath: root,
        projectedAt: () => "2026-05-23T00:00:00.000Z",
        controlRequestId: () => "cli-managed-agent-join-1",
        controlTimeoutMs: 1_000,
        webSocketFactory: () => {
          const socket = new FakeManagedAgentGatewaySocket("ws://127.0.0.1:4810/gui/ws?userId=cli-operator");
          queueMicrotask(() => {
            socket.open();
            socket.message({
              type: "session_event",
              event: {
                eventId: "event-joined",
                kilnSessionId: "session-1",
                sequence: 4,
                timestamp: "2026-05-23T00:00:01.000Z",
                kind: "agent_invocation_completed",
                payload: {
                  invocationId: "child-1",
                  managedInvocationId: "child-1",
                  lifecycleState: "completed",
                  resultSummary: "Joined child completed.",
                },
              },
            });
            socket.message({
              type: "managed_agent_control_result",
              action: "join",
              sessionId: "session-1",
              invocationId: "child-1",
              status: "accepted",
              requestId: "cli-managed-agent-join-1",
              handledAt: "2026-05-23T00:00:02.000Z",
            });
          });
          return socket;
        },
      },
    );

    expect(log.mock.calls[0]?.[0]).toContain("Join completed for managed child child-1.");
    expect(log.mock.calls[0]?.[0]).toContain("Lifecycle: completed");
    expect(log.mock.calls[0]?.[0]).toContain("Summary: Joined child completed.");
    const projection = await loadManagedAgentCockpitFromTranscript(transcriptStore, "session-1", {
      projectedAt: "2026-05-23T00:00:03.000Z",
    });
    expect(projection.invocations[0]?.eventCount).toBe(3);
  });
});

class FakeManagedAgentGatewaySocket implements ManagedAgentGatewaySocket {
  onopen: (() => void) | undefined;
  onmessage: ((event: { readonly data: unknown }) => void) | undefined;
  onerror: ((event: unknown) => void) | undefined;
  onclose: (() => void) | undefined;
  readonly sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.();
  }

  message(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kiln-managed-agent-command-"));
  roots.push(root);
  return root;
}

async function appendManagedInvocationEvents(
  transcriptStore: TranscriptStore,
  sessionId: string,
): Promise<void> {
  const lease = {
    leaseId: "child-1:lease",
    createdAt: "2026-05-22T00:00:00.000Z",
    healthStatus: "released",
    cleanupStatus: "completed",
    workingDirectoryPath: "C:/repo/.kiln/worktrees/child-1",
    workingDirectoryMode: "isolated-worktree",
    resourceUris: ["kiln://artifacts/child-1/worktree"],
    diagnosticUris: ["kiln://artifacts/child-1/diagnostics"],
  };
  const commonPayload = {
    instanceId: "local",
    sessionId,
    managedInvocationId: "child-1",
    invocationId: "child-1",
    agentId: "agent-reviewer",
    parentSessionId: sessionId,
    parentTurnId: "turn-1",
    profile: "foundation-apply-approved-writes",
    providerRoute: {
      providerId: "codex",
      surface: "cli",
      model: "gpt-5.5",
    },
    adapterKind: "harness",
    executionMode: "cli-harness",
    requestedAuthority: "audited",
    authorityProfileId: "authority:test",
    capabilitySnapshot: {
      resourceLease: lease,
    },
  };

  await transcriptStore.append(sessionId, {
    eventId: "event-requested",
    kilnSessionId: sessionId,
    sequence: 1,
    timestamp: "2026-05-22T00:00:00.000Z",
    kind: "agent_invocation_requested",
    source: { actor: "runtime", surface: "cli", component: "managed-agent-command-test" },
    payload: {
      ...commonPayload,
      lifecycleState: "pending",
      inputSummary: "Review Slice 5B.",
    },
  });
  await transcriptStore.append(sessionId, {
    eventId: "event-started",
    kilnSessionId: sessionId,
    sequence: 2,
    timestamp: "2026-05-22T00:00:01.000Z",
    kind: "agent_invocation_started",
    source: { actor: "runtime", surface: "cli", component: "managed-agent-command-test" },
    payload: {
      ...commonPayload,
      lifecycleState: "running",
    },
  });
  await transcriptStore.append(sessionId, {
    eventId: "event-completed",
    kilnSessionId: sessionId,
    sequence: 3,
    timestamp: "2026-05-22T00:00:05.000Z",
    kind: "agent_invocation_completed",
    source: { actor: "runtime", surface: "cli", component: "managed-agent-command-test" },
    payload: {
      ...commonPayload,
      lifecycleState: "completed",
      resultSummary: "Child completed.",
      managedInvocationEvidence: {
        lifecycle: {
          resourceLease: lease,
        },
        transcript: {
          uri: "kiln://artifacts/child-1/transcript",
          format: "jsonl",
          redaction: "redacted",
          truncated: false,
        },
        resultHandoff: {
          summary: "Child completed.",
          resourceUris: ["kiln://artifacts/child-1/handoff"],
          memoryWriteProposalUris: [],
        },
      },
    },
  });
}
