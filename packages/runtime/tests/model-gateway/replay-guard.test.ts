import { describe, expect, it } from "vitest";
import { InMemoryModelGatewayReplayGuard } from "../../src/model-gateway/replay-guard.js";

const fingerprintInput = (overrides: Record<string, unknown> = {}) => ({
  rawBody: '{"input":"hello"}', ingress: "openai-responses", tenantId: "tenant-a", applicationId: "app-a",
  callerId: "caller-a", sessionId: "ns-session", turnId: "ns-turn",
  route: { providerId: "provider", providerModelId: "model", scope: "scope" },
  toolExecutionMode: "caller-owned", affinityKey: "affinity-a", ...overrides,
});

describe("InMemoryModelGatewayReplayGuard", () => {
  it("distinguishes every trusted replay dimension and exact raw body", () => {
    const guard = new InMemoryModelGatewayReplayGuard({ hmacKey: "synthetic-test-key-with-32-bytes!!" });
    const original = guard.fingerprint(fingerprintInput());
    for (const changed of [
      { rawBody: '{ "input":"hello"}' }, { tenantId: "tenant-b" }, { applicationId: "app-b" }, { callerId: "caller-b" },
      { sessionId: "other-session" }, { turnId: "other-turn" }, { route: { providerId: "provider", providerModelId: "other", scope: "scope" } },
      { affinityKey: "affinity-b" },
    ]) expect(guard.fingerprint(fingerprintInput(changed))).not.toBe(original);
  });

  it("fences transitions, keeps active committed work beyond TTL, and expires completed values", () => {
    let now = 100;
    const guard = new InMemoryModelGatewayReplayGuard({ hmacKey: "synthetic-test-key-with-32-bytes!!", now: () => now, ttlMs: 1_000, createFence: (() => { let id = 0; return () => `f-${++id}`; })() });
    const key = guard.fingerprint(fingerprintInput());
    const first = guard.claim(key);
    expect(first.kind).toBe("dispatch");
    if (first.kind !== "dispatch") throw new Error("fixture");
    expect(guard.claim(key)).toMatchObject({ kind: "join-inflight", retryAfterSeconds: 1 });
    now = 1_101;
    const replacement = guard.claim(key);
    expect(replacement.kind).toBe("dispatch");
    expect(() => guard.markCommitted(key, first.fence)).toThrow("Stale replay fence");
    if (replacement.kind !== "dispatch") throw new Error("fixture");
    guard.markCommitted(key, replacement.fence);
    now = 1_000_000;
    expect(guard.claim(key)).toEqual({ kind: "committed-unknown" });
    guard.complete(key, replacement.fence, { responseId: "resp-1", result: { parts: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "completed" } });
    expect(guard.claim(key)).toMatchObject({ kind: "replay-completed", value: { responseId: "resp-1" } });
    now += 1_001;
    expect(guard.claim(key).kind).toBe("dispatch");
  });

  it("expires committed-unknown, sweeps expired entries, and fails closed without evicting live claims", () => {
    let now = 0;
    const guard = new InMemoryModelGatewayReplayGuard({ hmacKey: "capacity-test-key-with-32-bytes!!", now: () => now, ttlMs: 100, maxEntries: 2 });
    const firstKey = guard.fingerprint(fingerprintInput({ rawBody: "first" }));
    const secondKey = guard.fingerprint(fingerprintInput({ rawBody: "second" }));
    const thirdKey = guard.fingerprint(fingerprintInput({ rawBody: "third" }));
    const first = guard.claim(firstKey);
    if (first.kind !== "dispatch") throw new Error("fixture");
    guard.markCommitted(first.key, first.fence);
    guard.claim(secondKey);
    expect(() => guard.claim(thirdKey)).toThrow("capacity");
    expect(guard.claim(firstKey)).toEqual({ kind: "committed-unknown" });
    now = 101;
    expect(guard.claim(thirdKey).kind).toBe("dispatch");
    expect(guard.claim(firstKey)).toEqual({ kind: "committed-unknown" });
    guard.settleUnknown(firstKey, first.fence);
    now = 202;
    expect(guard.claim(firstKey).kind).toBe("dispatch");
  });

  it("requires strong typed key material and copies Uint8Array keys defensively", () => {
    for (const hmacKey of ["short", new Uint8Array(31), 42, null]) {
      expect(() => new InMemoryModelGatewayReplayGuard({ hmacKey: hmacKey as never })).toThrow("HMAC key");
    }
    expect(() => new InMemoryModelGatewayReplayGuard({ hmacKey: "é".repeat(16) })).not.toThrow();
    for (const maxEntries of [0, -1, 1.5, 1_000_001]) {
      expect(() => new InMemoryModelGatewayReplayGuard({ hmacKey: "max-entry-test-key-with-32-bytes!", maxEntries })).toThrow("maxEntries");
    }
    const mutable = new Uint8Array(32).fill(7);
    const guard = new InMemoryModelGatewayReplayGuard({ hmacKey: mutable });
    const before = guard.fingerprint(fingerprintInput());
    mutable.fill(9);
    expect(guard.fingerprint(fingerprintInput())).toBe(before);
  });
});
