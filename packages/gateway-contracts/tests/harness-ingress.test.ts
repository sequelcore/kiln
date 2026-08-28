import { describe, expect, it } from "vitest";
import {
  HARNESS_INGRESS_MAX_INLINE_DATA_LENGTH,
  HARNESS_INGRESS_MAX_PARTS,
  HARNESS_INGRESS_MAX_TEXT_LENGTH,
  HARNESS_INGRESS_PROTOCOL_VERSION,
  parseHarnessIngressClientFrame,
  parseHarnessIngressServerFrame,
} from "../src/harness-ingress.js";
import { OperatorTurnTerminalDispositionSchema } from "../src/operator-turn-terminal-disposition.js";

const transportIdentity = {
  callerId: "caller:test-client",
  appName: "test-app",
  userId: "user:test-user",
  tenantId: "tenant:test-tenant",
} as const;

const turnStart = {
  protocolVersion: HARNESS_INGRESS_PROTOCOL_VERSION,
  type: "turn_start",
  requestId: "request:turn-1",
  content: "Summarize the fixture.",
  sessionId: "session:requested-1",
  requestedAuthority: "read_only",
  deliberationIntent: {
    mode: "fixed",
    preferredLevel: "medium",
    onUnsupported: "deny",
  },
  communicationIntent: {
    responseDetail: "concise",
    locale: "es-MX",
    requiredContent: ["verification"],
    onUnsupported: "deny",
  },
  } as const;

const convergencePolicy = {
  policyId: "test.runtime.turn-convergence",
  configurationHash: `sha256:${"0".repeat(64)}`,
  providerRequests: 10,
  toolRounds: 8,
  toolCalls: 24,
  cumulativeInputTokens: 256_000,
  elapsedMs: 600_000,
  activeMs: 600_000,
  recoveryAttempts: 3,
  consecutiveNoProgressSteps: 3,
} as const;

const eligibleCompletion = {
  obligations: [],
  producerEvidence: [],
  eligibility: { status: "eligible" },
} as const;

const requiredProducerNotRunCompletion = {
  obligations: [{
    kind: "required_producer",
    obligationId: "required-producer:formal_verify",
    canonicalToolId: "formal_verify",
    acceptedEquivalentToolIds: [],
    sourceAlias: "Dafny",
  }],
  producerEvidence: [],
  eligibility: {
    status: "ineligible",
    unmet: [{
      obligationId: "required-producer:formal_verify",
      canonicalToolId: "formal_verify",
      sourceAlias: "Dafny",
      status: "not_run",
    }],
  },
} as const;

const completedDisposition = {
  outcome: "completed",
  dispositionReason: "completion_eligible",
  completion: eligibleCompletion,
  convergence: {
    policy: convergencePolicy,
    progressEvidence: [],
  },
} as const;

const noProgressDisposition = {
  outcome: "paused",
  dispositionReason: "no_progress",
  convergence: {
    policy: convergencePolicy,
    progressEvidence: [{
      kind: "no_progress",
      reason: "repeated_result",
      strategyFingerprint: "strategy:repeated-result",
      supportingToolCallIds: ["tool-call:1"],
    }],
    pause: {
      status: "pause",
      reason: "no_progress",
      metric: "consecutiveNoProgressSteps",
      observed: 3,
      limit: 3,
    },
  },
} as const;

const requiredProducerNotRunDisposition = {
  outcome: "paused",
  dispositionReason: "required_producer_not_run",
  completion: requiredProducerNotRunCompletion,
  convergence: {
    policy: convergencePolicy,
    progressEvidence: [],
  },
} as const;

const runtimeFailureDisposition = {
  outcome: "failed",
  dispositionReason: "runtime_failure",
} as const;

const operatorCancelledDisposition = {
  outcome: "cancelled",
  dispositionReason: "operator_cancelled",
} as const;

function turnCompletedFrame(disposition: Record<string, unknown>) {
  return {
    protocolVersion: HARNESS_INGRESS_PROTOCOL_VERSION,
    type: "turn_completed",
    requestId: "request:turn-terminal",
    turnId: "turn:terminal",
    sessionId: "session:canonical-terminal",
    ...disposition,
    content: "Synthetic response.",
  };
}

describe("harness-neutral ingress contract", () => {
  it("parses a versioned text turn and injects every transport-owned identity field", () => {
    expect(parseHarnessIngressClientFrame(turnStart, transportIdentity)).toEqual({
      ...turnStart,
      ...transportIdentity,
    });
  });

  it("parses content parts as the alternate, unambiguous turn content form", () => {
    const parsed = parseHarnessIngressClientFrame({
      protocolVersion: HARNESS_INGRESS_PROTOCOL_VERSION,
      type: "turn_start",
      requestId: "request:turn-parts",
      parts: [
        { type: "text", text: "Summarize the fixture." },
        { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
        { type: "file", mimeType: "text/plain", artifactUri: "kiln://artifacts/fixture-1", filename: "fixture.txt" },
      ],
    }, transportIdentity);

    if (parsed.type !== "turn_start") throw new Error("expected a turn_start frame");
    expect(parsed.parts).toHaveLength(3);
  });

  it("parses a versioned cancellation request without client-controlled tenancy identity", () => {
    expect(parseHarnessIngressClientFrame({
      protocolVersion: HARNESS_INGRESS_PROTOCOL_VERSION,
      type: "turn_cancel",
      requestId: "request:cancel-1",
      turnId: "turn:1",
      sessionId: "session:requested-1",
      reason: "Operator stopped the synthetic turn.",
    }, transportIdentity)).toEqual({
      protocolVersion: HARNESS_INGRESS_PROTOCOL_VERSION,
      type: "turn_cancel",
      requestId: "request:cancel-1",
      turnId: "turn:1",
      sessionId: "session:requested-1",
      reason: "Operator stopped the synthetic turn.",
      ...transportIdentity,
    });
  });

  it("accepts UUID request, session, and turn identifiers that begin with a digit", () => {
    const requestId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const sessionId = "4f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const turnId = "5f2504e0-4f89-41d3-9a0c-0305e82c3301";

    expect(parseHarnessIngressClientFrame({
      protocolVersion: HARNESS_INGRESS_PROTOCOL_VERSION,
      type: "turn_cancel",
      requestId,
      sessionId,
      turnId,
    }, transportIdentity)).toMatchObject({ requestId, sessionId, turnId });
  });

  it("parses lifecycle frames and permits only closed redacted errors", () => {
    expect(parseHarnessIngressServerFrame({ protocolVersion: "2", type: "turn_accepted", requestId: "request:turn-1", turnId: "turn:1" })).toMatchObject({ type: "turn_accepted" });
    expect(parseHarnessIngressServerFrame({ protocolVersion: "2", type: "turn_cancel_result", requestId: "request:cancel-1", turnId: "turn:1", status: "accepted" })).toMatchObject({ type: "turn_cancel_result" });
    expect(parseHarnessIngressServerFrame(turnCompletedFrame(completedDisposition))).toMatchObject({ type: "turn_completed", sessionId: "session:canonical-terminal", dispositionReason: "completion_eligible" });
    expect(parseHarnessIngressServerFrame({ protocolVersion: "2", type: "error", requestId: "request:turn-1", code: "internal", redacted: true })).toEqual({ protocolVersion: "2", type: "error", requestId: "request:turn-1", code: "internal", redacted: true });
  });

  it("accepts a completed disposition only with eligible completion and convergence evidence", () => {
    const parsed = parseHarnessIngressServerFrame(turnCompletedFrame(completedDisposition));

    expect(parsed).toMatchObject({
      outcome: "completed",
      dispositionReason: "completion_eligible",
      completion: completedDisposition.completion,
      convergence: completedDisposition.convergence,
    });
  });

  it("accepts a no-progress pause with its exact convergence pause evidence", () => {
    const parsed = parseHarnessIngressServerFrame(turnCompletedFrame(noProgressDisposition));

    expect(parsed).toMatchObject({
      outcome: "paused",
      dispositionReason: "no_progress",
      convergence: noProgressDisposition.convergence,
    });
  });

  it("accepts a required-producer-not-run pause with unmet completion evidence", () => {
    const parsed = parseHarnessIngressServerFrame(turnCompletedFrame(requiredProducerNotRunDisposition));

    expect(parsed).toMatchObject({
      outcome: "paused",
      dispositionReason: "required_producer_not_run",
      completion: requiredProducerNotRunDisposition.completion,
      convergence: requiredProducerNotRunDisposition.convergence,
    });
  });

  it("accepts a runtime failure disposition without fabricated completion evidence", () => {
    const parsed = parseHarnessIngressServerFrame(turnCompletedFrame(runtimeFailureDisposition));

    expect(parsed).toMatchObject(runtimeFailureDisposition);
  });

  it("accepts an operator-cancelled disposition without fabricated completion evidence", () => {
    const parsed = parseHarnessIngressServerFrame(turnCompletedFrame(operatorCancelledDisposition));

    expect(parsed).toMatchObject(operatorCancelledDisposition);
  });

  it("parses the terminal disposition union independently of the server frame envelope", () => {
    expect(OperatorTurnTerminalDispositionSchema.parse(noProgressDisposition)).toEqual(noProgressDisposition);
  });

  it.each([
    [{ ...turnStart, appName: "spoofed-app" }, transportIdentity],
    [{ ...turnStart, userId: "user:spoofed" }, transportIdentity],
    [{ ...turnStart, tenantId: "tenant:spoofed" }, transportIdentity],
    [{ ...turnStart, callerId: "caller:spoofed" }, transportIdentity],
    [turnStart, { ...transportIdentity, userId: "not a user id" }],
    [{ ...turnStart, content: "", parts: [] }, transportIdentity],
    [{ ...turnStart, parts: [{ type: "text", text: "part" }] }, transportIdentity],
  ])("rejects client identity spoofing and ambiguous or empty turn content", (payload, identity) => {
    expect(() => parseHarnessIngressClientFrame(payload, identity)).toThrow();
  });

  it.each([
    { type: "image", mimeType: "image/png", data: "not base64!" },
    { type: "image", mimeType: "not-a-mime", data: "YWJj" },
    { type: "image", mimeType: "image/png", artifactUri: "kiln://session/private" },
    { type: "image", mimeType: "image/png", data: "YWJj", artifactUri: "kiln://artifacts/image-1" },
    { type: "image", mimeType: "image/png" },
    { type: "image", mimeType: "image/png", data: "YWJj", provider: "provider-native" },
  ])("rejects unsafe or malformed binary content parts", (part) => {
    expect(() => parseHarnessIngressClientFrame({ ...turnStart, content: undefined, parts: [part] }, transportIdentity)).toThrow();
  });

  it("bounds content text, part count, and encoded inline data", () => {
    expect(() => parseHarnessIngressClientFrame({ ...turnStart, content: "x".repeat(HARNESS_INGRESS_MAX_TEXT_LENGTH + 1) }, transportIdentity)).toThrow();
    expect(() => parseHarnessIngressClientFrame({ ...turnStart, content: undefined, parts: Array.from({ length: HARNESS_INGRESS_MAX_PARTS + 1 }, () => ({ type: "text", text: "x" })) }, transportIdentity)).toThrow();
    expect(() => parseHarnessIngressClientFrame({ ...turnStart, content: undefined, parts: [{ type: "image", mimeType: "image/png", data: "A".repeat(HARNESS_INGRESS_MAX_INLINE_DATA_LENGTH + 1) }] }, transportIdentity)).toThrow();
  });

  it("rejects nested unknown keys and prototype-shaped payloads", () => {
    expect(() => parseHarnessIngressClientFrame({ ...turnStart, content: undefined, parts: [{ type: "text", text: "safe", unexpected: true }] }, transportIdentity)).toThrow();
    expect(() => parseHarnessIngressClientFrame(Object.assign(Object.create({ inherited: true }), turnStart), transportIdentity)).toThrow();
    expect(() => parseHarnessIngressClientFrame({ ...turnStart, content: undefined, parts: [Object.assign(Object.create({ provider: "native" }), { type: "text", text: "safe" })] }, transportIdentity)).toThrow();
    expect(() => parseHarnessIngressClientFrame({ ...turnStart, communicationIntent: { responseDetail: "concise", rawPrompt: "private" } }, transportIdentity)).toThrow();
    expect(() => parseHarnessIngressClientFrame({ ...turnStart, communicationIntent: { locale: "not a locale" } }, transportIdentity)).toThrow();
  });

  it.each([
    { protocolVersion: "2", type: "error", requestId: "request:turn-1", code: "internal", message: "raw provider error", redacted: true },
    { protocolVersion: "2", type: "error", requestId: "request:turn-1", code: "provider_failure", redacted: true },
    { protocolVersion: "2", type: "turn_completed", requestId: "request:turn-1", turnId: "turn:1", outcome: "completed", content: "missing canonical session" },
    { protocolVersion: "2", type: "turn_completed", requestId: "request:turn-1", turnId: "turn:1", outcome: "completed", content: "text", parts: [{ type: "text", text: "part" }] },
  ])("rejects raw errors and ambiguous server completion content", (payload) => {
    expect(() => parseHarnessIngressServerFrame(payload)).toThrow();
  });

  it.each([
    turnCompletedFrame({ ...completedDisposition, outcome: "failed" }),
    turnCompletedFrame({ ...runtimeFailureDisposition, outcome: "completed" }),
    turnCompletedFrame({ ...completedDisposition, dispositionReason: "runtime_failure" }),
    turnCompletedFrame({ ...noProgressDisposition, convergence: undefined }),
    turnCompletedFrame({ ...requiredProducerNotRunDisposition, completion: undefined }),
    turnCompletedFrame({ ...completedDisposition, dispositionReason: "unknown_reason" }),
  ])("rejects terminal disposition with mismatched outcome/reason or missing branch evidence", (payload) => {
    expect(() => parseHarnessIngressServerFrame(payload)).toThrow();
  });
});
