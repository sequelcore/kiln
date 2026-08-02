import { describe, expect, it } from "vitest";
import { NativeToolEventIdentity } from "../../src/wrapper/session.js";

describe("NativeToolEventIdentity", () => {
  it("preserves provider call ids and de-duplicates repeated lifecycle notifications", () => {
    const identity = new NativeToolEventIdentity({
      providerId: "opencode",
      kilnSessionId: "session-1",
      turnId: "turn-1",
    });

    expect(identity.start("read", "provider-call-1")).toEqual({
      emit: true,
      toolCallId: "provider-call-1",
      toolCallScopeId: "session-1:turn-1:opencode",
    });
    expect(identity.start("read", "provider-call-1").emit).toBe(false);
    expect(identity.complete("read", "provider-call-1")).toEqual({
      emit: true,
      startRequired: false,
      toolName: "read",
      toolCallId: "provider-call-1",
      toolCallScopeId: "session-1:turn-1:opencode",
    });
    expect(identity.complete("read", "provider-call-1").emit).toBe(false);
  });

  it("uses deterministic ordinals and pairs an id-less result with its open call", () => {
    const identity = new NativeToolEventIdentity({
      providerId: "claude-code",
      kilnSessionId: "session-2",
      turnId: "turn-3",
    });

    const started = identity.start("read");
    const completed = identity.complete("read");

    expect(started).toEqual({
      emit: true,
      toolCallId: "claude-code:tool:1",
      toolCallScopeId: "session-2:turn-3:claude-code",
    });
    expect(completed).toEqual({
      emit: true,
      startRequired: false,
      toolName: "read",
      toolCallId: "claude-code:tool:1",
      toolCallScopeId: "session-2:turn-3:claude-code",
    });
  });

  it("requires callers to synthesize a start when completion is the first observation", () => {
    const identity = new NativeToolEventIdentity({
      providerId: "codex",
      kilnSessionId: "session-3",
      turnId: "turn-1",
    });

    expect(identity.complete("bash", "provider-command-1")).toEqual({
      emit: true,
      startRequired: true,
      toolName: "bash",
      toolCallId: "provider-command-1",
      toolCallScopeId: "session-3:turn-1:codex",
    });
  });

  it("fails closed when one provider id is reused for a different tool", () => {
    const identity = new NativeToolEventIdentity({
      providerId: "codex",
      kilnSessionId: "session-4",
      turnId: "turn-1",
    });

    identity.start("read", "provider-call-1");
    expect(() => identity.start("bash", "provider-call-1")).toThrow(/reused.*different tool/i);
    expect(() => identity.complete("bash", "provider-call-1")).toThrow(/reused.*different tool/i);
  });

  it("pairs repeated id-less calls in FIFO order and keeps mixed explicit completion separate", () => {
    const identity = new NativeToolEventIdentity({
      providerId: "claude-code",
      kilnSessionId: "session-5",
      turnId: "turn-2",
    });

    const first = identity.start("read");
    const second = identity.start("read");
    const explicit = identity.complete("read", "provider-result-1");
    const firstResult = identity.complete("read");
    const secondResult = identity.complete("read");

    expect(second.toolCallId).not.toBe(first.toolCallId);
    expect(explicit).toMatchObject({ toolCallId: "provider-result-1", startRequired: true });
    expect(firstResult).toMatchObject({ toolCallId: first.toolCallId, startRequired: false });
    expect(secondResult).toMatchObject({ toolCallId: second.toolCallId, startRequired: false });
  });
});
