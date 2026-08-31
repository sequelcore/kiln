import { describe, expect, it, vi } from "vitest";
import { normalizeAndDigestCapabilityJsonSchema } from "@kilnai/core/capabilities";
import {
  AgentBackedCapabilityInvocationPort,
  createAgentBackedCapabilityInvocationPort,
  isRuntimeOwnedAgentBackedCapabilityInvocationPort,
  type AgentBackedCapabilityExecutor,
} from "../../src/capabilities/agent-backed-execution.js";
import { createPortableInvocationBinding } from "../../src/capabilities/portable-execution.js";

const A = `sha256:${"a".repeat(64)}` as const;
const B = `sha256:${"b".repeat(64)}` as const;
const C = `sha256:${"c".repeat(64)}` as const;
const TRUSTED_CONTEXT = Object.freeze({ authorityAdmissionId: "fixture-admission" });
const INPUT_SCHEMA = {
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
} as const;
const OUTPUT_SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
} as const;

function digest(schema: Record<string, unknown>, direction: "input" | "output"): `sha256:${string}` {
  const result = normalizeAndDigestCapabilityJsonSchema(schema, direction, { requireObjectType: true });
  if (!result.ok || !result.present) throw new Error("Fixture schema must normalize.");
  return result.digest;
}

const INPUT_DIGEST = digest(INPUT_SCHEMA, "input");
const OUTPUT_DIGEST = digest(OUTPUT_SCHEMA, "output");

function binding(overrides: Record<string, unknown> = {}) {
  return createPortableInvocationBinding({
    generationId: A,
    catalogDigest: B,
    capabilityId: "vision.analyze",
    revision: "v1",
    descriptorDigest: C,
    toolName: "vision_analyze",
    implementationIdentityDigest: A,
    inputSchemaDigest: INPUT_DIGEST,
    outputSchemaDigest: OUTPUT_DIGEST,
    inputSchema: INPUT_SCHEMA,
    outputSchema: OUTPUT_SCHEMA,
    toolCallScopeId: "scope-1",
    toolCallId: "call-1",
    input: { value: "candidate" },
    limits: { maxInputBytes: 16_384, maxOutputBytes: 16_384, maxDurationMs: 1_000, maxArtifacts: 0 },
    idempotency: "idempotent",
    ...overrides,
  });
}

describe("AgentBackedCapabilityInvocationPort", () => {
  it("records explicit Agent Task provenance and validates exact child output", async () => {
    let receivedSignal: AbortSignal | undefined;
    const executor: AgentBackedCapabilityExecutor<{ readonly ok: boolean }> = {
      execute: async (input) => {
        receivedSignal = input.signal;
        expect(Object.isFrozen(input.input)).toBe(true);
        return { status: "completed", output: { ok: true } };
      },
    };
    const port = createAgentBackedCapabilityInvocationPort({
      executor,
      kind: "agent-task",
      implementationIdentityDigest: A,
      childId: "agent-task-vision-1",
      executorId: "agent-task-executor",
    });

    const result = await port.invoke({ binding: binding(), input: { value: "candidate" }, trustedContext: TRUSTED_CONTEXT });

    expect(isRuntimeOwnedAgentBackedCapabilityInvocationPort(port)).toBe(true);
    expect(port).toBeInstanceOf(AgentBackedCapabilityInvocationPort);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(result.output).toEqual({ ok: true });
    expect(result.settlement).toMatchObject({
      port: "agent-task",
      status: "completed",
      dispatch: "terminally-observed",
      agentBacked: {
        kind: "agent-task",
        childId: "agent-task-vision-1",
        executorId: "agent-task-executor",
        trust: "untrusted-child-output",
      },
    });
  });

  it("never exposes output from failed or unknown child outcomes", async () => {
    const executor: AgentBackedCapabilityExecutor<{ readonly ok: boolean }> = {
      execute: async () => ({ status: "outcome-unknown", diagnosticCode: "agent_outcome_unknown" }),
    };
    const result = await createAgentBackedCapabilityInvocationPort({
      executor,
      kind: "managed-invocation",
      implementationIdentityDigest: A,
      childId: "managed-child-1",
      executorId: "managed-invocation-executor",
    }).invoke({
      binding: binding({ idempotency: "unknown" }),
      input: { value: "candidate" },
      trustedContext: TRUSTED_CONTEXT,
    });

    expect(result.output).toBeUndefined();
    expect(result.settlement).toMatchObject({
      port: "managed-invocation",
      status: "failed",
      dispatch: "outcome-unknown",
      agentBacked: { kind: "managed-invocation", trust: "untrusted-child-output" },
    });
  });

  it("propagates bounded timeout cancellation and settles non-preemptible work as unknown", async () => {
    let receivedSignal: AbortSignal | undefined;
    const executor: AgentBackedCapabilityExecutor<{ readonly ok: boolean }> = {
      execute: async (input) => {
        receivedSignal = input.signal;
        await new Promise<void>(() => undefined);
        return { status: "completed", output: { ok: true } };
      },
    };
    const result = await createAgentBackedCapabilityInvocationPort({
      executor,
      kind: "agent-task",
      implementationIdentityDigest: A,
      childId: "agent-task-timeout",
      executorId: "agent-task-executor",
    }).invoke({
      binding: binding({ limits: { maxInputBytes: 16_384, maxOutputBytes: 16_384, maxDurationMs: 25, maxArtifacts: 0 } }),
      input: { value: "candidate" },
      trustedContext: TRUSTED_CONTEXT,
      timeoutMs: 1,
    });

    expect(result.output).toBeUndefined();
    expect(result.settlement.status).toBe("timed_out");
    expect(result.settlement.dispatch).toBe("outcome-unknown");
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("settles an already-cancelled request before dispatch", async () => {
    const controller = new AbortController();
    controller.abort();
    const executor = { execute: vi.fn<AgentBackedCapabilityExecutor<{ readonly ok: boolean }>["execute"]>() };
    const result = await createAgentBackedCapabilityInvocationPort({
      executor,
      kind: "managed-invocation",
      implementationIdentityDigest: A,
      childId: "managed-child-cancelled",
      executorId: "managed-invocation-executor",
    }).invoke({
      binding: binding(),
      input: { value: "candidate" },
      trustedContext: TRUSTED_CONTEXT,
      signal: controller.signal,
    });

    expect(result.output).toBeUndefined();
    expect(result.settlement.status).toBe("cancelled");
    expect(result.settlement.dispatch).toBe("known-not-dispatched");
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("requires Runtime-owned trusted context before dispatch", async () => {
    const executor = { execute: vi.fn<AgentBackedCapabilityExecutor<{ readonly ok: boolean }>["execute"]>() };
    const result = await createAgentBackedCapabilityInvocationPort({
      executor,
      kind: "agent-task",
      implementationIdentityDigest: A,
      childId: "agent-task-missing-context",
      executorId: "agent-task-executor",
    }).invoke({ binding: binding(), input: { value: "candidate" } });

    expect(result.output).toBeUndefined();
    expect(result.settlement).toMatchObject({
      status: "failed",
      dispatch: "known-not-dispatched",
      diagnosticCode: "missing_context",
    });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("rejects an implementation identity mismatch before dispatch", async () => {
    const executor = { execute: vi.fn<AgentBackedCapabilityExecutor<{ readonly ok: boolean }>["execute"]>() };
    const result = await createAgentBackedCapabilityInvocationPort({
      executor,
      kind: "managed-invocation",
      implementationIdentityDigest: A,
      childId: "managed-child-identity-mismatch",
      executorId: "managed-invocation-executor",
    }).invoke({
      binding: binding({ implementationIdentityDigest: B }),
      input: { value: "candidate" },
      trustedContext: TRUSTED_CONTEXT,
    });

    expect(result.output).toBeUndefined();
    expect(result.settlement).toMatchObject({
      status: "failed",
      dispatch: "known-not-dispatched",
      diagnosticCode: "implementation_mismatch",
    });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("rejects a child result that does not satisfy the exact output schema", async () => {
    const executor: AgentBackedCapabilityExecutor<{ readonly ok: boolean }> = {
      execute: async () => ({ status: "completed", output: { ok: "not-a-boolean" } as unknown as { readonly ok: boolean } }),
    };
    const result = await createAgentBackedCapabilityInvocationPort({
      executor,
      kind: "agent-task",
      implementationIdentityDigest: A,
      childId: "agent-task-invalid-output",
      executorId: "agent-task-executor",
    }).invoke({ binding: binding(), input: { value: "candidate" }, trustedContext: TRUSTED_CONTEXT });

    expect(result.output).toBeUndefined();
    expect(result.settlement.status).toBe("invalid_output");
    expect(result.settlement.dispatch).toBe("terminally-observed");
  });
});
