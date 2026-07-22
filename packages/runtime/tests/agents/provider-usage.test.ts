import { describe, expect, it, vi } from "vitest";
import {
  InMemoryProviderUsageStore,
  parseCodexProviderUsage,
} from "../../src/agents/provider-usage/index.js";
import { CodexProviderUsageReader } from "../../src/agents/provider-usage/codex-provider-usage-reader.js";
import { FileProviderUsageStore } from "../../src/agents/provider-usage/file-provider-usage-store.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSERVED_AT = "2026-07-22T12:00:00.000Z";
const VALID_UNTIL = "2026-07-22T12:05:00.000Z";

describe("Codex provider usage adapter", () => {
  it("sanitizes a /wham/usage snapshot", () => {
    const snapshot = parseCodexProviderUsage({
      provider: "codex-oauth",
      credentialId: "credential-opaque-1",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      body: {
        plan_type: "plus",
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: { used_percent: 37.5, reset_at: 1784725200 },
          secondary_window: { used_percent: 82, reset_at: 1785326400 },
        },
        access_token: "must-not-survive",
        email: "operator@example.test",
      },
    });

    expect(snapshot).toEqual({
      provider: "codex-oauth",
      credentialId: "credential-opaque-1",
      plan: "plus",
      primary: { usedPercent: 37.5, resetsAt: "2026-07-22T13:00:00.000Z" },
      secondary: { usedPercent: 82, resetsAt: "2026-07-29T12:00:00.000Z" },
      availability: "available",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      source: "provider-endpoint",
      confidence: "authoritative",
    });
    expect(JSON.stringify(snapshot)).not.toContain("operator@example.test");
    expect(JSON.stringify(snapshot)).not.toContain("must-not-survive");
  });

  it("parses Codex rate-limit headers without retaining raw headers", () => {
    const snapshot = parseCodexProviderUsage({
      provider: "codex-oauth",
      credentialId: "credential-opaque-2",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      headers: {
        "x-codex-primary-used-percent": "100",
        "x-codex-primary-reset-at": "1784725200",
        "x-codex-secondary-used-percent": "65",
        "x-codex-secondary-reset-at": "1785326400",
        authorization: "Bearer must-not-survive",
        "x-private-debug": "operator@example.test",
      },
    });

    expect(snapshot).toMatchObject({
      credentialId: "credential-opaque-2",
      availability: "exhausted",
      source: "provider-response-headers",
      confidence: "authoritative",
      primary: { usedPercent: 100, resetsAt: "2026-07-22T13:00:00.000Z" },
      secondary: { usedPercent: 65, resetsAt: "2026-07-29T12:00:00.000Z" },
    });
    expect(JSON.stringify(snapshot)).not.toContain("Bearer");
    expect(JSON.stringify(snapshot)).not.toContain("operator@example.test");
  });

  it("fails soft to explicit unknown for malformed evidence", () => {
    expect(parseCodexProviderUsage({
      provider: "codex-oauth",
      credentialId: "credential-opaque-3",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      body: { plan_type: 123, rate_limit: { primary_window: { used_percent: "many" } } },
      headers: { "x-codex-primary-used-percent": "not-a-number" },
    })).toEqual({
      provider: "codex-oauth",
      credentialId: "credential-opaque-3",
      availability: "unknown",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      source: "unknown",
      confidence: "unknown",
    });
  });

  it("does not promote arbitrary plan metadata into the sanitized snapshot", () => {
    const snapshot = parseCodexProviderUsage({
      provider: "codex-oauth",
      credentialId: "credential-opaque-4",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      body: {
        plan_type: "operator@example.test",
        rate_limit: { allowed: true, limit_reached: false },
      },
    });

    expect(snapshot.plan).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain("operator@example.test");
  });
});

describe("provider usage store", () => {
  it("keeps only sanitized snapshots keyed by provider and opaque credential id", () => {
    const store = new InMemoryProviderUsageStore();
    const first = parseCodexProviderUsage({
      provider: "codex-oauth",
      credentialId: "credential-opaque-1",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      body: { plan_type: "free", rate_limit: { allowed: true, limit_reached: false } },
    });
    store.put(first);

    const now = new Date("2026-07-22T12:01:00.000Z");
    expect(store.get("codex-oauth", "credential-opaque-1", now)).toEqual(first);
    expect(store.list("codex-oauth", now)).toEqual([first]);
    expect(store.get("codex-oauth", "missing", now)).toBeUndefined();
  });

  it("re-sanitizes structurally compatible input before storage", () => {
    const store = new InMemoryProviderUsageStore();
    store.put({
      provider: "codex-oauth",
      credentialId: "credential-opaque-1",
      availability: "unknown",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      source: "unknown",
      confidence: "unknown",
      token: "must-not-survive",
      email: "operator@example.test",
    } as any);

    const stored = store.get(
      "codex-oauth",
      "credential-opaque-1",
      new Date("2026-07-22T12:01:00.000Z"),
    );
    expect(JSON.stringify(stored)).not.toContain("must-not-survive");
    expect(JSON.stringify(stored)).not.toContain("operator@example.test");
  });

  it("does not return expired evidence", () => {
    const store = new InMemoryProviderUsageStore();
    store.put(parseCodexProviderUsage({
      provider: "codex-oauth",
      credentialId: "credential-opaque-1",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      body: { rate_limit: { allowed: true, limit_reached: false } },
    }));

    expect(store.get("codex-oauth", "credential-opaque-1", new Date("2026-07-22T12:05:01.000Z"))).toBeUndefined();
    expect(store.list(undefined, new Date("2026-07-22T12:05:01.000Z"))).toEqual([]);
  });
});

describe("Codex provider usage reader", () => {
  it("resolves the selected credential immediately before the request and persists only sanitized evidence", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "kiln-provider-usage-"));
    try {
      const store = new FileProviderUsageStore({ rootDir });
      const resolveCredential = vi.fn(async () => ({
        credentialId: "credential-opaque-1",
        accessToken: "secret-token",
        chatgptAccountId: "account-secret",
      }));
      const fetch = vi.fn(async () => new Response(JSON.stringify({
        plan_type: "plus",
        rate_limit: { allowed: true, limit_reached: false, primary_window: { used_percent: 12, reset_at: 1784725200 } },
        email: "operator@example.test",
      }), { status: 200, headers: { authorization: "must-not-survive" } }));
      const reader = new CodexProviderUsageReader({ fetch, store, now: () => new Date(OBSERVED_AT) });

      const snapshot = await reader.read({ provider: "codex-oauth", credentialId: "credential-opaque-1", resolveCredential });
      expect(resolveCredential).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith("https://chatgpt.com/backend-api/wham/usage", expect.objectContaining({ method: "GET" }));
      expect(snapshot).toMatchObject({ plan: "plus", availability: "available" });
      const persisted = await readFile(join(rootDir, "provider-usage", "codex-oauth.json"), "utf8");
      expect(persisted).not.toMatch(/secret-token|account-secret|operator@example\.test|authorization/i);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("fails soft to unknown and persists no transport error details", async () => {
    const store = new InMemoryProviderUsageStore();
    const reader = new CodexProviderUsageReader({
      fetch: async () => { throw new Error("secret transport failure"); },
      store,
      now: () => new Date(OBSERVED_AT),
    });
    const snapshot = await reader.read({
      provider: "codex-oauth",
      credentialId: "credential-opaque-2",
      resolveCredential: async () => ({ credentialId: "credential-opaque-2", accessToken: "secret", chatgptAccountId: "account" }),
    });
    expect(snapshot).toMatchObject({ availability: "unknown", source: "unknown", confidence: "unknown" });
    expect(JSON.stringify(snapshot)).not.toContain("secret transport failure");
  });
});
