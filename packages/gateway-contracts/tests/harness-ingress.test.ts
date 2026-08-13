import { describe, expect, it } from "vitest";
import {
  HARNESS_INGRESS_MAX_INLINE_DATA_LENGTH,
  HARNESS_INGRESS_MAX_PARTS,
  HARNESS_INGRESS_MAX_TEXT_LENGTH,
  HARNESS_INGRESS_PROTOCOL_VERSION,
  parseHarnessIngressClientFrame,
  parseHarnessIngressServerFrame,
} from "../src/harness-ingress.js";

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

describe("harness-neutral ingress contract", () => {
  it("parses a versioned text turn and injects every transport-owned identity field", () => {
    expect(parseHarnessIngressClientFrame(turnStart, transportIdentity)).toEqual({
      ...turnStart,
      ...transportIdentity,
    });
  });

  it("parses content parts as the alternate, unambiguous turn content form", () => {
    expect(parseHarnessIngressClientFrame({
      protocolVersion: HARNESS_INGRESS_PROTOCOL_VERSION,
      type: "turn_start",
      requestId: "request:turn-parts",
      parts: [
        { type: "text", text: "Summarize the fixture." },
        { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
        { type: "file", mimeType: "text/plain", artifactUri: "kiln://artifacts/fixture-1", filename: "fixture.txt" },
      ],
    }, transportIdentity).parts).toHaveLength(3);
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
    expect(parseHarnessIngressServerFrame({ protocolVersion: "2", type: "turn_completed", requestId: "request:turn-1", turnId: "turn:1", sessionId: "session:canonical-1", outcome: "completed", content: "Synthetic response." })).toMatchObject({ type: "turn_completed", sessionId: "session:canonical-1" });
    expect(parseHarnessIngressServerFrame({ protocolVersion: "2", type: "error", requestId: "request:turn-1", code: "internal", redacted: true })).toEqual({ protocolVersion: "2", type: "error", requestId: "request:turn-1", code: "internal", redacted: true });
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
});
