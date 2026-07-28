import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";

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
      parentTurnId: "turn-1",
      routeSource: "explicit-managed-route",
      providerRoute: "codex/gpt-5.5",
      resourceLease: {
        cleanupStatus: "completed",
        workingDirectoryMode: "isolated-worktree",
      },
    });
  });

  it("projects GUI managed child invocations from persisted managed tool evidence", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendGuiManagedToolEvidenceEvents(transcriptStore, "session-1");

    const projection = await loadManagedAgentCockpitFromTranscript(transcriptStore, "session-1", {
      projectedAt: "2026-05-27T10:00:00.000Z",
    });

    expect(projection.invocations.map((item) => item.managedInvocationId)).toEqual([
      "gui-child-1",
      "gui-child-2",
    ]);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "gui-child-1",
      sessionId: "session-1",
      status: "failed",
      lifecycleState: "timed_out",
      parentTurnId: "session-1:turn:1",
      routeSource: "explicit-managed-route",
      providerRoute: "codex-oauth/gpt-5.5",
      transcript: {
        uri: "kiln://artifacts/managed-invocations/artifact_1/content",
      },
      resultHandoff: {
        resourceUris: [
          "kiln://artifacts/managed-invocations/artifact_1/content",
          "kiln://artifacts/managed-invocations/artifact_2/content",
        ],
      },
    });
    expect(projection.invocations[1]).toMatchObject({
      managedInvocationId: "gui-child-2",
      sessionId: "session-1",
      status: "failed",
      lifecycleState: "timed_out",
      parentTurnId: "session-1:turn:1",
      routeSource: "explicit-managed-route",
      providerRoute: "codex-oauth/gpt-5.5",
    });
  });

  it("projects runtime adoption-gate snapshots from managed work-item transcript events", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendManagedInvocationEvents(transcriptStore, "session-1");
    await appendManagedAdoptionGateEvent(transcriptStore, "session-1", {
      childId: "child-1",
      status: "rejected",
      blockingEvidence: ["managed-orchestration:adoption-gate"],
      rejection: {
        gate: "managed orchestration adoption gate",
        summary: "Reviewer rejected the child handoff.",
        evidence: ["kiln://artifacts/child-1/adoption-review"],
        completedAt: "2026-05-22T00:00:07.000Z",
      },
    });
    await appendManagedAdoptionGateEvent(transcriptStore, "session-1", {
      eventId: "event-adoption-mismatch",
      childId: "child-other",
      status: "adopted",
      resourceUris: ["kiln://artifacts/child-other/adoption"],
      blockingEvidence: [],
    });

    const projection = await loadManagedAgentCockpitFromTranscript(transcriptStore, "session-1", {
      projectedAt: "2026-05-23T00:00:00.000Z",
    });

    expect(projection.invocations).toHaveLength(1);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: "child-1",
      adoptionGate: {
        required: true,
        status: "rejected",
        childId: "child-1",
        blockingEvidence: ["managed-orchestration:adoption-gate"],
        rejection: {
          gate: "managed orchestration adoption gate",
          summary: "Reviewer rejected the child handoff.",
          evidence: ["kiln://artifacts/child-1/adoption-review"],
        },
      },
      evidenceResourceUris: expect.arrayContaining([
        "kiln://artifacts/child-1/adoption-review",
      ]),
    });
  });

  it("ignores malformed adoption-gate work-item snapshots before projection", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendManagedInvocationEvents(transcriptStore, "session-1");
    await transcriptStore.append("session-1", {
      eventId: "event-adoption-malformed",
      kilnSessionId: "session-1",
      sequence: 4,
      timestamp: "2026-05-22T00:00:06.000Z",
      kind: "work_item_updated",
      source: { actor: "runtime", surface: "cli", component: "managed-agent-command-test" },
      payload: {
        instanceId: "local",
        sessionId: "session-1",
        managedOrchestrationAdoptionGate: {},
      },
    });

    const projection = await loadManagedAgentCockpitFromTranscript(transcriptStore, "session-1", {
      projectedAt: "2026-05-23T00:00:00.000Z",
    });

    expect(projection.timeline.map((event) => event.eventId)).not.toContain("event-adoption-malformed");
    expect(projection.invocations[0]?.adoptionGate).toBeUndefined();
  });

  it("ignores adoption-gate snapshots with a payload session outside the transcript envelope", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendManagedInvocationEvents(transcriptStore, "session-1");
    await appendManagedAdoptionGateEvent(transcriptStore, "session-1", {
      eventId: "event-adoption-session-mismatch",
      childId: "child-1",
      status: "adopted",
      payloadSessionId: "session-other",
      resourceUris: ["kiln://artifacts/child-1/adoption"],
      blockingEvidence: [],
    });

    const projection = await loadManagedAgentCockpitFromTranscript(transcriptStore, "session-1", {
      projectedAt: "2026-05-23T00:00:00.000Z",
    });

    expect(projection.timeline.map((event) => event.eventId)).not.toContain("event-adoption-session-mismatch");
    expect(projection.invocations[0]?.adoptionGate).toBeUndefined();
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
    expect(log.mock.calls[0]?.[0]).toContain("parent:turn-1");
    expect(log.mock.calls[0]?.[0]).toContain("review:required");
    expect(log.mock.calls[1]?.[0]).toContain("Managed child: child-1");
    expect(log.mock.calls[1]?.[0]).toContain("Lifecycle: completed");
    expect(log.mock.calls[1]?.[0]).toContain("Parent turn: turn-1");
    expect(log.mock.calls[1]?.[0]).toContain("Provider: codex/gpt-5.5");
    expect(log.mock.calls[1]?.[0]).toContain("Worktree: C:/repo/.kiln/worktrees/child-1");
    expect(log.mock.calls[1]?.[0]).toContain("Worktree review: required · dirty-worktree-preserved");
    expect(log.mock.calls[1]?.[0]).toContain("Worktree review resources: kiln://artifacts/child-1/worktree-review");
    expect(log.mock.calls[1]?.[0]).toContain("Worktree review diagnostics: kiln://artifacts/child-1/worktree-review-required");
  });

  it("resolves project state from the canonical root when invoked with a nested project path", async () => {
    const root = await tempRoot();
    const packageCliPath = join(root, "packages", "cli");
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, ".kiln"), { recursive: true });
    await mkdir(join(packageCliPath, ".kiln"), { recursive: true });
    await writeFile(join(root, ".kiln", "kiln.yaml"), "version: \"1\"\n", "utf-8");

    const rootSessionStore = new SessionStore(root);
    const nestedSessionStore = new SessionStore(packageCliPath);
    const rootTranscriptStore = new TranscriptStore(root);
    await appendManagedInvocationEvents(rootTranscriptStore, "root-session");
    await rootSessionStore.append({
      sessionId: "root-session",
      provider: "codex-oauth",
      task: "Root session",
      completedAt: "2026-05-23T00:00:00.000Z",
      cost: 0,
      projectPath: root,
    });
    await nestedSessionStore.append({
      sessionId: "nested-stale-session",
      provider: "codex-oauth",
      task: "Nested stale session",
      completedAt: "2026-05-23T00:01:00.000Z",
      cost: 0,
      projectPath: packageCliPath,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "list",
      [],
      { projectPath: packageCliPath, projectedAt: () => "2026-05-23T00:00:00.000Z" },
    );

    expect(log.mock.calls[0]?.[0]).toContain("Managed children for session root-session:");
    expect(log.mock.calls[0]?.[0]).not.toContain("nested-stale-session");
  });

  it("prints governed worktree conflict state from shared projection", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendManagedConflictEvent(transcriptStore, "session-1");
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
      ["child-conflict", "--session", "session-1"],
      { projectPath: root, projectedAt: () => "2026-05-23T00:00:00.000Z" },
    );

    expect(log.mock.calls[0]?.[0]).toContain("conflict:blocked");
    expect(log.mock.calls[1]?.[0]).toContain("Worktree conflict: blocked · same-checkout-write-conflict");
    expect(log.mock.calls[1]?.[0]).toContain("Requested invocation: child-conflict");
    expect(log.mock.calls[1]?.[0]).toContain("Conflicting invocation: child-active");
    expect(log.mock.calls[1]?.[0]).toContain("Conflict worktree: workspace-write · C:/repo");
    expect(log.mock.calls[1]?.[0]).toContain("Retry after: child-active");
    expect(log.mock.calls[1]?.[0]).toContain("Conflict resources: kiln://artifacts/child-conflict/worktree-conflict-resource");
    expect(log.mock.calls[1]?.[0]).toContain("Conflict diagnostics: kiln://artifacts/child-conflict/worktree-conflict");
  });

  it("prints adoption-gate status and blocked detail from shared projection", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendManagedInvocationEvents(transcriptStore, "session-1");
    await appendManagedAdoptionGateEvent(transcriptStore, "session-1", {
      childId: "child-1",
      status: "pending_review",
      blockingEvidence: ["managed-orchestration:adoption-gate"],
    });
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

    expect(log.mock.calls[0]?.[0]).toContain("adoption:pending_review");
    expect(log.mock.calls[1]?.[0]).toContain("Adoption: pending_review");
    expect(log.mock.calls[1]?.[0]).toContain("Adoption blocking evidence: managed-orchestration:adoption-gate");
    expect(log.mock.calls[1]?.[0]).not.toContain("merge");
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
    expect(log.mock.calls[1]?.[0]).toContain("Worktree review: required · dirty-worktree-preserved");
    expect(log.mock.calls[1]?.[0]).toContain("Worktree review resources: kiln://artifacts/child-1/worktree-review");
    expect(log.mock.calls[1]?.[0]).toContain("Worktree review diagnostics: kiln://artifacts/child-1/worktree-review-required");
  });

  it("prints terminal managed-child rows from shared managed-child view-state", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendManagedTerminalViewStateEvents(transcriptStore, "session-1");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "list",
      ["--session", "session-1"],
      { projectPath: root, projectedAt: () => "2026-05-24T12:01:00.000Z" },
    );
    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "status",
      ["child-timeout", "--session", "session-1"],
      { projectPath: root, projectedAt: () => "2026-05-24T12:01:00.000Z" },
    );
    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "status",
      ["child-failed", "--session", "session-1"],
      { projectPath: root, projectedAt: () => "2026-05-24T12:01:00.000Z" },
    );
    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "resources",
      ["child-failed", "--session", "session-1"],
      { projectPath: root, projectedAt: () => "2026-05-24T12:01:00.000Z" },
    );

    expect(log.mock.calls[0]?.[0]).toBe([
      "Managed children for session session-1:",
      "attention: 4  active: 0",
      "child-timeout             timed_out     failed      timed_out     codex-oauth/gpt-5.5  resources:2  cancel:unavailable",
      "child-stale               stale         failed      stale         opencode/minimax-m2.5  resources:2  cancel:unavailable",
      "child-failed              failed        failed      failed        codex-oauth/gpt-5.5  resources:3  cancel:unavailable",
      "child-cancelled           cancelled     cancelled   cancelled     opencode/minimax-m2.5  resources:1  cancel:unavailable",
    ].join("\n"));
    expect(log.mock.calls[1]?.[0]).toBe([
      "Managed child: child-timeout",
      "Session: session-1",
      "Attention: timed_out",
      "Status: failed",
      "Lifecycle: timed_out",
      "Provider: codex-oauth/gpt-5.5",
      "Events: 1",
      "Resources: 2",
      "Cancel: unavailable · Managed invocation is not active.",
    ].join("\n"));
    expect(log.mock.calls[2]?.[0]).toBe([
      "Managed child: child-failed",
      "Session: session-1",
      "Attention: failed",
      "Status: failed",
      "Lifecycle: failed",
      "Provider: codex-oauth/gpt-5.5",
      "Events: 1",
      "Resources: 3",
      "Source resources: kiln://session/work-items/child-failed-source",
      "Cancel: unavailable · Managed invocation is not active.",
    ].join("\n"));
    expect(log.mock.calls[3]?.[0]).toBe([
      "Resources for managed child child-failed:",
      "Source resources:",
      "- kiln://session/work-items/child-failed-source",
      "Evidence resources:",
      "- kiln://managed-agents/invocations/child-failed/handoff",
      "- kiln://managed-agents/invocations/child-failed/resources/failure",
    ].join("\n"));
  });

  it("prints adoption-gate metadata in resources text and JSON output", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendManagedInvocationEvents(transcriptStore, "session-1");
    await appendManagedAdoptionGateEvent(transcriptStore, "session-1", {
      childId: "child-1",
      status: "rejected",
      resourceUris: ["kiln://artifacts/child-1/adoption-resource"],
      blockingEvidence: ["managed-orchestration:adoption-gate"],
      rejection: {
        gate: "managed orchestration adoption gate",
        summary: "Reviewer rejected the child handoff.",
        evidence: ["kiln://artifacts/child-1/adoption-review"],
      },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "resources",
      ["child-1", "--session", "session-1"],
      { projectPath: root, projectedAt: () => "2026-05-23T00:00:00.000Z" },
    );
    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "resources",
      ["child-1", "--session", "session-1", "--json"],
      { projectPath: root, projectedAt: () => "2026-05-23T00:00:00.000Z" },
    );

    expect(log.mock.calls[0]?.[0]).toContain("Adoption: rejected");
    expect(log.mock.calls[0]?.[0]).toContain("Adoption blocking evidence: managed-orchestration:adoption-gate");
    expect(log.mock.calls[0]?.[0]).toContain("Adoption rejection evidence: kiln://artifacts/child-1/adoption-review");
    const jsonOutput = JSON.parse(String(log.mock.calls[1]?.[0])) as Record<string, unknown>;
    expect(Object.keys(jsonOutput).sort()).toEqual(["invocation", "sessionId"]);
    expect(jsonOutput).toMatchObject({
      sessionId: "session-1",
      invocation: {
        managedInvocationId: "child-1",
        evidenceResourceUris: expect.arrayContaining([
          "kiln://artifacts/child-1/adoption-resource",
          "kiln://artifacts/child-1/adoption-review",
        ]),
        adoptionGate: {
          status: "rejected",
          blockingEvidence: ["managed-orchestration:adoption-gate"],
          rejection: {
            evidence: ["kiln://artifacts/child-1/adoption-review"],
          },
        },
        resourceLease: {
          worktreeReview: {
            status: "required",
            reason: "dirty-worktree-preserved",
            resourceUris: ["kiln://artifacts/child-1/worktree-review"],
            diagnosticUris: ["kiln://artifacts/child-1/worktree-review-required"],
          },
        },
      },
    });
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
      workspaceHome: {
        work: {
          totalCount: 0,
          activeCount: 0,
          blockedCount: 0,
          missingEvidenceCount: 0,
          goalCount: 0,
          activeGoalCount: 0,
          items: [],
        },
        managedAgents: {
          totalCount: 1,
          activeCount: 0,
          attentionCount: 1,
        },
        approvals: { pendingCount: 0, resolvedCount: 0, items: [] },
        configHealth: { status: "unknown", issueCount: 0, items: [] },
        routeHealth: {
          totalCount: 0,
          healthyCount: 0,
          degradedCount: 0,
          blockedCount: 0,
          unknownCount: 0,
          items: [],
        },
        providerReadiness: {
          totalCount: 1,
          liveProvenCount: 0,
          configuredCount: 0,
          unprovenCount: 0,
          unknownCount: 1,
          items: [{
            providerId: "codex",
            model: "gpt-5.5",
            status: "unknown",
          }],
        },
        gatewayTargets: [{
          gatewayTarget: {
            targetId: "local",
            kind: "local-operator-gateway",
            trust: "local",
          },
        }],
        gatewayHealth: {
          status: "healthy",
          targetCount: 1,
          localCount: 1,
          remoteCount: 0,
          appTargetCount: 0,
          tenantTargetCount: 0,
        },
      },
      invocations: [{
        managedInvocationId: "child-1",
        status: "completed",
      }],
    });
  });

  it("prints adoption-gate JSON without a CLI-local DTO", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendManagedInvocationEvents(transcriptStore, "session-1");
    await appendManagedAdoptionGateEvent(transcriptStore, "session-1", {
      childId: "child-1",
      status: "adopted",
      resourceUris: ["kiln://artifacts/child-1/adoption-review"],
      blockingEvidence: [],
      adoptedBy: "operator",
      adoptedAt: "2026-05-22T00:00:07.000Z",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await managedAgentCommand(
      { createRegistry: (() => undefined) as never },
      "status",
      ["child-1", "--session", "session-1", "--json"],
      { projectPath: root, projectedAt: () => "2026-05-23T00:00:00.000Z" },
    );

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      sessionId: "session-1",
      invocation: {
        managedInvocationId: "child-1",
        adoptionGate: {
          status: "adopted",
          adoptedBy: "operator",
          adoptedAt: "2026-05-22T00:00:07.000Z",
          resourceUris: ["kiln://artifacts/child-1/adoption-review"],
        },
      },
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
    worktreeReview: {
      status: "required",
      reason: "dirty-worktree-preserved",
      resourceUris: ["kiln://artifacts/child-1/worktree-review"],
      diagnosticUris: ["kiln://artifacts/child-1/worktree-review-required"],
    },
  };
  const commonPayload = {
    instanceId: "local",
    sessionId,
    managedInvocationId: "child-1",
    invocationId: "child-1",
    agentId: "agent-reviewer",
    parentSessionId: sessionId,
    parentTurnId: "turn-1",
    routeSource: "explicit-managed-route",
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

async function appendGuiManagedToolEvidenceEvents(
  transcriptStore: TranscriptStore,
  sessionId: string,
): Promise<void> {
  const startedAt = "2026-05-27T08:57:54.774Z";
  const finishedAt = "2026-05-27T08:59:54.780Z";
  const baseMetadata = {
    kind: "managed-invocation",
    routeId: "codex-oauth-readonly",
    routeSource: "explicit-managed-route",
    parentTurnId: `${sessionId}:turn:1`,
    profile: "foundation-readonly-plan",
    providerRoute: {
      providerId: "codex-oauth",
      surface: "direct-provider",
      model: "gpt-5.5",
    },
    adapterKind: "direct",
    executionMode: "direct-provider",
    requestedAuthority: "read_only",
    authorityProfileId: "authority:codex-oauth-readonly:foundation-readonly-plan",
  };
  const appendToolCompletion = async (
    event: Parameters<TranscriptStore["append"]>[1],
  ): Promise<void> => {
    const toolCallId = event.payload.toolCallId;
    const toolName = event.payload.toolName;
    if (typeof toolCallId !== "string" || typeof toolName !== "string" || !event.turnId) {
      throw new Error("Managed tool evidence fixture requires canonical tool identity.");
    }
    const toolCallScopeId = `${event.turnId}:response:1`;
    await transcriptStore.append(sessionId, {
      ...event,
      eventId: `${event.eventId}:started`,
      sequence: event.sequence * 2 - 1,
      kind: "tool_call_started",
      payload: {
        toolCallId,
        toolCallScopeId,
        toolName,
        input: {},
      },
    });
    await transcriptStore.append(sessionId, {
      ...event,
      sequence: event.sequence * 2,
      payload: {
        ...event.payload,
        toolCallScopeId,
      },
    });
  };
  await appendToolCompletion({
    eventId: "event-gui-start-1",
    kilnSessionId: sessionId,
    sequence: 1,
    timestamp: startedAt,
    kind: "tool_call_completed",
    source: { actor: "tool", surface: "gui", component: "gui-command" },
    turnId: `${sessionId}:turn:1`,
    payload: {
      toolCallId: `${sessionId}:turn:1:tool:1`,
      toolName: "managed_agent.start",
      output: JSON.stringify({
        status: "started",
        lifecycleState: "running",
        invocationId: "gui-child-1",
        routeId: "codex-oauth-readonly",
        routeSource: "explicit-managed-route",
        parentTurnId: `${sessionId}:turn:1`,
        profile: "foundation-readonly-plan",
      }),
      metadata: {
        ...baseMetadata,
        toolName: "managed_agent.start",
        invocationId: "gui-child-1",
        status: "started",
        lifecycleState: "running",
      },
      status: { state: "succeeded" },
    },
  });
  await appendToolCompletion({
    eventId: "event-gui-start-2",
    kilnSessionId: sessionId,
    sequence: 2,
    timestamp: startedAt,
    kind: "tool_call_completed",
    source: { actor: "tool", surface: "gui", component: "gui-command" },
    turnId: `${sessionId}:turn:1`,
    payload: {
      toolCallId: `${sessionId}:turn:1:tool:2`,
      toolName: "managed_agent.start",
      output: JSON.stringify({
        status: "started",
        lifecycleState: "running",
        invocationId: "gui-child-2",
        routeId: "codex-oauth-readonly",
        routeSource: "explicit-managed-route",
        parentTurnId: `${sessionId}:turn:1`,
        profile: "foundation-readonly-plan",
      }),
      metadata: {
        ...baseMetadata,
        toolName: "managed_agent.start",
        invocationId: "gui-child-2",
        status: "started",
        lifecycleState: "running",
      },
      status: { state: "succeeded" },
    },
  });
  await appendToolCompletion({
    eventId: "event-gui-join-1",
    kilnSessionId: sessionId,
    sequence: 3,
    timestamp: "2026-05-27T09:00:35.895Z",
    kind: "tool_call_completed",
    source: { actor: "tool", surface: "gui", component: "gui-command" },
    turnId: `${sessionId}:turn:2`,
    payload: {
      toolCallId: `${sessionId}:turn:2:tool:1`,
      toolName: "managed_agent.join",
      output: "Direct provider managed invocation timed out after 120000ms.",
      metadata: {
        ...baseMetadata,
        toolName: "managed_agent.join",
        invocationId: "gui-child-1",
        status: "timed_out",
        lifecycleState: "timed_out",
        childSessionId: `${sessionId}:managed:gui-child-1`,
        childTurnId: `${sessionId}:managed:gui-child-1:turn:1`,
        resultHandoff: {
          summary: "Direct provider managed invocation timed out after 120000ms.",
          resourceUris: [
            "kiln://artifacts/managed-invocations/artifact_1/content",
            "kiln://artifacts/managed-invocations/artifact_2/content",
          ],
          memoryWriteProposalUris: [],
        },
        transcript: {
          uri: "kiln://artifacts/managed-invocations/artifact_1/content",
          redacted: "unknown",
          truncated: false,
          persisted: true,
          retention: "session",
        },
        diagnostics: [{
          uri: "kiln://artifacts/managed-invocations/artifact_2/content",
          kind: "timeout",
        }],
      },
      status: { state: "failed" },
    },
  });
  await appendToolCompletion({
    eventId: "event-gui-list",
    kilnSessionId: sessionId,
    sequence: 4,
    timestamp: "2026-05-27T09:02:48.036Z",
    kind: "tool_call_completed",
    source: { actor: "tool", surface: "gui", component: "gui-command" },
    turnId: `${sessionId}:turn:3`,
    payload: {
      toolCallId: `${sessionId}:turn:3:tool:1`,
      toolName: "managed_agent.list",
      output: JSON.stringify({
        status: "listed",
        count: 2,
        invocations: [
          {
            invocationId: "gui-child-1",
            agentId: "codex-oauth-readonly:foundation-readonly-plan",
            parentSessionId: sessionId,
            parentTurnId: `${sessionId}:turn:1`,
            routeSource: "explicit-managed-route",
            profile: "foundation-readonly-plan",
            providerRoute: baseMetadata.providerRoute,
            adapterKind: "direct",
            executionMode: "direct-provider",
            authorityProfileId: baseMetadata.authorityProfileId,
            lifecycleState: "timed_out",
            startedAt,
            finishedAt,
            durationMs: 120006,
            terminalEvidenceAvailable: true,
          },
          {
            invocationId: "gui-child-2",
            agentId: "codex-oauth-readonly:foundation-readonly-plan",
            parentSessionId: sessionId,
            parentTurnId: `${sessionId}:turn:1`,
            routeSource: "explicit-managed-route",
            profile: "foundation-readonly-plan",
            providerRoute: baseMetadata.providerRoute,
            adapterKind: "direct",
            executionMode: "direct-provider",
            authorityProfileId: baseMetadata.authorityProfileId,
            lifecycleState: "timed_out",
            startedAt,
            finishedAt: "2026-05-27T08:59:54.810Z",
            durationMs: 120008,
            terminalEvidenceAvailable: true,
          },
        ],
      }),
      status: { state: "succeeded" },
    },
  });
}

async function appendManagedConflictEvent(
  transcriptStore: TranscriptStore,
  sessionId: string,
): Promise<void> {
  const lease = {
    leaseId: "child-conflict:lease",
    createdAt: "2026-05-22T00:00:00.000Z",
    healthStatus: "stale",
    cleanupStatus: "not-required",
    workingDirectoryPath: "C:/repo",
    workingDirectoryMode: "workspace-write",
    resourceUris: ["kiln://artifacts/child-conflict/worktree-conflict-resource"],
    diagnosticUris: ["kiln://artifacts/child-conflict/worktree-conflict"],
    worktreeConflict: {
      status: "blocked",
      reason: "same-checkout-write-conflict",
      requestedInvocationId: "child-conflict",
      conflictingInvocationId: "child-active",
      workingDirectoryPath: "C:/repo",
      workingDirectoryMode: "workspace-write",
      policyId: "managed-agent.worktree.single-active-writer",
      retryAfterInvocationIds: ["child-active"],
      resourceUris: ["kiln://artifacts/child-conflict/worktree-conflict-resource"],
      diagnosticUris: ["kiln://artifacts/child-conflict/worktree-conflict"],
    },
  };

  await transcriptStore.append(sessionId, {
    eventId: "event-conflict",
    kilnSessionId: sessionId,
    sequence: 1,
    timestamp: "2026-05-22T00:00:00.000Z",
    kind: "agent_invocation_failed",
    source: { actor: "runtime", surface: "cli", component: "managed-agent-command-test" },
    payload: {
      instanceId: "local",
      sessionId,
      managedInvocationId: "child-conflict",
      invocationId: "child-conflict",
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
      lifecycleState: "failed",
      managedInvocationEvidence: {
        lifecycle: {
          resourceLease: lease,
        },
      },
    },
  });
}

async function appendManagedTerminalViewStateEvents(
  transcriptStore: TranscriptStore,
  sessionId: string,
): Promise<void> {
  await transcriptStore.append(sessionId, {
    eventId: "event-timeout",
    kilnSessionId: sessionId,
    sequence: 1,
    timestamp: "2026-05-24T12:00:01.000Z",
    kind: "agent_invocation_failed",
    source: { actor: "runtime", surface: "cli", component: "managed-agent-command-test" },
    payload: {
      instanceId: "local",
      sessionId,
      managedInvocationId: "child-timeout",
      invocationId: "child-timeout",
      agentId: "agent-reviewer",
      lifecycleState: "timed_out",
      providerRoute: {
        providerId: "codex-oauth",
        model: "gpt-5.5",
      },
      managedInvocationEvidence: {
        diagnostics: [{
          uri: "kiln://managed-agents/invocations/child-timeout/resources/timeout",
          kind: "timeout",
        }],
        resultHandoff: {
          summary: "Managed child timed out after the configured limit.",
          resourceUris: ["kiln://managed-agents/invocations/child-timeout/handoff"],
          memoryWriteProposalUris: [],
        },
      },
    },
  });
  await transcriptStore.append(sessionId, {
    eventId: "event-cancelled",
    kilnSessionId: sessionId,
    sequence: 3,
    timestamp: "2026-05-24T12:00:02.000Z",
    kind: "agent_invocation_cancelled",
    source: { actor: "runtime", surface: "cli", component: "managed-agent-command-test" },
    payload: {
      instanceId: "local",
      sessionId,
      managedInvocationId: "child-cancelled",
      invocationId: "child-cancelled",
      agentId: "agent-reviewer",
      lifecycleState: "cancelled",
      reason: "Operator cancelled from CLI.",
      providerRoute: {
        providerId: "opencode",
        model: "minimax-m2.5",
      },
      managedInvocationEvidence: {
        resultHandoff: {
          summary: "Operator cancelled from CLI.",
          resourceUris: [
            "kiln://managed-agents/invocations/child-cancelled/resources/cancel-cleanup",
            "kiln://managed-agents/invocations/child-cancelled/resources/cancel-cleanup",
          ],
          memoryWriteProposalUris: [],
        },
      },
    },
  });
  await transcriptStore.append(sessionId, {
    eventId: "event-stale",
    kilnSessionId: sessionId,
    sequence: 2,
    timestamp: "2026-05-24T12:00:01.500Z",
    kind: "agent_invocation_failed",
    source: { actor: "runtime", surface: "cli", component: "managed-agent-command-test" },
    payload: {
      instanceId: "local",
      sessionId,
      managedInvocationId: "child-stale",
      invocationId: "child-stale",
      agentId: "agent-reviewer",
      lifecycleState: "stale",
      errorCode: "ENGINE_STALE",
      errorMessage: "Managed invocation heartbeat expired.",
      providerRoute: {
        providerId: "opencode",
        model: "minimax-m2.5",
      },
      managedInvocationEvidence: {
        diagnostics: [{
          uri: "kiln://managed-agents/invocations/child-stale/resources/heartbeat",
          kind: "heartbeat",
        }],
        resultHandoff: {
          summary: "Managed invocation heartbeat expired.",
          resourceUris: ["kiln://managed-agents/invocations/child-stale/handoff"],
          memoryWriteProposalUris: [],
        },
      },
    },
  });
  await transcriptStore.append(sessionId, {
    eventId: "event-failed",
    kilnSessionId: sessionId,
    sequence: 4,
    timestamp: "2026-05-24T12:00:02.500Z",
    kind: "agent_invocation_failed",
    source: { actor: "runtime", surface: "cli", component: "managed-agent-command-test" },
    payload: {
      instanceId: "local",
      sessionId,
      managedInvocationId: "child-failed",
      invocationId: "child-failed",
      agentId: "agent-reviewer",
      lifecycleState: "failed",
      errorCode: "ADAPTER_FAILURE",
      errorMessage: "Managed child adapter failed before handoff.",
      providerRoute: {
        providerId: "codex-oauth",
        model: "gpt-5.5",
      },
      managedInvocationEvidence: {
        lifecycle: {
          sourceResourceUris: ["kiln://session/work-items/child-failed-source"],
        },
        diagnostics: [{
          uri: "kiln://managed-agents/invocations/child-failed/resources/failure",
          kind: "failure",
        }],
        resultHandoff: {
          summary: "Managed child adapter failed before handoff.",
          resourceUris: [
            "kiln://managed-agents/invocations/child-failed/handoff",
            "kiln://managed-agents/invocations/child-failed/resources/failure",
          ],
          memoryWriteProposalUris: [],
        },
      },
    },
  });
}

async function appendManagedAdoptionGateEvent(
  transcriptStore: TranscriptStore,
  sessionId: string,
  input: {
    readonly eventId?: string;
    readonly childId: string;
    readonly status: "not_required" | "pending_review" | "adopted" | "rejected" | "blocked";
    readonly adoptedBy?: string;
    readonly adoptedAt?: string;
    readonly payloadSessionId?: string;
    readonly resourceUris?: readonly string[];
    readonly blockingEvidence: readonly string[];
    readonly rejection?: {
      readonly gate: string;
      readonly summary?: string;
      readonly evidence: readonly string[];
      readonly completedAt?: string;
    };
  },
): Promise<void> {
  await transcriptStore.append(sessionId, {
    eventId: input.eventId ?? "event-adoption",
    kilnSessionId: sessionId,
    sequence: input.eventId ? 5 : 4,
    timestamp: "2026-05-22T00:00:06.000Z",
    kind: "work_item_updated",
    source: { actor: "runtime", surface: "cli", component: "managed-agent-command-test" },
    payload: {
      instanceId: "local",
      sessionId: input.payloadSessionId ?? sessionId,
      workItem: {
        id: `work-${input.childId}`,
        summary: "Review managed child output.",
        status: input.status === "adopted" || input.status === "not_required" ? "completed" : "blocked",
        workflowProfile: "sequel-standard",
        expectedEvidence: ["managed-orchestration:adoption-gate"],
        providedEvidence: ["managed-orchestration:result-handoff"],
        updatedAt: "2026-05-22T00:00:06.000Z",
      },
      managedOrchestrationAdoptionGate: {
        required: input.status !== "not_required",
        target: "slice-6-handoff-review-adoption",
        reason: "Managed child output must be adopted before closeout.",
        orchestrationId: "orch-adoption",
        childId: input.childId,
        mergePolicyMode: "manual",
        status: input.status,
        ...(input.adoptedBy ? { adoptedBy: input.adoptedBy } : {}),
        ...(input.adoptedAt ? { adoptedAt: input.adoptedAt } : {}),
        resourceUris: input.resourceUris ?? [],
        ...(input.rejection ? { rejection: input.rejection } : {}),
        blockingEvidence: input.blockingEvidence,
      },
    },
  });
}
