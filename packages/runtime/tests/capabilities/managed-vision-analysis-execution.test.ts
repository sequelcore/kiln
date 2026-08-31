import { describe, expect, it, vi } from "vitest";
import {
  defineStructuredExecutionResult,
  type StructuredExecutionResult,
} from "@kilnai/core";
import {
  createManagedVisionAnalysisCapabilityExecutor,
} from "../../src/capabilities/managed-vision-analysis-execution.js";
import type { PortableInvocationBinding } from "../../src/capabilities/portable-execution.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { EffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import type {
  RuntimeBuiltinToolExecutionContext,
  RuntimeBuiltinToolExecutor,
} from "../../src/session/runtime-session-orchestrator.types.js";

const RESOURCE_URI = "kiln://session/image-1";
const OTHER_RESOURCE_URI = "kiln://session/image-2";
const EXTERNAL_RUNTIME_ATTACHMENT = Object.freeze({
  kind: "external-runtime" as const,
  runtimeId: "remote-vision-runtime",
  attachmentId: "remote-vision-attachment-1",
});

function authorityAdmission(): EffectiveAuthorityAdmissionBundle {
  return Object.freeze({ admissionId: "sha256:vision-parent" }) as unknown as EffectiveAuthorityAdmissionBundle;
}

function context(bundle = authorityAdmission()): RuntimeBuiltinToolExecutionContext {
  const session = new RuntimeSession({
    appName: "runtime-test",
    tenantId: "tenant-test",
    userId: "user-test",
    systemPrompt: "Parent",
    sessionId: "session-vision",
  });
  return {
    session,
    turnId: "session-vision:turn:1",
    toolCall: {
      id: "vision-call",
      name: "vision_analyze",
      input: { resourceUris: [RESOURCE_URI], instruction: "Describe the image." },
    },
    authorityAdmission: bundle,
  };
}

function input(
  trustedContext: RuntimeBuiltinToolExecutionContext | undefined,
  overrides: Record<string, unknown> = {},
) {
  return {
    binding: {} as PortableInvocationBinding,
    input: {
      resourceUris: [RESOURCE_URI],
      instruction: "Describe the image.",
      ...overrides,
    },
    signal: new AbortController().signal,
    timeoutMs: 10_000,
    trustedContext,
    onOutput: vi.fn(),
  };
}

function structuredResult(overrides: Partial<StructuredExecutionResult> = {}): StructuredExecutionResult {
  return defineStructuredExecutionResult({
    version: "structured-execution-result-v1",
    status: "completed",
    summary: "The image contains a bounded fixture subject.",
    uncertainty: 0.2,
    limitations: [],
    operatorDecisions: [],
    evidence: [{ uri: RESOURCE_URI, kind: "artifact" }],
    citations: [],
    warnings: [],
    failures: [],
    approvalRequirements: [],
    residualRisks: [],
    verificationResults: [],
    ...overrides,
  });
}

function completedResult(result: StructuredExecutionResult): Record<string, unknown> {
  return {
    output: JSON.stringify({ status: "completed" }),
    isError: false,
    metadata: {
      toolName: "managed_agent.invoke",
      kind: "managed-invocation",
      status: "completed",
      lifecycleState: "completed",
      resultHandoff: { structuredResult: result },
    },
  };
}

function executorWith(result: unknown): RuntimeBuiltinToolExecutor {
  return vi.fn<RuntimeBuiltinToolExecutor>(async () => result);
}

describe("ManagedVisionAnalysisCapabilityExecutor", () => {
  it("builds a read-only resources request through the existing managed executor and preserves parent authority", async () => {
    let receivedInput: Record<string, unknown> | undefined;
    let receivedContext: RuntimeBuiltinToolExecutionContext | undefined;
    const managedInvocationExecutor = vi.fn<RuntimeBuiltinToolExecutor>(async (request, childContext) => {
      receivedInput = request;
      receivedContext = childContext;
      childContext?.emitOutput?.({ stream: "stdout", delta: "progress" });
      return completedResult(structuredResult());
    });
    const onOutput = vi.fn();
    const parentContext = context();
    const child = createManagedVisionAnalysisCapabilityExecutor({
      managedInvocationExecutor,
      agentProfile: "vision-specialist",
      routeId: "managed-vision-route",
      providerRoute: { providerId: "vision-provider", model: "vision-model" },
      externalRuntimeAttachment: EXTERNAL_RUNTIME_ATTACHMENT,
    });

    const result = await child.execute({ ...input(parentContext), onOutput });

    expect(result).toEqual({
      status: "completed",
      output: {
        status: "completed",
        summary: "The image contains a bounded fixture subject.",
        uncertainty: 0.2,
        limitations: [],
        evidenceUris: [RESOURCE_URI],
      },
    });
    expect(receivedInput).toMatchObject({
      profile: "foundation-readonly-plan",
      routeId: "managed-vision-route",
      providerRoute: { providerId: "vision-provider", model: "vision-model" },
      requestedAuthority: "read_only",
      task: "Describe the image.",
      resourceUris: [RESOURCE_URI],
      agentProfile: "vision-specialist",
      contextMode: "resources",
      requiredResultFields: ["summary", "evidence", "uncertainty", "limitations"],
    });
    expect(receivedInput?.externalRuntimeAttachment).toEqual({
      runtimeId: EXTERNAL_RUNTIME_ATTACHMENT.runtimeId,
      attachmentId: EXTERNAL_RUNTIME_ATTACHMENT.attachmentId,
    });
    expect(receivedInput?.externalRuntimeAttachment).not.toHaveProperty("kind");
    expect(receivedContext?.authorityAdmission).toBe(parentContext.authorityAdmission);
    expect(onOutput).toHaveBeenCalledWith({ stream: "stdout", text: "progress" });
    expect(managedInvocationExecutor).toHaveBeenCalledTimes(1);
  });

  it("requires an exact trusted parent context before dispatch", async () => {
    const managedInvocationExecutor = executorWith(completedResult(structuredResult()));
    const child = createManagedVisionAnalysisCapabilityExecutor({
      managedInvocationExecutor,
      agentProfile: "vision-specialist",
      routeId: "managed-vision-route",
      providerRoute: { providerId: "vision-provider" },
    });

    const result = await child.execute(input(undefined));

    expect(result).toEqual({ status: "failed", diagnosticCode: "missing_context" });
    expect(managedInvocationExecutor).not.toHaveBeenCalled();
  });

  it("does not dispatch when the parent or capability signal is already cancelled", async () => {
    const managedInvocationExecutor = executorWith(completedResult(structuredResult()));
    const child = createManagedVisionAnalysisCapabilityExecutor({
      managedInvocationExecutor,
      agentProfile: "vision-specialist",
      routeId: "managed-vision-route",
      providerRoute: { providerId: "vision-provider" },
    });
    const capabilityController = new AbortController();
    capabilityController.abort();

    await expect(child.execute({ ...input(context()), signal: capabilityController.signal })).resolves.toEqual({
      status: "cancelled",
      diagnosticCode: "cancelled",
    });
    expect(managedInvocationExecutor).not.toHaveBeenCalled();

    const parentController = new AbortController();
    parentController.abort();
    await expect(child.execute(input({ ...context(), abortSignal: parentController.signal }))).resolves.toEqual({
      status: "cancelled",
      diagnosticCode: "cancelled",
    });
    expect(managedInvocationExecutor).not.toHaveBeenCalled();
  });

  it.each([
    ["denied", { status: "failed", diagnosticCode: "unavailable" }],
    ["failed", { status: "failed", diagnosticCode: "agent_execution_error" }],
    ["cancelled", { status: "cancelled", diagnosticCode: "cancelled" }],
    ["timed_out", { status: "timed_out", diagnosticCode: "timed_out" }],
    ["unknown", { status: "outcome-unknown", diagnosticCode: "agent_outcome_unknown" }],
  ] as const)("maps managed terminal status %s conservatively", async (status, expected) => {
    const managedInvocationExecutor = executorWith({
      output: JSON.stringify({ status }),
      isError: true,
      metadata: { kind: "managed-invocation", status },
    });
    const child = createManagedVisionAnalysisCapabilityExecutor({
      managedInvocationExecutor,
      agentProfile: "vision-specialist",
      routeId: "managed-vision-route",
      providerRoute: { providerId: "vision-provider" },
    });

    await expect(child.execute(input(context()))).resolves.toEqual(expected);
  });

  it("rejects a completed handoff without terminal structured fields or with out-of-scope evidence", async () => {
    const missingStructured = createManagedVisionAnalysisCapabilityExecutor({
      managedInvocationExecutor: executorWith({
        isError: false,
        metadata: { kind: "managed-invocation", status: "completed", resultHandoff: {} },
      }),
      agentProfile: "vision-specialist",
      routeId: "managed-vision-route",
      providerRoute: { providerId: "vision-provider" },
    });
    await expect(missingStructured.execute(input(context()))).resolves.toEqual({
      status: "failed",
      diagnosticCode: "invalid_output",
    });

    const outOfScope = createManagedVisionAnalysisCapabilityExecutor({
      managedInvocationExecutor: executorWith(completedResult(structuredResult({
        evidence: [{ uri: OTHER_RESOURCE_URI, kind: "artifact" }],
      }))),
      agentProfile: "vision-specialist",
      routeId: "managed-vision-route",
      providerRoute: { providerId: "vision-provider" },
    });
    await expect(outOfScope.execute(input(context()))).resolves.toEqual({
      status: "failed",
      diagnosticCode: "invalid_output",
    });
  });
});
