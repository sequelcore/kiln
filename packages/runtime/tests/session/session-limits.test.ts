import { describe, it, expect } from "vitest";
import { textParts, validateTenantConfig } from "@kilnai/core";
import type { TenantConfig } from "@kilnai/core";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { serializeSession, deserializeSession } from "../../src/session/session-serializer.js";

function makeSession(): RuntimeSession {
  return new RuntimeSession({
    appName: "test-app",
    tenantId: "test-tenant",
    userId: "user-1",
    systemPrompt: "You are a test assistant.",
  });
}

function baseTenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "test-tenant",
    appName: "test-app",
    name: "Test Tenant",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("RuntimeSession token/turn tracking", () => {
  it("tracks userTurnCount via addUserMessage", () => {
    const session = makeSession();
    expect(session.userTurnCount).toBe(0);

    session.addUserMessage(textParts("hello"));
    expect(session.userTurnCount).toBe(1);

    session.addUserMessage(textParts("world"));
    expect(session.userTurnCount).toBe(2);
  });

  it("does not increment userTurnCount on addAssistantMessage", () => {
    const session = makeSession();
    session.addAssistantMessage(textParts("hi"));
    expect(session.userTurnCount).toBe(0);
  });

  it("accumulates tokens", () => {
    const session = makeSession();
    expect(session.totalTokens).toBe(0);

    session.accumulateTokens(100);
    expect(session.totalTokens).toBe(100);

    session.accumulateTokens(250);
    expect(session.totalTokens).toBe(350);
  });

  it("serializes and deserializes token and turn counts", () => {
    const session = makeSession();
    session.addUserMessage(textParts("hello"));
    session.addAssistantMessage(textParts("hi"));
    session.addUserMessage(textParts("how are you"));
    session.accumulateTokens(500);

    const json = serializeSession(session);
    const restored = deserializeSession(json);

    expect(restored.userTurnCount).toBe(2);
    expect(restored.totalTokens).toBe(500);
  });

  it("restores userTurnCount correctly (not double-counted from replay)", () => {
    const session = makeSession();
    session.addUserMessage(textParts("one"));
    session.addUserMessage(textParts("two"));
    session.addUserMessage(textParts("three"));
    expect(session.userTurnCount).toBe(3);

    const json = serializeSession(session);
    const restored = deserializeSession(json);

    // Should be 3, not 6 (would be 6 if replay incremented and we didn't override)
    expect(restored.userTurnCount).toBe(3);
  });
});

describe("SessionLimitsConfig validation", () => {
  it("accepts valid sessionLimits", () => {
    const errors = validateTenantConfig(baseTenant({ sessionLimits: { maxTokens: 50000, maxTurns: 50 } }));
    expect(errors.filter(e => e.field.startsWith("sessionLimits"))).toHaveLength(0);
  });

  it("rejects non-integer maxTokens", () => {
    const errors = validateTenantConfig(baseTenant({ sessionLimits: { maxTokens: 1.5 } }));
    expect(errors).toContainEqual({ field: "sessionLimits.maxTokens", message: "must be a positive integer" });
  });

  it("rejects zero maxTokens", () => {
    const errors = validateTenantConfig(baseTenant({ sessionLimits: { maxTokens: 0 } }));
    expect(errors).toContainEqual({ field: "sessionLimits.maxTokens", message: "must be a positive integer" });
  });

  it("rejects negative maxTurns", () => {
    const errors = validateTenantConfig(baseTenant({ sessionLimits: { maxTurns: -1 } }));
    expect(errors).toContainEqual({ field: "sessionLimits.maxTurns", message: "must be a positive integer" });
  });

  it("accepts undefined sessionLimits (optional)", () => {
    const errors = validateTenantConfig(baseTenant());
    expect(errors.filter(e => e.field.startsWith("sessionLimits"))).toHaveLength(0);
  });
});
