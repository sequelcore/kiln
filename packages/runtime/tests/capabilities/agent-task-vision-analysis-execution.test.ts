import { describe, expect, it, vi } from "vitest";
import {
  digestManagedEconomicValue,
  type ManagedAgentCallerAttachmentIdentity,
} from "@kilnai/core";
import {
  parseVisionAnalyzeInput,
  type VisionAnalysis,
} from "@kilnai/core/capabilities";
import {
  createAgentTaskVisionAnalysisCapabilityExecutor,
  type AgentTaskCapabilityService,
} from "../../src/capabilities/agent-task-vision-analysis-execution.js";
import type { PortableInvocationBinding } from "../../src/capabilities/portable-execution.js";
import type {
  AgentTaskRecord,
  AgentTaskResultQuery,
  AgentTaskSubmission,
} from "../../src/agent-tasks/contracts.js";
import type { EffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { RuntimeBuiltinToolExecutionContext } from "../../src/session/runtime-session-orchestrator.types.js";

const RESOURCE_URI = "kiln://session/image-1";
const OTHER_RESOURCE_URI = "kiln://session/image-2";
const PROFILE_ID = "luna";
const CALLER_ID = "operator-session:test";
const VISION_INPUT = Object.freeze({
  resourceUris: Object.freeze([RESOURCE_URI]),
  instruction: "Describe the image.",
});
const VISION_OUTPUT: VisionAnalysis = Object.freeze({
  status: "completed",
  summary: "A bounded fixture subject is visible.",
  uncertainty: 0.2,
  limitations: Object.freeze([]),
  evidenceUris: Object.freeze([RESOURCE_URI]),
});

function authorityAdmission(): EffectiveAuthorityAdmissionBundle {
  return Object.freeze({ admissionId: "sha256:vision-parent" }) as unknown as EffectiveAuthorityAdmissionBundle;
}

function context(overrides: Partial<RuntimeBuiltinToolExecutionContext> = {}): RuntimeBuiltinToolExecutionContext {
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
    toolCallScopeId: "scope-1",
    toolCall: {
      id: "call-1",
      name: "vision_analyze",
      input: VISION_INPUT,
    },
    authorityAdmission: authorityAdmission(),
    ...overrides,
  };
}

function binding(overrides: Partial<PortableInvocationBinding> = {}): PortableInvocationBinding {
  return {
    capabilityId: "vision.analyze",
    revision: "v1",
    toolName: "vision_analyze",
    toolCallScopeId: "scope-1",
    toolCallId: "call-1",
    ...overrides,
  } as PortableInvocationBinding;
}

function executionInput(
  trustedContext: RuntimeBuiltinToolExecutionContext | undefined = context(),
  signal = new AbortController().signal,
  input: Record<string, unknown> = { ...VISION_INPUT, resourceUris: [RESOURCE_URI] },
) {
  return {
    binding: binding(),
    input,
    signal,
    timeoutMs: 10_000,
    trustedContext,
    onOutput: vi.fn(),
  };
}

function acceptedJob(submission: AgentTaskSubmission, overrides: Partial<AgentTaskRecord> = {}): AgentTaskRecord {
  return {
    id: "job-vision-1",
    projectId: "project-test",
    callerId: submission.callerId,
    configuredAgentProfileId: submission.configuredAgentProfileId,
    state: "queued",
    capability: submission.capability,
    ...overrides,
  } as AgentTaskRecord;
}

function resultFor(job: AgentTaskRecord, overrides: Partial<AgentTaskResultQuery> = {}): AgentTaskResultQuery {
  return {
    jobId: job.id,
    availability: "available",
    lifecycleState: "succeeded",
    configuredAgentProfileId: job.configuredAgentProfileId,
    admissionProfileId: "foundation-readonly-plan",
    capability: job.capability,
    capabilityOutput: VISION_OUTPUT,
    ...overrides,
  };
}

function serviceFor(
  resultOverride?: Partial<AgentTaskResultQuery>,
): {
  readonly service: AgentTaskCapabilityService;
  readonly accepted: ReturnType<typeof acceptedJob>;
  readonly captureSubmission: (submission: AgentTaskSubmission) => void;
  readonly submission: AgentTaskSubmission | undefined;
} {
  let submitted: AgentTaskSubmission | undefined;
  const accepted = acceptedJob({
    objective: "Analyze the admitted image resources.",
    configuredAgentProfileId: PROFILE_ID,
    callerId: CALLER_ID,
    idempotencyKey: "unused",
    capability: {
      capabilityId: "vision.analyze",
      contract: "vision.analyze/v1",
      input: parseVisionAnalyzeInput(VISION_INPUT),
      inputDigest: digestManagedEconomicValue(parseVisionAnalyzeInput(VISION_INPUT)),
    },
  });
  const service: AgentTaskCapabilityService = {
    dispatch: vi.fn<AgentTaskCapabilityService["dispatch"]>(async () => accepted),
    getResult: vi.fn<AgentTaskCapabilityService["getResult"]>(async () => resultFor(accepted, resultOverride)),
    cancel: vi.fn<AgentTaskCapabilityService["cancel"]>(async () => ({ ...accepted, state: "cancelled" } as AgentTaskRecord)),
  };
  return {
    service,
    accepted,
    captureSubmission: (value) => { submitted = value; },
    get submission() { return submitted; },
  };
}

function createExecutor(fixture: ReturnType<typeof serviceFor>, overrides: Partial<{
  callerIdentity: ManagedAgentCallerAttachmentIdentity;
  acceptAgentTask: (
    submission: AgentTaskSubmission,
    callerIdentity: ManagedAgentCallerAttachmentIdentity | undefined,
    admission: EffectiveAuthorityAdmissionBundle,
  ) => Promise<AgentTaskRecord>;
}> = {}) {
  return createAgentTaskVisionAnalysisCapabilityExecutor({
    agentTaskService: fixture.service,
    configuredAgentProfileId: PROFILE_ID,
    callerId: CALLER_ID,
    acceptAgentTask: overrides.acceptAgentTask ?? (async (submission) => {
      fixture.captureSubmission(submission);
      return fixture.accepted;
    }),
    ...(overrides.callerIdentity === undefined ? {} : { callerIdentity: overrides.callerIdentity }),
  });
}

describe("AgentTaskVisionAnalysisCapabilityExecutor", () => {
  it("uses one existing Agent Task lifecycle and returns the separately queried typed output", async () => {
    const fixture = serviceFor();
    const callerIdentity: ManagedAgentCallerAttachmentIdentity = {
      kind: "kiln-runtime",
      surface: "run",
      attachmentId: "kiln-runtime:run",
    };
    const executor = createExecutor(fixture, { callerIdentity });

    const result = await executor.execute(executionInput());

    expect(result).toEqual({ status: "completed", output: VISION_OUTPUT });
    expect(fixture.submission).toBeDefined();
    expect(fixture.submission?.capability).toEqual({
      capabilityId: "vision.analyze",
      contract: "vision.analyze/v1",
      input: parseVisionAnalyzeInput(VISION_INPUT),
      inputDigest: digestManagedEconomicValue(parseVisionAnalyzeInput(VISION_INPUT)),
    });
    expect(fixture.submission?.objective).toBe("Analyze the admitted image resources.");
    expect(fixture.submission?.objective).not.toContain("Describe the image.");
    expect(fixture.service.dispatch).toHaveBeenCalledWith(fixture.accepted.id, { callerIdentity });
    expect(fixture.service.getResult).toHaveBeenCalledWith({
      project: { id: fixture.accepted.projectId },
      callerId: CALLER_ID,
    }, fixture.accepted.id);
  });

  it("offers exact trusted admission to a non-enqueuing acceptance hook before one dispatch", async () => {
    const fixture = serviceFor();
    const parentAuthority = context().authorityAdmission!;
    const acceptAgentTask = vi.fn(async (
      submission: AgentTaskSubmission,
      callerIdentity: ManagedAgentCallerAttachmentIdentity | undefined,
      admission: EffectiveAuthorityAdmissionBundle,
    ) => {
      expect(submission.capability?.capabilityId).toBe("vision.analyze");
      expect(callerIdentity?.attachmentId).toBe("kiln-runtime:run");
      expect(admission).toBe(parentAuthority);
      return fixture.accepted;
    });
    const executor = createExecutor(fixture, {
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "run",
        attachmentId: "kiln-runtime:run",
      },
      acceptAgentTask,
    });

    const result = await executor.execute(executionInput({
      ...context(),
      authorityAdmission: parentAuthority,
    }));

    expect(result.status).toBe("completed");
    expect(acceptAgentTask).toHaveBeenCalledTimes(1);
    expect(fixture.submission).toBeUndefined();
    expect(fixture.service.dispatch).toHaveBeenCalledTimes(1);
  });

  it("requires the exact vision binding and trusted parent context before accepting work", async () => {
    const fixture = serviceFor();
    const executor = createExecutor(fixture);

    await expect(executor.execute({ ...executionInput(), trustedContext: undefined })).resolves.toEqual({
      status: "failed",
      diagnosticCode: "missing_context",
    });
    await expect(executor.execute({
      ...executionInput(),
      binding: binding({ toolCallId: "other-call" }),
    })).resolves.toEqual({
      status: "failed",
      diagnosticCode: "missing_context",
    });
    await expect(executor.execute({
      ...executionInput(),
      binding: binding({ capabilityId: "other.capability" }),
    })).resolves.toEqual({
      status: "failed",
      diagnosticCode: "invalid_input",
    });
    expect(fixture.submission).toBeUndefined();
  });

  it("does not double-dispatch a task accepted in an ownership-violating state", async () => {
    const fixture = serviceFor();
    const executor = createExecutor(fixture, {
      acceptAgentTask: async () => ({ ...fixture.accepted, state: "running" } as AgentTaskRecord),
    });

    await expect(executor.execute(executionInput())).resolves.toEqual({
      status: "outcome-unknown",
      diagnosticCode: "agent_outcome_unknown",
    });
    expect(fixture.service.dispatch).not.toHaveBeenCalled();

    const awaitingFixture = serviceFor();
    const awaitingExecutor = createExecutor(awaitingFixture, {
      acceptAgentTask: async () => ({ ...awaitingFixture.accepted, state: "awaiting_approval" } as AgentTaskRecord),
    });
    await expect(awaitingExecutor.execute(executionInput())).resolves.toEqual({
      status: "failed",
      diagnosticCode: "unavailable",
    });
    expect(awaitingFixture.service.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ["missing output", undefined, "invalid_output"],
    ["malformed output", { status: "failed" }, "invalid_output"],
    ["out-of-scope evidence", { ...VISION_OUTPUT, evidenceUris: [OTHER_RESOURCE_URI] }, "invalid_output"],
    ["mismatched capability digest", undefined, "invalid_output"],
  ] as const)("does not complete with %s", async (label, output, diagnosticCode) => {
    const fixture = serviceFor({
      ...(label === "mismatched capability digest" ? {
        capability: {
          ...fixtureCapability(),
          inputDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        },
      } : {}),
      ...(label === "missing output" ? { capabilityOutput: undefined } : {}),
      ...(output === undefined ? {} : { capabilityOutput: output as unknown as VisionAnalysis }),
    });
    const executor = createExecutor(fixture);

    await expect(executor.execute(executionInput())).resolves.toEqual({ status: "failed", diagnosticCode });
  });

  it.each([
    ["pending", { availability: "pending", lifecycleState: "running" }, { status: "outcome-unknown", diagnosticCode: "agent_outcome_unknown" }],
    ["interrupted", { availability: "unresolved", lifecycleState: "interrupted", diagnostic: "result_pending" }, { status: "outcome-unknown", diagnosticCode: "agent_outcome_unknown" }],
    ["known timeout", { availability: "failed", lifecycleState: "timed_out", diagnostic: "provider_timeout" }, { status: "timed_out", diagnosticCode: "timed_out" }],
    ["known cancellation", { availability: "failed", lifecycleState: "cancelled", diagnostic: "cancelled" }, { status: "cancelled", diagnosticCode: "cancelled" }],
  ] as const)("maps %s conservatively", async (_label, query, expected) => {
    const fixture = serviceFor(query as Partial<AgentTaskResultQuery>);
    const executor = createExecutor(fixture);
    await expect(executor.execute(executionInput())).resolves.toEqual(expected);
  });

  it("cancels the accepted task through the service and does not claim completion", async () => {
    const fixture = serviceFor();
    let releaseDispatch: ((value: AgentTaskRecord) => void) | undefined;
    fixture.service.dispatch = vi.fn<AgentTaskCapabilityService["dispatch"]>(
      () => new Promise((resolve) => { releaseDispatch = resolve; }),
    );
    const controller = new AbortController();
    const executor = createExecutor(fixture);
    const pending = executor.execute(executionInput(context(), controller.signal));
    await vi.waitFor(() => expect(fixture.service.dispatch).toHaveBeenCalledTimes(1));
    controller.abort();
    releaseDispatch?.({ ...fixture.accepted, state: "cancelled" } as AgentTaskRecord);

    await expect(pending).resolves.toEqual({ status: "cancelled", diagnosticCode: "cancelled" });
    expect(fixture.service.cancel).toHaveBeenCalledWith({
      project: { id: fixture.accepted.projectId },
      callerId: CALLER_ID,
    }, fixture.accepted.id);
  });
});

function fixtureCapability(): NonNullable<AgentTaskRecord["capability"]> {
  return {
    capabilityId: "vision.analyze",
    contract: "vision.analyze/v1",
    input: parseVisionAnalyzeInput(VISION_INPUT),
    inputDigest: digestManagedEconomicValue(parseVisionAnalyzeInput(VISION_INPUT)),
  };
}
