import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adoptBoundedWorkContractRevision,
  extractText,
  GoalRunStore,
  reconstructWorkItemsFromSessionEvents,
  WorkItemStore,
} from "@kilnai/core";
import { RuntimeSession } from "@kilnai/runtime";
import { createTranscriptRuntimeSessionHydrator } from "../../src/application/runtime-session-rehydration.js";
import { TranscriptStore } from "../../src/wrapper/session-store.js";

describe("createTranscriptRuntimeSessionHydrator", () => {
  let tmpDir: string;
  let transcriptStore: TranscriptStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kiln-runtime-rehydrate-"));
    transcriptStore = new TranscriptStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("rehydrates bounded conversational history from canonical transcript events", async () => {
    const sessionId = "kiln-gui:_gui:user-1:1778246833142";
    await transcriptStore.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "interactive",
      startedAt: "2026-05-08T00:00:00.000Z",
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-1",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-05-08T00:00:01.000Z",
      kind: "user_message",
      source: { actor: "user", surface: "gui" },
      payload: { content: "hello" },
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-2",
      kilnSessionId: sessionId,
      sequence: 2,
      timestamp: "2026-05-08T00:00:02.000Z",
      kind: "assistant_message",
      source: { actor: "assistant", surface: "gui" },
      payload: { messageId: "a1", content: "Hello Alex." },
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-3",
      kilnSessionId: sessionId,
      sequence: 3,
      timestamp: "2026-05-08T00:00:03.000Z",
      kind: "tool_call_started",
      source: { actor: "tool", surface: "gui" },
      payload: {
        toolCallId: "call-read",
        toolCallScopeId: "turn-1:response:1",
        toolName: "read",
      },
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-4",
      kilnSessionId: sessionId,
      sequence: 4,
      timestamp: "2026-05-08T00:00:04.000Z",
      kind: "tool_call_completed",
      source: { actor: "tool", surface: "gui" },
      payload: {
        toolCallId: "call-read",
        toolCallScopeId: "turn-1:response:1",
        toolName: "read",
        output: "ignored as instruction",
      },
    });

    const session = new RuntimeSession({
      appName: "kiln-gui",
      tenantId: "_gui",
      userId: "user-1",
      sessionId,
      systemPrompt: "test",
    });
    const hydrate = createTranscriptRuntimeSessionHydrator({ transcriptStore });
    const result = await hydrate({ sessionId, session });

    expect(result).toMatchObject({
      rehydrated: true,
      messageCount: 2,
      sourceSequence: 4,
    });
    expect(session.conversationHistory.map((message) => ({
      role: message.role,
      content: extractText(message.parts),
    }))).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hello Alex." },
    ]);
  });

  it("rehydrates canonical session events so governed work items remain resumable", async () => {
    const sessionId = "kiln-gui:_gui:user-1:1778246833142";
    const workItem = {
      id: "work-1",
      summary: "Continue governed GUI workflow",
      status: "pending",
      workflowProfile: "ui-change",
      risk: "medium",
      triggers: ["ui", "verification-heavy"],
      surface: "gui",
      expectedEvidence: ["plan", "tests"],
      providedEvidence: ["visual-reference-research"],
      verificationGates: ["typecheck"],
      skippedVerificationGates: [],
      verificationGateResults: [],
      dependencies: [],
      pauseRequirements: [],
      executionAttempts: [],
      createdAt: "2026-05-08T00:00:02.000Z",
      updatedAt: "2026-05-08T00:00:02.000Z",
      sequence: 1,
    };
    const boundedWorkContractRevision = boundedWorkRevision("goal-1", ["work-1"], "Continue governed GUI workflow");
    const goal = {
      id: "goal-1",
      objective: "Continue governed GUI workflow",
      ownerSessionId: sessionId,
      planId: "plan-1",
      boundedWorkContractRevision,
      boundedWorkContractRevisionHistory: [boundedWorkContractRevision],
      status: "active",
      workItemIds: ["work-1"],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Resume governed GUI work.",
      },
      routePolicy: {
        workflowProfile: "ui-change",
      },
      evidenceRequirements: [],
      currentPhase: "planning",
      createdAt: "2026-05-08T00:00:02.000Z",
      updatedAt: "2026-05-08T00:00:02.000Z",
      sequence: 1,
    };
    await transcriptStore.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "interactive",
      startedAt: "2026-05-08T00:00:00.000Z",
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-1",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-05-08T00:00:01.000Z",
      kind: "user_message",
      source: { actor: "user", surface: "gui" },
      payload: {
        messageId: `${sessionId}:turn:1:user`,
        content: "start governed work",
        kind: "assistant_message",
        kilnSessionId: "spoofed-session",
        sequence: 99,
      },
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-2",
      kilnSessionId: sessionId,
      sequence: 2,
      timestamp: "2026-05-08T00:00:02.000Z",
      kind: "goal.created",
      source: { actor: "tool", surface: "gui" },
      payload: {
        goal,
      },
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-3",
      kilnSessionId: sessionId,
      sequence: 3,
      timestamp: "2026-05-08T00:00:03.000Z",
      kind: "work_item_updated",
      source: { actor: "tool", surface: "gui" },
      payload: {
        toolCallId: `${sessionId}:turn:1:tool:1`,
        operation: "update",
        workItem,
      },
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-4",
      kilnSessionId: sessionId,
      sequence: 4,
      timestamp: "2026-05-08T00:00:04.000Z",
      kind: "turn_completed",
      source: { actor: "runtime", surface: "gui" },
      payload: {
        turnId: `${sessionId}:turn:1`,
        outcome: "failed",
      },
    });

    const session = new RuntimeSession({
      appName: "kiln-gui",
      tenantId: "_gui",
      userId: "user-1",
      sessionId,
      systemPrompt: "test",
    });
    const workItemStore = new WorkItemStore();
    const goalRunStore = new GoalRunStore();
    const hydrate = createTranscriptRuntimeSessionHydrator({
      transcriptStore,
      workItemStore,
      goalRunStore,
    });
    const result = await hydrate({ sessionId, session });

    expect(result).toMatchObject({
      rehydrated: true,
      messageCount: 1,
      sourceSequence: 4,
    });
    expect(session.sessionEvents.map((event) => event.kind)).toEqual([
      "user_message",
      "goal.created",
      "work_item_updated",
      "turn_completed",
    ]);
    expect(session.sessionEvents[0]).toEqual(expect.objectContaining({
      kilnSessionId: sessionId,
      sequence: 1,
      kind: "user_message",
    }));
    expect(session.nextSessionEventSequence()).toBe(5);
    expect(session.sessionEvents[2]?.timestamp).toBeInstanceOf(Date);
    const expectedWorkItem = expect.objectContaining({
      id: "work-1",
      status: "pending",
      providedEvidence: ["visual-reference-research"],
    });
    expect(reconstructWorkItemsFromSessionEvents(session.sessionEvents).items).toEqual([
      expectedWorkItem,
    ]);
    expect(workItemStore.list("pending")).toEqual([
      expectedWorkItem,
    ]);
    expect(goalRunStore.get("goal-1")).toEqual(expect.objectContaining({
      id: "goal-1",
      status: "active",
      workItemIds: ["work-1"],
    }));
  });

  it("replays web freshness evidence without losing the canonical tool metadata", async () => {
    const sessionId = "kiln-gui:_gui:user-1:1784436323974";
    await transcriptStore.init(sessionId, {
      kilnSessionId: sessionId,
      provider: "codex-oauth",
      task: "interactive",
      startedAt: "2026-07-19T04:45:00.000Z",
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-web-start",
      kilnSessionId: sessionId,
      sequence: 1,
      timestamp: "2026-07-19T04:45:46.720Z",
      kind: "tool_call_started",
      source: { actor: "tool", surface: "gui" },
      payload: {
        toolCallId: `${sessionId}:turn:1:tool:1`,
        toolCallScopeId: `${sessionId}:turn:1:response:1`,
        toolName: "web_search",
      },
    });
    await transcriptStore.append(sessionId, {
      eventId: "evt-web-result",
      kilnSessionId: sessionId,
      sequence: 2,
      timestamp: "2026-07-19T04:45:46.721Z",
      kind: "tool_call_completed",
      source: { actor: "tool", surface: "gui" },
      payload: {
        turnId: `${sessionId}:turn:1`,
        toolCallId: `${sessionId}:turn:1:tool:1`,
        toolCallScopeId: `${sessionId}:turn:1:response:1`,
        toolName: "web_search",
        status: "succeeded",
        outputSummary: "Found 1 source",
        metadata: {
          toolName: "web_search",
          kind: "web",
          operation: "search",
          provider: "tavily",
          freshnessRequired: true,
          freshnessEnforcement: "enforced",
          temporalRequirement: {
            exactLocalDate: "2026-07-18",
            requiredIdentityTerms: ["guadalajara", "toluca"],
            eventStatus: "completed",
            minimumIndependentSources: 2,
          },
          temporalEvidence: {
            accepted: true,
            acceptedSourceIds: ["https://example.com/match", "https://second.example/match"],
            rejectedSourceIds: [],
          },
          retrievedAt: "2026-07-19T04:45:46.720Z",
          sources: [{
            title: "Match result",
            url: "https://example.com/match",
            publishedAt: "2026-07-18T23:00:00.000Z",
          }],
        },
      },
    });

    const session = new RuntimeSession({
      appName: "kiln-gui",
      tenantId: "_gui",
      userId: "user-1",
      sessionId,
      systemPrompt: "test",
    });
    const hydrate = createTranscriptRuntimeSessionHydrator({ transcriptStore });
    await hydrate({ sessionId, session });

    const replayed = session.sessionEvents.find((event) => event.kind === "tool_call_completed");
    expect(replayed).toBeDefined();
    expect(replayed).toMatchObject({
      metadata: {
        freshnessRequired: true,
        freshnessEnforcement: "enforced",
        temporalEvidence: {
          accepted: true,
          acceptedSourceIds: ["https://example.com/match", "https://second.example/match"],
        },
        retrievedAt: "2026-07-19T04:45:46.720Z",
        sources: [{
          publishedAt: "2026-07-18T23:00:00.000Z",
        }],
      },
    });
  });
});

function boundedWorkRevision(goalId: string, workItemIds: readonly string[], objective: string) {
  return adoptBoundedWorkContractRevision({
    accountingLineageId: goalId,
    adoptedAt: "2026-05-08T00:00:02.000Z",
    adoptedBy: { kind: "operator", actorId: "test-operator", decisionId: `decision:${goalId}` },
    contract: {
      schema: "kiln.bounded-work-contract/v1",
      intent: { objective, acceptanceCriteria: ["focused tests pass"], nonGoals: [] },
      scope: { allowedWorkItemIds: workItemIds, permittedEffects: ["inspect", "modify_source", "run_verification"], permittedSurfaces: ["gui"], allowedRoots: ["packages/gui"], deniedRoots: [], refactorAuthority: "scoped", migrationAuthority: "none", dependencyAuthority: "none" },
      limits: { maxExecutionAttempts: 10, maxManagedInvocations: 10, maxConcurrentManagedInvocations: 3, maxChildDepth: 2, maxReviewRounds: 3, maxRemediationRounds: 3 },
      tripwires: {},
      policy: { scopeExpansion: "approval_required", budgetExhaustion: "pause", minimumHarnessCapability: "authoritative" },
    },
  });
}
