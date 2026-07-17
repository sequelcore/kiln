import { describe, it, expect, beforeEach } from "vitest";
import type {
  AgentResponse,
  AgentStreamEvent,
  CreateMessageOptions,
  ProviderAdapter,
} from "../../src/agents/index.js";
import {
  CredentialPool,
  AllCredentialsExhaustedError,
  PooledProviderAdapter,
  isOk,
  isRetryable,
  isAuthError,
  getResetAt,
  computeCooldownUntil,
  DEFAULT_COOLDOWN_POLICY,
  createCooldownPolicy,
} from "../../src/agents/credential-pool/index.js";
import { textPart } from "../../src/engine/domain/content.js";

type TestAuth = { readonly apiKey: string };

function makeMessageOptions(): CreateMessageOptions {
  return {
    system: "system",
    messages: [{ role: "user", parts: [textPart("hello")] }],
  };
}

function makeResponse(text: string): AgentResponse {
  return {
    parts: [textPart(text)],
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: [],
    stopReason: "stop",
  };
}

class TestProviderError extends Error {
  constructor(
    message: string,
    readonly outcome: "rate-limited" | "auth-failed" | "unknown-error",
  ) {
    super(message);
  }
}

class TestAdapter implements ProviderAdapter {
  readonly name: string;

  constructor(
    readonly auth: TestAuth,
    private readonly createMessageHandler: (auth: TestAuth) => Promise<AgentResponse>,
    private readonly streamMessageHandler?: (auth: TestAuth) => AsyncGenerator<AgentStreamEvent>,
  ) {
    this.name = `test-${auth.apiKey}`;
  }

  createMessage(): Promise<AgentResponse> {
    return this.createMessageHandler(this.auth);
  }

  streamMessage(): AsyncGenerator<AgentStreamEvent> {
    if (!this.streamMessageHandler) {
      throw new Error("stream handler missing");
    }
    return this.streamMessageHandler(this.auth);
  }
}

describe("CredentialPool", () => {
  let pool: CredentialPool<TestAuth>;

  beforeEach(() => {
    pool = new CredentialPool<TestAuth>("test-provider", {
      strategy: "fill-first",
    });
  });

  describe("addCredential", () => {
    it("adds a credential to the pool", () => {
      pool.addCredential("cred-1", "Test Credential", { apiKey: "key-1" });
      const snapshot = pool.snapshot();
      expect(snapshot.entries).toHaveLength(1);
      expect(snapshot.entries[0]!.id).toBe("cred-1");
      expect(snapshot.entries[0]!.label).toBe("Test Credential");
    });

    it("adds credential with priority and tier", () => {
      pool.addCredential("cred-1", "Test", { apiKey: "key-1" }, {
        priority: 10,
        tier: "premium",
      });
      const entry = pool.snapshot().entries[0]!;
      expect(entry.priority).toBe(10);
      expect(entry.tier).toBe("premium");
    });
  });

  describe("acquire", () => {
    it("acquires a credential successfully", () => {
      pool.addCredential("cred-1", "Test", { apiKey: "key-1" });
      const lease = pool.acquire();
      expect(lease.credentialId).toBe("cred-1");
      expect(lease.auth.apiKey).toBe("key-1");
      expect(lease.providerId).toBe("test-provider");
    });

    it("throws AllCredentialsExhaustedError when pool is empty", () => {
      expect(() => pool.acquire()).toThrow(AllCredentialsExhaustedError);
    });

    it("throws AllCredentialsExhaustedError when all credentials in cooldown", () => {
      pool.addCredential("cred-1", "Test", { apiKey: "key-1" });
      pool.addCredential("cred-2", "Test 2", { apiKey: "key-2" });

      const lease1 = pool.acquire();
      pool.report(lease1, { type: "rate-limited" });

      const lease2 = pool.acquire();
      pool.report(lease2, { type: "rate-limited" });

      expect(() => pool.acquire()).toThrow(AllCredentialsExhaustedError);
    });

    it("clears expired cooldown on acquisition", () => {
      pool = new CredentialPool<TestAuth>("test-provider", {
        credentials: [{
          id: "cred-1",
          label: "Test",
          providerId: "test-provider",
          source: "manual",
          priority: 0,
          auth: { apiKey: "key-1" },
          requestCount: 1,
          lastSuccess: null,
          lastExhausted: Date.now() - 2 * 60 * 60 * 1000,
          cooldownUntil: Date.now() - 60 * 1000,
          invalidReason: null,
          softLeaseCount: 0,
        }],
      });

      const lease = pool.acquire();

      expect(lease.credentialId).toBe("cred-1");
      expect(pool.snapshot().entries[0]!.cooldownUntil).toBeNull();
    });

    it("moves to next credential after exhaustion with fill-first", () => {
      pool.setStrategy("fill-first");
      pool.addCredential("cred-1", "First", { apiKey: "key-1" });
      pool.addCredential("cred-2", "Second", { apiKey: "key-2" });

      const lease1 = pool.acquire();
      expect(lease1.credentialId).toBe("cred-1");

      pool.report(lease1, { type: "rate-limited" });

      const lease2 = pool.acquire();
      expect(lease2.credentialId).toBe("cred-2");
    });

    it("keeps using the first available credential with fill-first until exhaustion", () => {
      pool.setStrategy("fill-first");
      pool.addCredential("cred-1", "First", { apiKey: "key-1" });
      pool.addCredential("cred-2", "Second", { apiKey: "key-2" });

      expect(pool.acquire().credentialId).toBe("cred-1");
      expect(pool.acquire().credentialId).toBe("cred-1");
      expect(pool.acquire().credentialId).toBe("cred-1");
    });

    it("selects lower priority credentials first regardless of insertion order", () => {
      pool.setStrategy("fill-first");
      pool.addCredential("cred-2", "Second", { apiKey: "key-2" }, { priority: 20 });
      pool.addCredential("cred-1", "First", { apiKey: "key-1" }, { priority: 10 });

      expect(pool.acquire().credentialId).toBe("cred-1");
    });

    it("rotates through credentials with round-robin", () => {
      pool.setStrategy("round-robin");
      pool.addCredential("cred-1", "First", { apiKey: "key-1" });
      pool.addCredential("cred-2", "Second", { apiKey: "key-2" });

      const lease1 = pool.acquire();
      const lease2 = pool.acquire();
      const lease3 = pool.acquire();

      expect(lease1.credentialId).toBe("cred-1");
      expect(lease2.credentialId).toBe("cred-2");
      expect(lease3.credentialId).toBe("cred-1");
    });

    it("selects random credential with random strategy", () => {
      pool.setStrategy("random");
      pool.addCredential("cred-1", "First", { apiKey: "key-1" });
      pool.addCredential("cred-2", "Second", { apiKey: "key-2" });
      pool.addCredential("cred-3", "Third", { apiKey: "key-3" });

      const selected = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const lease = pool.acquire();
        selected.add(lease.credentialId);
      }

      expect(selected.size).toBeGreaterThan(1);
    });

    it("selects least-used credential with least-used strategy", () => {
      pool.setStrategy("least-used");
      pool.addCredential("cred-1", "First", { apiKey: "key-1" });
      pool.addCredential("cred-2", "Second", { apiKey: "key-2" });

      pool.acquire();
      pool.report(pool.acquire(), { type: "ok" });
      pool.report(pool.acquire(), { type: "ok" });

      const lease = pool.acquire();
      expect(lease.credentialId).toBe("cred-1");
    });
  });

  describe("report", () => {
    it("records success and clears cooldown", () => {
      pool.addCredential("cred-1", "Test", { apiKey: "key-1" });
      const lease = pool.acquire();

      pool.report(lease, { type: "rate-limited" });
      expect(pool.snapshot().entries[0]!.health).toBe("exhausted");

      pool.report(lease, { type: "ok" });
      expect(pool.snapshot().entries[0]!.health).toBe("ok");
    });

    it("applies default 1h cooldown on rate-limited", () => {
      pool.addCredential("cred-1", "Test", { apiKey: "key-1" });
      const lease = pool.acquire();

      const before = Date.now();
      pool.report(lease, { type: "rate-limited" });
      const after = Date.now();

      const entry = pool.snapshot().entries[0]!;
      expect(entry.cooldownUntil).toBeGreaterThan(before);
      expect(entry.cooldownUntil).toBeLessThanOrEqual(after + 60 * 60 * 1000);
    });

    it("uses server-supplied resetAt to override default cooldown", () => {
      pool.addCredential("cred-1", "Test", { apiKey: "key-1" });
      const lease = pool.acquire();

      const resetAt = Date.now() + 30 * 60 * 1000;
      pool.report(lease, { type: "rate-limited", resetAt });

      const entry = pool.snapshot().entries[0]!;
      expect(entry.cooldownUntil).toBeLessThanOrEqual(resetAt + 1000);
    });

    it("does not cap server-supplied resetAt to the default cooldown", () => {
      pool.addCredential("cred-1", "Test", { apiKey: "key-1" });
      const lease = pool.acquire();

      const resetAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
      pool.report(lease, { type: "rate-limited", resetAt });

      const entry = pool.snapshot().entries[0]!;
      expect(entry.cooldownUntil).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    });

    it("applies cooldown on quota-exceeded", () => {
      pool.addCredential("cred-1", "Test", { apiKey: "key-1" });
      const lease = pool.acquire();

      pool.report(lease, { type: "quota-exceeded" });

      expect(pool.snapshot().entries[0]!.health).toBe("exhausted");
    });

    it("applies cooldown on connection-failed", () => {
      pool.addCredential("cred-1", "Test", { apiKey: "key-1" });
      const lease = pool.acquire();

      pool.report(lease, { type: "connection-failed" });

      expect(pool.snapshot().entries[0]!.health).toBe("exhausted");
    });

    it("does not throw on auth-failed", () => {
      pool.addCredential("cred-1", "Test", { apiKey: "key-1" });
      const lease = pool.acquire();

      expect(() => pool.report(lease, { type: "auth-failed" })).not.toThrow();
    });

    it("permanently invalidates auth-failed credentials until credentials are reloaded", () => {
      pool.addCredential("cred-1", "Test", { apiKey: "key-1" });
      const lease = pool.acquire();

      pool.report(lease, { type: "auth-failed" });

      const entry = pool.snapshot().entries[0]!;
      expect(entry.lastSuccess).toBeNull();
      expect(entry.requestCount).toBe(1);
      expect(entry.health).toBe("invalid");
      expect(() => pool.acquire()).toThrow(AllCredentialsExhaustedError);
    });

    it("increments request count on success", () => {
      pool.addCredential("cred-1", "Test", { apiKey: "key-1" });

      pool.acquire();
      pool.report(pool.acquire(), { type: "ok" });
      pool.acquire();
      pool.report(pool.acquire(), { type: "ok" });

      expect(pool.snapshot().entries[0]!.requestCount).toBe(2);
    });

    it("notifies the state port with the same cooldown value stored in the snapshot", () => {
      const reportedCooldowns: Array<number | null> = [];
      const releasedCredentialIds: string[] = [];
      pool = new CredentialPool<TestAuth>("test-provider", {
        statePort: {
          onCredentialAdded: () => {},
          onCredentialRemoved: () => {},
          onLeaseAcquired: () => {},
          onLeaseReleased: (credentialId) => {
            releasedCredentialIds.push(credentialId);
          },
          onOutcomeReported: (_credentialId, _outcome, cooldownUntil) => {
            reportedCooldowns.push(cooldownUntil);
          },
          onSelectionStrategyChanged: () => {},
        },
      });
      pool.addCredential("cred-1", "Test", { apiKey: "key-1" });

      const lease = pool.acquire();
      pool.report(lease, { type: "rate-limited" });

      expect(releasedCredentialIds).toEqual(["cred-1"]);
      expect(reportedCooldowns).toEqual([pool.snapshot().entries[0]!.cooldownUntil]);
    });
  });

  describe("snapshot returns health without secrets", () => {
    it("snapshot does not expose auth values", () => {
      pool.addCredential("cred-1", "Test", { apiKey: "secret-key" });

      const snapshot = pool.snapshot();

      expect(snapshot.entries[0]!.health).toBe("ok");
    });
  });
});

describe("PooledProviderAdapter", () => {
  function createPool(): CredentialPool<TestAuth> {
    const pool = new CredentialPool<TestAuth>("test-provider", {
      strategy: "fill-first",
    });
    pool.addCredential("cred-1", "First", { apiKey: "key-1" });
    pool.addCredential("cred-2", "Second", { apiKey: "key-2" });
    return pool;
  }

  function mapError(error: unknown) {
    if (error instanceof TestProviderError) {
      if (error.outcome === "rate-limited") {
        return { type: "rate-limited" as const };
      }
      if (error.outcome === "auth-failed") {
        return { type: "auth-failed" as const };
      }
      return { type: "unknown-error" as const, message: error.message };
    }
    return { type: "unknown-error" as const };
  }

  it("retries createMessage with the next credential on a retryable outcome", async () => {
    const pool = createPool();
    const calls: string[] = [];
    const adapter = new PooledProviderAdapter<TestAuth>({
      name: "pooled-test",
      pool,
      createAdapter: (auth) => new TestAdapter(auth, async (usedAuth) => {
        calls.push(usedAuth.apiKey);
        if (usedAuth.apiKey === "key-1") {
          throw new TestProviderError("rate limited", "rate-limited");
        }
        return makeResponse("ok");
      }),
      mapError,
    });

    const response = await adapter.createMessage(makeMessageOptions());

    expect(response.parts).toEqual([textPart("ok")]);
    expect(calls).toEqual(["key-1", "key-2"]);
    expect(pool.snapshot().entries.find((entry) => entry.id === "cred-1")?.health).toBe("exhausted");
    expect(pool.snapshot().entries.find((entry) => entry.id === "cred-2")?.requestCount).toBe(1);
  });

  it("wraps single-credential exhaustion as AllCredentialsExhaustedError", async () => {
    const pool = new CredentialPool<TestAuth>("test-provider");
    pool.addCredential("cred-1", "Only", { apiKey: "key-1" });
    const providerError = new TestProviderError("rate limited", "rate-limited");
    const adapter = new PooledProviderAdapter<TestAuth>({
      name: "pooled-test",
      pool,
      createAdapter: (auth) => new TestAdapter(auth, async () => {
        throw providerError;
      }),
      mapError,
    });

    await expect(adapter.createMessage(makeMessageOptions())).rejects.toMatchObject({
      name: "AllCredentialsExhaustedError",
      cause: providerError,
      lastOutcome: { type: "rate-limited" },
      diagnostic: {
        providerId: "test-provider",
        reason: "attempts-exhausted",
        totalCredentials: 1,
        availableCredentials: 0,
        unavailableCredentials: 1,
        lastOutcome: { type: "rate-limited" },
        entries: [
          expect.objectContaining({
            id: "cred-1",
            health: "exhausted",
            requestCount: 1,
          }),
        ],
      },
    });
  });

  it("propagates auth failures without retrying", async () => {
    const pool = createPool();
    const calls: string[] = [];
    const providerError = new TestProviderError("auth failed", "auth-failed");
    const adapter = new PooledProviderAdapter<TestAuth>({
      name: "pooled-test",
      pool,
      createAdapter: (auth) => new TestAdapter(auth, async (usedAuth) => {
        calls.push(usedAuth.apiKey);
        throw providerError;
      }),
      mapError,
    });

    await expect(adapter.createMessage(makeMessageOptions())).rejects.toBe(providerError);
    expect(calls).toEqual(["key-1"]);
    expect(pool.snapshot().entries[0]!.lastSuccess).toBeNull();
  });

  it("propagates unknown errors without retrying", async () => {
    const pool = createPool();
    const calls: string[] = [];
    const providerError = new TestProviderError("unknown", "unknown-error");
    const adapter = new PooledProviderAdapter<TestAuth>({
      name: "pooled-test",
      pool,
      createAdapter: (auth) => new TestAdapter(auth, async (usedAuth) => {
        calls.push(usedAuth.apiKey);
        throw providerError;
      }),
      mapError,
    });

    await expect(adapter.createMessage(makeMessageOptions())).rejects.toBe(providerError);
    expect(calls).toEqual(["key-1"]);
  });

  it("discards partial stream output from failed attempts and reruns the stream", async () => {
    const pool = createPool();
    const adapter = new PooledProviderAdapter<TestAuth>({
      name: "pooled-test",
      pool,
      createAdapter: (auth) => new TestAdapter(
        auth,
        async () => makeResponse("unused"),
        async function* stream(usedAuth) {
          if (usedAuth.apiKey === "key-1") {
            yield { type: "text", content: "partial" };
            throw new TestProviderError("rate limited", "rate-limited");
          }
          yield { type: "text", content: "complete" };
          yield { type: "done", content: "" };
        },
      ),
      mapError,
    });

    const events: AgentStreamEvent[] = [];
    for await (const event of adapter.streamMessage(makeMessageOptions())) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text", content: "complete" },
      { type: "done", content: "" },
    ]);
  });
});

describe("CredentialOutcome utilities", () => {
  it("isOk returns true for ok outcome", () => {
    expect(isOk({ type: "ok" })).toBe(true);
    expect(isOk({ type: "rate-limited" })).toBe(false);
  });

  it("isRetryable returns true for rate-limited and quota-exceeded", () => {
    expect(isRetryable({ type: "ok" })).toBe(false);
    expect(isRetryable({ type: "rate-limited" })).toBe(true);
    expect(isRetryable({ type: "quota-exceeded" })).toBe(true);
    expect(isRetryable({ type: "connection-failed" })).toBe(true);
    expect(isRetryable({ type: "auth-failed" })).toBe(false);
  });

  it("isAuthError returns true for auth-failed", () => {
    expect(isAuthError({ type: "auth-failed" })).toBe(true);
    expect(isAuthError({ type: "ok" })).toBe(false);
  });

  it("getResetAt returns resetAt from rate-limited", () => {
    expect(getResetAt({ type: "rate-limited", resetAt: 12345 })).toBe(12345);
    expect(getResetAt({ type: "rate-limited" })).toBe(null);
    expect(getResetAt({ type: "ok" })).toBe(null);
  });
});

describe("AllCredentialsExhaustedError", () => {
  it("captures cause and lastOutcome", () => {
    const error = new AllCredentialsExhaustedError(
      new Error("Rate limited"),
      { type: "rate-limited" },
    );
    expect(error.message).toBe("All credentials in the pool are exhausted");
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.lastOutcome?.type).toBe("rate-limited");
  });

  it("captures a secret-free structured diagnostic", () => {
    const error = new AllCredentialsExhaustedError(
      undefined,
      { type: "quota-exceeded" },
      {
        providerId: "test-provider",
        reason: "all-credentials-unavailable",
        totalCredentials: 1,
        availableCredentials: 0,
        unavailableCredentials: 1,
        lastOutcome: { type: "quota-exceeded" },
        entries: [{
          id: "cred-1",
          label: "Primary",
          source: "manual",
          health: "exhausted",
          requestCount: 3,
          lastSuccess: null,
          lastExhausted: 1000,
          cooldownUntil: 2000,
        }],
      },
    );

    expect(error.diagnostic).toEqual({
      providerId: "test-provider",
      reason: "all-credentials-unavailable",
      totalCredentials: 1,
      availableCredentials: 0,
      unavailableCredentials: 1,
      lastOutcome: { type: "quota-exceeded" },
      entries: [{
        id: "cred-1",
        label: "Primary",
        source: "manual",
        health: "exhausted",
        requestCount: 3,
        lastSuccess: null,
        lastExhausted: 1000,
        cooldownUntil: 2000,
      }],
    });
    expect(JSON.stringify(error.diagnostic)).not.toContain("apiKey");
  });
});

describe("CooldownPolicy", () => {
  it("computes cooldown with default 1h", () => {
    const result = computeCooldownUntil(DEFAULT_COOLDOWN_POLICY, null);
    const expectedMin = Date.now() + 60 * 60 * 1000;
    expect(result).toBeLessThanOrEqual(expectedMin + 1000);
    expect(result).toBeGreaterThanOrEqual(expectedMin - 1000);
  });

  it("respects server resetAt when in future", () => {
    const policy = createCooldownPolicy({ defaultCooldownMs: 60 * 60 * 1000 });
    const resetAt = Date.now() + 30 * 60 * 1000;
    const result = computeCooldownUntil(policy, resetAt);
    expect(result).toBeLessThanOrEqual(resetAt + 1000);
  });

  it("only caps server resetAt when maxCooldownMs is explicitly configured", () => {
    const policy = createCooldownPolicy({
      defaultCooldownMs: 60 * 60 * 1000,
      maxCooldownMs: 2 * 60 * 60 * 1000,
    });
    const result = computeCooldownUntil(policy, Date.now() + 7 * 24 * 60 * 60 * 1000);
    expect(result).toBeLessThanOrEqual(Date.now() + 2 * 60 * 60 * 1000 + 1000);
  });
});
