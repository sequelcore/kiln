import type { DevTool } from "@kilnai/core";
import {
  FORMAL_VERIFICATION_FINISH_TRANSPORT,
  parseFormalVerificationToolResultMetadata,
  type DevToolExecutionContext,
  type FormalVerificationFinishExecutionScope,
  type FormalVerificationFinishTransportEnvelope,
} from "@kilnai/core/tools";
import { isRuntimeOwnedFormalVerificationFinishInvocation } from "@kilnai/runtime";
import {
  hasExactKeys,
  hasOwn,
  isRecord,
} from "./work-governance-tool-input.js";

export function readFormalVerificationFinishTransport(
  context: DevToolExecutionContext | undefined,
  expectedScope: FormalVerificationFinishExecutionScope,
  expectedFinishTool: Pick<DevTool, "name">,
): FormalVerificationFinishTransportEnvelope | undefined {
  const value = context?.[FORMAL_VERIFICATION_FINISH_TRANSPORT];
  if (value === undefined) return undefined;
  if (
    expectedFinishTool.name !== "work_item.execution.finish"
    || !isRuntimeOwnedFormalVerificationFinishInvocation(expectedFinishTool, value)
  ) {
    throw new Error("Formal verification finish transport was not issued by the attached Runtime finish path.");
  }
  if (!isRecord(value) || !hasExactKeys(value, ["observations", "executionScope", "recordedAt", "producer"])) {
    throw new Error("Formal verification finish transport is malformed.");
  }
  const executionScope = readFormalVerificationFinishExecutionScope(value.executionScope);
  assertExactFormalVerificationFinishScope(executionScope, expectedScope);
  if (!Array.isArray(value.observations)) {
    throw new Error("Formal verification finish transport observations are malformed.");
  }
  for (const observation of value.observations) {
    if (!isRecord(observation) || !hasExactKeys(observation, ["metadata", "toolCallScopeId", "toolCallId", "executionScope"])) {
      throw new Error("Formal verification finish transport observation is malformed.");
    }
    if (!isCanonicalTransportText(observation.toolCallScopeId) || !isCanonicalTransportText(observation.toolCallId)) {
      throw new Error("Formal verification finish transport observation invocation is malformed.");
    }
    const observationScope = readFormalVerificationFinishExecutionScope(observation.executionScope);
    assertExactFormalVerificationFinishScope(observationScope, executionScope);
    if (!isRecord(observation.metadata)) {
      throw new Error("Formal verification finish transport observation metadata is malformed.");
    }
    parseFormalVerificationToolResultMetadata(observation.metadata);
  }
  if (!isCanonicalTransportTimestamp(value.recordedAt)) {
    throw new Error("Formal verification finish transport recordedAt is malformed.");
  }
  if (!isRecord(value.producer)
    || !hasExactKeys(value.producer, ["kind", "toolName"])
    || value.producer.kind !== "registered_tool"
    || value.producer.toolName !== "formal_verify") {
    throw new Error("Formal verification finish transport producer is malformed.");
  }
  return value as unknown as FormalVerificationFinishTransportEnvelope;
}

function readFormalVerificationFinishExecutionScope(value: unknown): FormalVerificationFinishExecutionScope {
  if (!isRecord(value)
    || (hasOwn(value, "managedInvocationId")
      ? !hasExactKeys(value, ["kind", "goalRunId", "workItemId", "attemptId", "managedInvocationId"])
      : !hasExactKeys(value, ["kind", "goalRunId", "workItemId", "attemptId"]))
    || value.kind !== "work_item"
    || !isCanonicalTransportText(value.goalRunId)
    || !isCanonicalTransportText(value.workItemId)
    || !isCanonicalTransportText(value.attemptId)
    || (hasOwn(value, "managedInvocationId") && !isCanonicalTransportText(value.managedInvocationId))) {
    throw new Error("Formal verification finish transport execution scope is malformed.");
  }
  return {
    kind: "work_item",
    goalRunId: value.goalRunId as string,
    workItemId: value.workItemId as string,
    attemptId: value.attemptId as string,
    ...(hasOwn(value, "managedInvocationId") ? { managedInvocationId: value.managedInvocationId as string } : {}),
  };
}

function isCanonicalTransportText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function isCanonicalTransportTimestamp(value: unknown): value is string {
  return isCanonicalTransportText(value)
    && !Number.isNaN(new Date(value).getTime())
    && new Date(value).toISOString() === value;
}

function assertExactFormalVerificationFinishScope(
  actual: FormalVerificationFinishExecutionScope,
  expected: FormalVerificationFinishExecutionScope,
): void {
  const actualManagedInvocation = hasOwn(actual, "managedInvocationId");
  const expectedManagedInvocation = hasOwn(expected, "managedInvocationId");
  if (actual.goalRunId !== expected.goalRunId
    || actual.workItemId !== expected.workItemId
    || actual.attemptId !== expected.attemptId
    || actualManagedInvocation !== expectedManagedInvocation
    || (actualManagedInvocation && actual.managedInvocationId !== expected.managedInvocationId)) {
    throw new Error("Formal verification finish transport scope does not match the governed attempt.");
  }
}
