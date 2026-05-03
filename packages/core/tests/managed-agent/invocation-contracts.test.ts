import { describe, expect, it } from "vitest";
import {
  defineManagedAgentInvocationRequest,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentInvocationRecord,
} from "../../src/agents/managed-invocation/index.js";
import type {
  ManagedAgentInvocationRequest,
  ManagedAgentInvocationRecord,
  ManagedAgentUsageReport,
} from "../../src/agents/managed-invocation/index.js";

function makeRequest(): ManagedAgentInvocationRequest {
  return {
    invocationId: "invocation-1",
    agentId: "agent-reviewer",
    parentSessionId: "session-parent",
    parentTurnId: "turn-parent",
    profile: "foundation-readonly-plan",
    requestedBy: "operator",
    requestSource: "manual",
    providerRoute: {
      providerId: "codex-oauth",
      surface: "cli-harness",
      model: "gpt-5.4",
    },
    adapterKind: "harness",
    executionMode: "cli-harness",
    authority: {
      authorityProfileId: "foundation-readonly",
      permissionProfile: "read-only",
      toolAuthority: {
        allowedToolNames: ["read", "rg"],
        writeAllowed: false,
        networkAllowed: false,
      },
      workingDirectory: {
        path: "C:/Proyectos/Sequel/kiln",
        mode: "read-only",
      },
      timeoutMs: 120000,
      credentialRoute: {
        mode: "runtime-selected",
        routeId: "credential-route:codex-oauth:primary",
      },
      memoryScope: {
        scope: { kind: "project", id: "kiln" },
        access: "read-only",
      },
    },
    input: {
      summary: "Review the managed invocation contract",
      prompt: "Inspect the planned contract without writing files.",
    },
  };
}

describe("managed agent invocation contracts", () => {
  it("defines the foundation request with explicit route, authority, credential, memory, timeout, and lineage", () => {
    const request = defineManagedAgentInvocationRequest(makeRequest());

    expect(request).toMatchObject({
      invocationId: "invocation-1",
      agentId: "agent-reviewer",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      profile: "foundation-readonly-plan",
      providerRoute: {
        providerId: "codex-oauth",
        surface: "cli-harness",
        model: "gpt-5.4",
      },
      adapterKind: "harness",
      executionMode: "cli-harness",
      authority: {
        authorityProfileId: "foundation-readonly",
        permissionProfile: "read-only",
        toolAuthority: {
          allowedToolNames: ["read", "rg"],
          writeAllowed: false,
          networkAllowed: false,
        },
        workingDirectory: {
          path: "C:/Proyectos/Sequel/kiln",
          mode: "read-only",
        },
        timeoutMs: 120000,
        credentialRoute: {
          mode: "runtime-selected",
          routeId: "credential-route:codex-oauth:primary",
        },
        memoryScope: {
          scope: { kind: "project", id: "kiln" },
          access: "read-only",
        },
      },
    });
  });

  it("defines adapter descriptors without provider-native vocabulary leaking into the core contract", () => {
    const descriptor = defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: "adapter:codex-oauth:cli",
      providerId: "codex-oauth",
      adapterKind: "harness",
      supportedProfiles: ["foundation-readonly-plan"],
      supportedExecutionModes: ["cli-harness"],
      lifecycle: {
        exposesStart: true,
        exposesTerminal: true,
        exposesCleanup: true,
      },
      cancellation: { supported: true },
      timeout: { supported: true, diagnosticArtifactOnTimeout: true },
      transcript: {
        supported: true,
        redactionKnown: true,
        truncationKnown: true,
        persistenceKnown: true,
        retentionKnown: true,
      },
      usage: {
        supported: true,
        preservesProviderTokenClasses: true,
        supportsExplicitUnknowns: true,
      },
      resultHandoff: {
        boundedSummary: true,
        resourcePointers: true,
      },
      credentialRoute: { supported: true },
      memoryContext: { governedAdmission: true },
      unsupportedFieldPolicy: "reject",
      cleanup: { supported: true },
    });

    expect(descriptor.adapterKind).toBe("harness");
    expect(descriptor.supportedProfiles).toEqual(["foundation-readonly-plan"]);
    expect(JSON.stringify(descriptor)).not.toMatch(/\bsubagent\b|\bteam\b|\bfork\b/);
  });

  it("records replayable lifecycle evidence, transcript flags, usage unknowns, and bounded result handoff", () => {
    const usage: ManagedAgentUsageReport = {
      source: "adapter",
      tokenClasses: [
        { name: "input_tokens", value: 120 },
        { name: "output_tokens", value: 45 },
        { name: "cached_tokens", value: "unknown" },
      ],
      cost: { currency: "USD", amount: "unknown" },
    };

    const record: ManagedAgentInvocationRecord = defineManagedAgentInvocationRecord({
      invocationId: "invocation-1",
      agentId: "agent-reviewer",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      profile: "foundation-readonly-plan",
      lifecycleState: "completed",
      providerRoute: makeRequest().providerRoute,
      adapterKind: "harness",
      executionMode: "cli-harness",
      authority: makeRequest().authority,
      childSessionId: "child-session-1",
      transcript: {
        uri: "kiln://artifacts/invocation-1/transcript",
        redacted: true,
        truncated: false,
        persisted: true,
        retention: "session",
      },
      diagnostics: [{
        uri: "kiln://artifacts/invocation-1/diagnostics",
        kind: "timeout",
      }],
      usage,
      resultHandoff: {
        summary: "No file writes were needed.",
        resourceUris: ["kiln://artifacts/invocation-1/result"],
        memoryWriteProposalUris: [],
      },
    });

    expect(record.lifecycleState).toBe("completed");
    expect(record.transcript?.redacted).toBe(true);
    expect(record.usage?.tokenClasses[2]).toEqual({ name: "cached_tokens", value: "unknown" });
    expect(record.resultHandoff?.summary).toBe("No file writes were needed.");
  });
});
