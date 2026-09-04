import { describe, expect, it } from "vitest";
import type { ProviderRequestEvidence } from "@kilnai/core/events";
import { canonicalTurnDisposition, projectCanonicalTurnForTest } from "./canonical-turn-fixture.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { toOperatorSessionEventFrame } from "../../src/gateway/operator-session-event-frame.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

const providerRequest: ProviderRequestEvidence = {
  requestIndex: 0,
  providerId: "codex-oauth",
  modelId: "gpt-5.6-sol",
  deliberation: { status: "exact", selectedLevel: "high" },
  authority: {
    requestedAuthority: "read_only",
    admittedAuthority: "read_only",
    completeness: "authoritative",
  },
  inputTokens: 3,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cumulativeInputTokens: 3,
  cumulativeOutputTokens: 2,
  cumulativeCacheReadTokens: 0,
  cumulativeCacheWriteTokens: 0,
  systemBytes: 3,
  messageBytes: 2,
  toolSchemaBytes: 0,
  tokenAttributionEstimate: {
    measurement: "estimated",
    requiredPromptTokens: 1,
    governedContextTokens: 0,
    toolSchemaTokens: 0,
    conversationTokens: 2,
    toolResultTokens: 0,
    totalInputTokens: 3,
  },
  outputReserveTokens: 1_024,
  physicalAttempts: [
    { attempt: 1, retry: false, outcome: "response_received", responseStatus: 401 },
    { attempt: 2, retry: true, outcome: "completed", responseStatus: 200 },
  ],
  systemHash: hash("1"),
  messageHash: hash("2"),
  toolSchemaHash: hash("3"),
  stablePrefixHash: hash("4"),
  stablePrefixBytes: 3,
  stablePrefixRegionCount: 1,
  volatileRegionBytes: 2,
  cacheRegions: [],
  cachePartition: { hash: hash("cache-partition"), dimensions: [] },
  toolCount: 0,
  effectivePrompt: {
    version: "v1",
    components: [{
      id: hash("5"),
      revision: hash("6"),
      scope: "static",
      estimatedTokens: 3,
      provenance: { source: hash("7") },
    }],
    finalPromptHash: hash("8"),
    estimatedTokens: 3,
  },
};

describe("runtime final effective prompt observation", () => {
  it("persists failed physical attempts with unknown provider usage", async () => {
    const session = new RuntimeSession({ appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "test" });
    const failedRequest: ProviderRequestEvidence = {
      ...providerRequest,
      providerResponseObserved: false,
      inputTokens: 0,
      outputTokens: 0,
      physicalAttempts: [{ attempt: 1, retry: false, outcome: "failed", failurePhase: "transport" }],
    };
    const events = await projectCanonicalTurnForTest({
      session,
      channel: "gui",
      userMessageContent: "Private user message.",
      queued: false,
      disposition: { outcome: "failed", dispositionReason: "runtime_failure" },
      turnStartedAt: new Date("2026-08-13T00:00:00.000Z"),
      turnCompletedAt: new Date("2026-08-13T00:00:01.000Z"),
      continuity: { strategy: "none" },
      providerRequests: [failedRequest],
      runtimeEvents: [{
        type: "cost_update",
        sessionId: session.id,
        timestamp: new Date("2026-08-13T00:00:00.500Z"),
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCostUsd: 0,
        byRoleModel: {},
        providerRequests: [failedRequest],
      }],
    });

    const observed = events.filter((event) => event.kind === "provider_request_observed");
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      kind: "provider_request_observed",
      request: expect.objectContaining({
          dispatch: expect.objectContaining({
            attempt: { state: "observed", value: 1 },
            outcome: "failed",
            failurePhase: "transport",
          }),
          usage: expect.objectContaining({ input: { measurement: "unknown" } }),
          reconciliation: { state: "unknown", reason: "provider_usage_unavailable" },
      }),
    });
  });

  it("persists one content-free observation for every physical provider request", async () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Private system prompt.",
    });

    const events = await projectCanonicalTurnForTest({
      session,
      channel: "gui",
      userMessageContent: "Private user message.",
      assistantMessageContent: "Done.",
      queued: false,
      disposition: canonicalTurnDisposition("completed"),
      turnStartedAt: new Date("2026-08-13T00:00:00.000Z"),
      turnCompletedAt: new Date("2026-08-13T00:00:01.000Z"),
      continuity: { strategy: "none" },
      runtimeEvents: [],
      executionRouteId: "codex-primary",
      contextUsage: {
        state: "partial",
        usedTokens: 3,
        contextWindowTokens: 272_000,
        remainingTokens: 271_997,
        usedPercentage: 3 / 272_000 * 100,
        providerId: "codex-oauth",
        modelId: "gpt-5.6-sol",
        turnId: `${session.id}:turn:1`,
        observedAt: "2026-08-13T00:00:01.000Z",
        measurement: "provider_reported",
        lifecycle: "completed",
        contextWindowAuthority: "runtime_observed",
        freshness: "fresh",
      },
      providerRequests: [providerRequest],
    });

    const observed = events.filter((event) => event.kind === "provider_request_observed");
    expect(observed).toHaveLength(2);
    expect(observed[0]).toMatchObject({
      request: {
        dispatch: {
          attempt: { state: "observed", value: 1 },
          retry: { state: "observed", value: false },
          outcome: "response_received",
          responseStatus: 401,
        },
        usage: {
          input: { measurement: "unknown" },
          output: { measurement: "unknown" },
        },
        reconciliation: { state: "unknown", reason: "provider_usage_unavailable" },
      },
    });
    expect(observed[1]).toMatchObject({
      request: {
        version: "v1",
        requestIndex: 0,
        providerId: "codex-oauth",
        modelId: "gpt-5.6-sol",
        routeId: "codex-primary",
        deliberation: { state: "observed", status: "exact", selectedLevel: "high" },
        authority: {
          state: "observed",
          requestedAuthority: "read_only",
          admittedAuthority: "read_only",
          completeness: "authoritative",
        },
        dispatch: {
          attempt: { state: "observed", value: 2 },
          retry: { state: "observed", value: true },
          fallback: { state: "unknown" },
          outcome: "completed",
          responseStatus: 200,
        },
        usage: {
          input: { tokens: 3, measurement: "provider_reported" },
          output: { tokens: 2, measurement: "provider_reported" },
          cacheRead: { tokens: 0, measurement: "provider_reported" },
          cacheWrite: { tokens: 0, measurement: "provider_reported" },
        },
        physicalRegions: [
          { source: "system", bytes: 3, measurement: "measured" },
          { source: "messages", bytes: 2, measurement: "measured" },
          { source: "tool_schema", bytes: 0, measurement: "measured" },
        ],
        regionalTokenAttribution: [
          { source: "required_prompt", tokens: 1, measurement: "estimated" },
          { source: "governed_context", tokens: 0, measurement: "estimated" },
          { source: "tool_schema", tokens: 0, measurement: "estimated" },
          { source: "conversation", tokens: 2, measurement: "estimated" },
          { source: "tool_result", tokens: 0, measurement: "estimated" },
        ],
        reconciliation: {
          state: "estimated",
          providerInputTokens: 3,
          attributedInputTokens: 3,
          unresolvedRemainderTokens: 0,
          reason: "provider_total_not_regionally_measured",
        },
        capacity: {
          state: "within_capacity",
          measurement: "estimated",
          contextWindowTokens: 272_000,
          contextWindowAuthority: "runtime_observed",
          estimatedInputTokens: 3,
          outputReserveTokens: 1_024,
          estimatedTotalTokens: 1_027,
          estimatedRemainingTokens: 270_973,
          overflow: false,
        },
      },
    });
    expect(events.findIndex((event) => event.kind === "provider_request_observed"))
      .toBeLessThan(events.findIndex((event) => event.kind === "turn_completed"));
    const serialized = JSON.stringify(observed);
    expect(serialized).not.toContain("Private");
    expect(serialized).not.toContain(providerRequest.systemHash);
    expect(serialized).not.toContain(providerRequest.messageHash);
    expect(serialized).not.toContain(providerRequest.effectivePrompt?.finalPromptHash);
  });

  it("does not append the legacy final-only prompt hash observation", async () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Private system prompt.",
    });

    const events = await projectCanonicalTurnForTest({
      session,
      channel: "gui",
      userMessageContent: "Private user message.",
      assistantMessageContent: "Done.",
      queued: false,
      disposition: canonicalTurnDisposition("completed"),
      turnStartedAt: new Date("2026-08-13T00:00:00.000Z"),
      turnCompletedAt: new Date("2026-08-13T00:00:01.000Z"),
      continuity: { strategy: "none" },
      runtimeEvents: [],
      providerRequests: [providerRequest],
    });

    expect(events.filter((event) => event.kind === "effective_prompt_observed")).toHaveLength(0);
    const [observed] = events.filter((event) => event.kind === "provider_request_observed");
    expect(observed).toBeDefined();
    const frame = toOperatorSessionEventFrame(observed!, { eventId: "wire-1", sequence: 1 });
    expect(frame.event.payload.request).toMatchObject({
      requestIndex: 0,
      providerId: "codex-oauth",
      modelId: "gpt-5.6-sol",
      effectivePrompt: { estimatedTokens: 3, componentCount: 1 },
    });
    expect(JSON.stringify(frame)).not.toContain(hash("8"));
  });
});
