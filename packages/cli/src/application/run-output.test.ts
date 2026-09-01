import { describe, expect, it } from "vitest";
import {
  buildRunJsonOutputEnvelope,
  computeDelegationCapabilityGap,
  extractModelClassifiedTriggers,
  computeManagedInvocationAuthorityNotes,
} from "./run-output.js";
import type { RunSessionTranscriptEvent } from "./run-session.js";

const base = {
  answer: "done",
  sessionId: "session-1",
  task: "test",
  domain: "default",
  sessionSucceeded: true,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolCallCount: 0,
  turnDepth: 1,
  startedAt: "2026-07-12T00:00:00.000Z",
  completedAt: "2026-07-12T00:00:01.000Z",
  durationMs: 1_000,
  lastError: null,
  attempts: [],
  exactArtifacts: [],
} as const;

describe("buildRunJsonOutputEnvelope", () => {
  it("keeps the existing JSON shape when context evidence is absent", () => {
    expect(buildRunJsonOutputEnvelope(base).telemetry).not.toHaveProperty("contextUsage");
  });

  it("preserves the shared projection without reinterpreting it", () => {
    const contextUsage = {
      state: "partial" as const,
      usedTokens: 12_000,
      contextWindowTokens: 128_000,
      remainingTokens: 116_000,
      usedPercentage: 9.375,
      providerId: "codex-oauth",
      modelId: "gpt-5.6-terra",
      turnId: "turn-1",
      observedAt: "2026-07-12T00:00:01.000Z",
      measurement: "provider_reported" as const,
      lifecycle: "completed" as const,
      contextWindowAuthority: "runtime_observed" as const,
      freshness: "fresh" as const,
    };

    expect(buildRunJsonOutputEnvelope({ ...base, contextUsage }).telemetry.contextUsage).toEqual(contextUsage);
  });

  it("emits the canonical efficiency view beside outcome telemetry", () => {
    const efficiencyEvidence = efficiencyFixture();
    expect(buildRunJsonOutputEnvelope({ ...base, efficiencyEvidence }).telemetry.efficiencyEvidence).toEqual(
      efficiencyEvidence,
    );
  });

  it("includes a capabilityGap record in diagnostics when supplied", () => {
    const gap = {
      kind: "capability_pause" as const,
      reason: "delegation-surface-unavailable" as const,
      matchedTriggers: ["architecture", "cross-surface"],
      posture: "orchestrate" as const,
      message: "Work governance requires delegation.",
    };
    const envelope = buildRunJsonOutputEnvelope({ ...base, capabilityGap: gap });
    expect(envelope.diagnostics.capabilityGap).toEqual(gap);
    // sessionSucceeded is unchanged — the gap records governance status, not session status
    expect(envelope.telemetry.sessionSucceeded).toBe(true);
  });

  it("emits canonical content-free provider-request observations without reinterpretation", () => {
    const providerRequests = [{
      version: "v1",
      requestIndex: 0,
      providerId: "codex-oauth",
      modelId: "gpt-5.6-luna",
      deliberation: { state: "observed", status: "exact", selectedLevel: "low" },
      authority: {
        state: "observed",
        requestedAuthority: "read_only",
        admittedAuthority: "read_only",
        completeness: "authoritative",
      },
      dispatch: {
        attempt: { state: "observed", value: 1 },
        retry: { state: "observed", value: false },
        fallback: { state: "unknown" },
        outcome: "completed",
      },
      usage: {
        input: { tokens: 10, measurement: "provider_reported" },
        output: { tokens: 2, measurement: "provider_reported" },
        cacheRead: { tokens: 0, measurement: "provider_reported" },
        cacheWrite: { tokens: 0, measurement: "provider_reported" },
      },
      physicalRegions: [],
      reconciliation: {
        state: "unknown",
        providerInputTokens: 10,
        reason: "regional_token_attribution_unavailable",
      },
      capacity: {
        state: "capacity_unknown",
        contextWindowAuthority: "unknown",
        reason: "context_capacity_unavailable",
      },
      cache: {
        partitionIdentity: { state: "unknown" },
        regions: [],
        readTokens: 0,
        writeTokens: 0,
        measurement: "provider_reported",
      },
      toolCount: 0,
    }] as const;

    const envelope = buildRunJsonOutputEnvelope({ ...base, providerRequests });
    expect(envelope.telemetry.providerRequests).toBe(providerRequests);
    expect(JSON.stringify(envelope.telemetry.providerRequests)).not.toContain("Hash");
  });

  it("exposes canonical communication evidence in JSON diagnostics without recomputing it", () => {
    const communicationResolution = {
      version: "v1",
      responseDetail: { status: "exact", mechanism: "native" },
      interactionProfile: { status: "defaulted", mechanism: "default" },
      semanticLoss: [],
      identity: "sha256:test",
    } as Parameters<typeof buildRunJsonOutputEnvelope>[0]["communicationResolution"];
    expect(buildRunJsonOutputEnvelope({ ...base, communicationResolution }).diagnostics.communicationResolution)
      .toBe(communicationResolution);
  });

  it("exposes standalone final-prompt evidence in JSON diagnostics without raw prompt text", () => {
    const effectivePromptObservation = {
      evidenceIdentity: "sha256:observation",
    } as Parameters<typeof buildRunJsonOutputEnvelope>[0]["effectivePromptObservation"];
    const diagnostics = buildRunJsonOutputEnvelope({ ...base, effectivePromptObservation }).diagnostics;
    expect(diagnostics.effectivePromptObservation).toBe(effectivePromptObservation);
    expect(JSON.stringify(diagnostics)).not.toContain("rawPrompt");
  });

  it("omits capabilityGap from diagnostics when not supplied (backward-compat)", () => {
    const envelope = buildRunJsonOutputEnvelope(base);
    expect(envelope.diagnostics).not.toHaveProperty("capabilityGap");
    expect(envelope.diagnostics).toEqual({
      lastError: null,
      attempts: [],
    });
  });
});

describe("computeDelegationCapabilityGap", () => {
  it("returns a gap record when posture is orchestrate, triggers are non-empty, and surface is unavailable", () => {
    const gap = computeDelegationCapabilityGap({
      defaultPosture: "orchestrate",
      requireDelegationFor: ["architecture"],
      managedInvocationAvailable: false,
    });
    expect(gap).toBeDefined();
    expect(gap!.kind).toBe("capability_pause");
    expect(gap!.reason).toBe("delegation-surface-unavailable");
    expect(gap!.matchedTriggers).toEqual(["architecture"]);
    expect(gap!.posture).toBe("orchestrate");
    expect(gap!.message).toContain("architecture");
    expect(gap!.message).toContain("managed invocation surface");
  });

  it("returns a gap record with all configured triggers when multiple are present (absent surface)", () => {
    const gap = computeDelegationCapabilityGap({
      defaultPosture: "orchestrate",
      requireDelegationFor: ["architecture", "cross-surface"],
      managedInvocationAvailable: false,
    });
    expect(gap).toBeDefined();
    expect(gap!.matchedTriggers).toEqual(["architecture", "cross-surface"]);
  });

  it("returns undefined when posture is direct regardless of triggers or surface", () => {
    expect(
      computeDelegationCapabilityGap({
        defaultPosture: "direct",
        requireDelegationFor: ["architecture"],
        managedInvocationAvailable: false,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when posture is direct even with classified triggers and child not dispatched", () => {
    expect(
      computeDelegationCapabilityGap({
        defaultPosture: "direct",
        requireDelegationFor: ["architecture"],
        managedInvocationAvailable: true,
        classifiedTriggers: ["architecture"],
        childDispatched: false,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when managed invocation is available and no classified triggers info (backward-compat)", () => {
    expect(
      computeDelegationCapabilityGap({
        defaultPosture: "orchestrate",
        requireDelegationFor: ["architecture"],
        managedInvocationAvailable: true,
      }),
    ).toBeUndefined();
  });

  it("returns a gap with reason delegation-required-but-not-dispatched when surface present, triggers intersect, no child dispatched", () => {
    const gap = computeDelegationCapabilityGap({
      defaultPosture: "orchestrate",
      requireDelegationFor: ["architecture", "ui"],
      managedInvocationAvailable: true,
      classifiedTriggers: ["architecture"],
      childDispatched: false,
    });
    expect(gap).toBeDefined();
    expect(gap!.reason).toBe("delegation-required-but-not-dispatched");
    expect(gap!.matchedTriggers).toEqual(["architecture"]);
    expect(gap!.message).toContain("no managed child was dispatched");
  });

  it("returns undefined when surface present, triggers intersect, and child WAS dispatched", () => {
    expect(
      computeDelegationCapabilityGap({
        defaultPosture: "orchestrate",
        requireDelegationFor: ["architecture"],
        managedInvocationAvailable: true,
        classifiedTriggers: ["architecture"],
        childDispatched: true,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when model classified NO delegation triggers (no false-positive on typo fix)", () => {
    expect(
      computeDelegationCapabilityGap({
        defaultPosture: "orchestrate",
        requireDelegationFor: ["architecture", "ui"],
        managedInvocationAvailable: true,
        classifiedTriggers: [],
        childDispatched: false,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when model classified only non-matching triggers (e.g. documentation not in requireDelegationFor)", () => {
    expect(
      computeDelegationCapabilityGap({
        defaultPosture: "orchestrate",
        requireDelegationFor: ["architecture"],
        managedInvocationAvailable: true,
        classifiedTriggers: ["security", "documentation"],
        childDispatched: false,
      }),
    ).toBeUndefined();
  });

  it("matchedTriggers is the INTERSECTION, not the full configured list", () => {
    const gap = computeDelegationCapabilityGap({
      defaultPosture: "orchestrate",
      requireDelegationFor: ["architecture", "ui"],
      managedInvocationAvailable: true,
      classifiedTriggers: ["architecture", "documentation"],
      childDispatched: false,
    });
    expect(gap).toBeDefined();
    // Only "architecture" intersects; "documentation" is model-classified but not configured;
    // "ui" is configured but not model-classified
    expect(gap!.matchedTriggers).toEqual(["architecture"]);
  });

  it("absent-surface gap still uses full configured list as matchedTriggers (no classification available)", () => {
    const gap = computeDelegationCapabilityGap({
      defaultPosture: "orchestrate",
      requireDelegationFor: ["architecture", "ui"],
      managedInvocationAvailable: false,
    });
    expect(gap).toBeDefined();
    expect(gap!.reason).toBe("delegation-surface-unavailable");
    expect(gap!.matchedTriggers).toEqual(["architecture", "ui"]);
  });

  it("returns undefined when requireDelegationFor is empty", () => {
    expect(
      computeDelegationCapabilityGap({
        defaultPosture: "orchestrate",
        requireDelegationFor: [],
        managedInvocationAvailable: false,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when requireDelegationFor is undefined", () => {
    expect(
      computeDelegationCapabilityGap({
        defaultPosture: "orchestrate",
        requireDelegationFor: undefined,
        managedInvocationAvailable: false,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when defaultPosture is undefined (treats as direct)", () => {
    expect(
      computeDelegationCapabilityGap({
        defaultPosture: undefined,
        requireDelegationFor: ["architecture"],
        managedInvocationAvailable: false,
      }),
    ).toBeUndefined();
  });
});

describe("extractModelClassifiedTriggers", () => {
  const toolUseEvent = (toolName: string, input: unknown): RunSessionTranscriptEvent => ({
    seq: 1,
    ts: "2026-01-01T00:00:00.000Z",
    event: {
      type: "tool_use",
      toolName,
      toolCallId: "call-1",
      toolCallScopeId: "turn-1:response:1",
      input,
    },
  });

  it("extracts triggers from a work_governance.assess tool_use input", () => {
    const events: RunSessionTranscriptEvent[] = [
      toolUseEvent("bash", { command: "ls" }),
      toolUseEvent("work_governance.assess", {
        summary: "architecture review",
        triggers: ["architecture", "cross-surface"],
      }),
      toolUseEvent("read", { filePath: "foo.ts" }),
    ];
    expect(extractModelClassifiedTriggers(events)).toEqual(["architecture", "cross-surface"]);
  });

  it("returns an empty array when no work_governance.assess call exists in the transcript", () => {
    const events: RunSessionTranscriptEvent[] = [
      toolUseEvent("bash", { command: "ls" }),
      toolUseEvent("read", { filePath: "foo.ts" }),
    ];
    expect(extractModelClassifiedTriggers(events)).toEqual([]);
  });

  it("returns empty array for empty transcript", () => {
    expect(extractModelClassifiedTriggers([])).toEqual([]);
  });

  it("returns the last work_governance.assess call's triggers when multiple exist", () => {
    const events: RunSessionTranscriptEvent[] = [
      toolUseEvent("work_governance.assess", {
        summary: "first assessment",
        triggers: ["architecture"],
      }),
      toolUseEvent("work_governance.assess", {
        summary: "second assessment",
        triggers: ["security", "runtime"],
      }),
    ];
    expect(extractModelClassifiedTriggers(events)).toEqual(["security", "runtime"]);
  });

  it("filters non-string entries from the triggers array", () => {
    const events: RunSessionTranscriptEvent[] = [
      toolUseEvent("work_governance.assess", {
        summary: "test",
        triggers: ["architecture", null, 42, "ui"],
      }),
    ];
    expect(extractModelClassifiedTriggers(events)).toEqual(["architecture", "ui"]);
  });

  it("returns empty array when triggers is not an array", () => {
    const events: RunSessionTranscriptEvent[] = [
      toolUseEvent("work_governance.assess", {
        summary: "test",
        triggers: "not-an-array",
      }),
    ];
    expect(extractModelClassifiedTriggers(events)).toEqual([]);
  });

  it("returns empty array when input is null", () => {
    const events: RunSessionTranscriptEvent[] = [
      toolUseEvent("work_governance.assess", null),
    ];
    expect(extractModelClassifiedTriggers(events)).toEqual([]);
  });

  it("returns empty array when tool_use has no input property", () => {
    const events: RunSessionTranscriptEvent[] = [{
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      event: {
        type: "tool_use",
        toolName: "work_governance.assess",
        toolCallId: "call-1",
        toolCallScopeId: "turn-1:response:1",
      },
    }];
    expect(extractModelClassifiedTriggers(events)).toEqual([]);
  });
});

describe("computeManagedInvocationAuthorityNotes", () => {
  it("emits a diagnostic note when run is read_only and managed invocation surface is attached", () => {
    const notes = computeManagedInvocationAuthorityNotes({
      requestedAuthority: "read_only",
      managedInvocationAvailable: true,
    });
    expect(notes).toBeDefined();
    expect(notes!.managedAgentCancelNote).toContain("managed_agent.cancel");
    expect(notes!.managedAgentCancelNote).toContain("read_only");
    expect(notes!.managedAgentCancelNote).toContain("destructive");
  });

  it("returns undefined when run is not read_only", () => {
    expect(computeManagedInvocationAuthorityNotes({
      requestedAuthority: "audited",
      managedInvocationAvailable: true,
    })).toBeUndefined();

    expect(computeManagedInvocationAuthorityNotes({
      requestedAuthority: "destructive",
      managedInvocationAvailable: true,
    })).toBeUndefined();

    expect(computeManagedInvocationAuthorityNotes({
      requestedAuthority: "auto",
      managedInvocationAvailable: true,
    })).toBeUndefined();
  });

  it("returns undefined when managed invocation surface is not attached (no diagnostic needed)", () => {
    expect(computeManagedInvocationAuthorityNotes({
      requestedAuthority: "read_only",
      managedInvocationAvailable: false,
    })).toBeUndefined();
  });

  it("returns undefined when requestedAuthority is undefined", () => {
    expect(computeManagedInvocationAuthorityNotes({
      requestedAuthority: undefined,
      managedInvocationAvailable: true,
    })).toBeUndefined();
  });
});

function efficiencyFixture() {
  return {
    schemaVersion: "verified-efficiency-evidence-v1" as const,
    sessionId: "session-1",
    observedAt: "2026-07-12T00:00:01.000Z",
    provider: { providerId: "codex-oauth", modelId: "gpt-5.6-terra", billingMode: "subscription" },
    policy: {
      owner: "ContextGovernor",
      policyId: "context-whole-block-static-v1",
      configurationHash: `sha256:${"a".repeat(64)}`,
    },
    totals: {
      providerTotalTokens: 10,
      providerTotalCostUsd: 0,
      measured: { tokens: 2, costUsd: 0 },
      estimated: { tokens: 0, costUsd: 0 },
      cached: { tokens: 3, costUsd: 0 },
      unknown: { tokens: 5, costUsd: 0 },
      cacheWritten: { tokens: 0, costUsd: 0 },
      avoided: { tokens: 0, costUsd: 0 },
    },
    outcome: "succeeded" as const,
    verification: { status: "not_run" as const, results: [] },
    actions: [],
    savings: [],
    evidenceUris: [],
  };
}
