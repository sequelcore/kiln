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
import { createTestFetch } from "../fetch-fixture.js";

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
          primary_window: { used_percent: 37.5, limit_window_seconds: 18_000, reset_at: 1784725200 },
          secondary_window: { used_percent: 82, limit_window_seconds: 604_800, reset_at: 1785326400 },
        },
        credits: { has_credits: true, unlimited: false, balance: "17.5" },
        spend_control: {
          reached: false,
          individual_limit: {
            limit: "25000",
            used: "8000",
            remaining_percent: 68,
            reset_at: 1784725200,
          },
        },
        access_token: "must-not-survive",
        email: "operator@example.test",
      },
    });

    expect(snapshot).toEqual({
      provider: "codex-oauth",
      credentialId: "credential-opaque-1",
      plan: "plus",
      primary: { bucketId: "primary", usedPercent: 37.5, windowDurationMinutes: 300, resetsAt: "2026-07-22T13:00:00.000Z" },
      secondary: { bucketId: "secondary", usedPercent: 82, windowDurationMinutes: 10_080, resetsAt: "2026-07-29T12:00:00.000Z" },
      credits: {
        status: "available",
        balance: {
          atoms: "175",
          scale: 1,
          unit: "credit",
          scheme: { kind: "credit", creditSchemeId: "codex-oauth" },
        },
      },
      spendControl: {
        status: "available",
        limit: { atoms: "25000", scale: 0, unit: "provider-spend-unit", scheme: { kind: "unit" } },
        used: { atoms: "8000", scale: 0, unit: "provider-spend-unit", scheme: { kind: "unit" } },
        remainingPercent: 68,
        resetsAt: "2026-07-22T13:00:00.000Z",
      },
      exhaustionReason: null,
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
      primary: { bucketId: "primary", usedPercent: 100, resetsAt: "2026-07-22T13:00:00.000Z" },
      secondary: { bucketId: "secondary", usedPercent: 65, resetsAt: "2026-07-29T12:00:00.000Z" },
    });
    expect(JSON.stringify(snapshot)).not.toContain("Bearer");
    expect(JSON.stringify(snapshot)).not.toContain("operator@example.test");
  });

  describe("reset-at plausibility", () => {
    // Sentinel from issue #48: seven distinct credentials all reported
    // `resets_at` of year 2099, labelled authoritative. That is ~73 years past
    // observation and cannot be a real billing-window end.
    const SENTINEL_RESET_SECONDS = 4_070_908_800; // 2099-01-01T00:00:00.000Z

    it("does not label a far-future reset instant authoritative", () => {
      const snapshot = parseCodexProviderUsage({
        provider: "codex-oauth",
        credentialId: "credential-opaque-sentinel",
        observedAt: OBSERVED_AT,
        validUntil: VALID_UNTIL,
        body: {
          plan_type: "plus",
          rate_limit: {
            allowed: true,
            limit_reached: false,
            primary_window: { used_percent: 5, reset_at: SENTINEL_RESET_SECONDS },
          },
        },
      });

      expect(snapshot).toMatchObject({
        source: "provider-endpoint",
        confidence: "unknown",
        availability: "available",
        primary: {
          bucketId: "primary",
          usedPercent: 5,
          resetsAt: "2099-01-01T00:00:00.000Z",
        },
      });
    });

    it("does not label a far-future header reset instant authoritative", () => {
      const snapshot = parseCodexProviderUsage({
        provider: "codex-oauth",
        credentialId: "credential-opaque-sentinel-h",
        observedAt: OBSERVED_AT,
        validUntil: VALID_UNTIL,
        headers: {
          "x-codex-primary-used-percent": "5",
          "x-codex-primary-reset-at": String(SENTINEL_RESET_SECONDS),
        },
      });

      expect(snapshot).toMatchObject({
        source: "provider-response-headers",
        confidence: "unknown",
        primary: { bucketId: "primary", usedPercent: 5, resetsAt: "2099-01-01T00:00:00.000Z" },
      });
    });

    it("keeps a plausible reset instant authoritative", () => {
      const snapshot = parseCodexProviderUsage({
        provider: "codex-oauth",
        credentialId: "credential-opaque-plausible",
        observedAt: OBSERVED_AT,
        validUntil: VALID_UNTIL,
        body: {
          plan_type: "plus",
          rate_limit: {
            allowed: true,
            limit_reached: false,
            primary_window: { used_percent: 5, reset_at: 1784725200 },
          },
        },
      });

      expect(snapshot).toMatchObject({
        source: "provider-endpoint",
        confidence: "authoritative",
        primary: { bucketId: "primary", usedPercent: 5, resetsAt: "2026-07-22T13:00:00.000Z" },
      });
    });

    it("downgrades the whole snapshot when only the secondary reset is implausible", () => {
      const snapshot = parseCodexProviderUsage({
        provider: "codex-oauth",
        credentialId: "credential-opaque-mixed",
        observedAt: OBSERVED_AT,
        validUntil: VALID_UNTIL,
        body: {
          rate_limit: {
            allowed: true,
            limit_reached: false,
            primary_window: { used_percent: 20, reset_at: 1784725200 },
            secondary_window: { used_percent: 60, reset_at: SENTINEL_RESET_SECONDS },
          },
        },
      });

      expect(snapshot).toMatchObject({
        source: "provider-endpoint",
        confidence: "unknown",
        primary: { usedPercent: 20, resetsAt: "2026-07-22T13:00:00.000Z" },
        secondary: { usedPercent: 60, resetsAt: "2099-01-01T00:00:00.000Z" },
      });
    });
  });

  describe("request outcome classification", () => {
    const credential = {
      credentialId: "credential-opaque-http",
      accessToken: "must-not-survive",
      chatgptAccountId: "account-must-not-survive",
    };

    function reader(fetchImpl: typeof globalThis.fetch) {
      return new CodexProviderUsageReader({
        fetch: fetchImpl,
        store: new InMemoryProviderUsageStore(),
        now: () => new Date(OBSERVED_AT),
      });
    }

    async function read(fetchImpl: typeof globalThis.fetch) {
      return reader(fetchImpl).read({
        provider: "codex-oauth",
        credentialId: credential.credentialId,
        resolveCredential: async () => credential,
      });
    }

    it("classifies a rejected request status instead of reporting absent usage", async () => {
      const snapshot = await read(createTestFetch(async () => new Response("forbidden", { status: 403 })));

      expect(snapshot).toMatchObject({
        availability: "unknown",
        source: "provider-request-failed",
        confidence: "unknown",
        httpStatus: 403,
      });
      expect(JSON.stringify(snapshot)).not.toContain("forbidden");
      expect(JSON.stringify(snapshot)).not.toContain("must-not-survive");
    });

    it("distinguishes an empty successful response from a failed request", async () => {
      const snapshot = await read(createTestFetch(async () => new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      })));

      expect(snapshot).toMatchObject({
        availability: "unknown",
        source: "unknown",
        confidence: "unknown",
      });
      expect(snapshot.httpStatus).toBeUndefined();
    });

    it("reports an uninterpretable response as unusable, never as unreachable", async () => {
      vi.resetModules();
      vi.doMock("../../src/agents/provider-usage/codex-provider-usage.js", () => ({
        parseCodexProviderUsage: () => { throw new TypeError("contract drift"); },
      }));
      const { CodexProviderUsageReader: Reader } = await import(
        "../../src/agents/provider-usage/codex-provider-usage-reader.js"
      );

      const snapshot = await new Reader({
        fetch: createTestFetch(async () => new Response("{}", { status: 200 })),
        store: new InMemoryProviderUsageStore(),
        now: () => new Date(OBSERVED_AT),
      }).read({
        provider: "codex-oauth",
        credentialId: credential.credentialId,
        resolveCredential: async () => credential,
      });

      expect(snapshot).toMatchObject({
        availability: "unknown",
        source: "provider-response-unusable",
        confidence: "unknown",
        httpStatus: 200,
      });
      expect(JSON.stringify(snapshot)).not.toContain("contract drift");
      vi.doUnmock("../../src/agents/provider-usage/codex-provider-usage.js");
      vi.resetModules();
    });

    it("separates an unusable credential from a failed request", async () => {
      const snapshot = await reader(createTestFetch(async () => new Response("{}", { status: 200 }))).read({
        provider: "codex-oauth",
        credentialId: credential.credentialId,
        resolveCredential: async () => { throw new Error("refresh rejected for operator@example.test"); },
      });

      expect(snapshot).toMatchObject({
        availability: "unknown",
        source: "credential-unavailable",
        confidence: "unknown",
      });
      expect(snapshot.httpStatus).toBeUndefined();
      expect(JSON.stringify(snapshot)).not.toContain("operator@example.test");
    });

    it("still reads rate-limit headers carried by a rejected response", async () => {
      const snapshot = await read(createTestFetch(async () => new Response("too many requests", {
        status: 429,
        headers: {
          "x-codex-primary-used-percent": "100",
          "x-codex-primary-reset-at": "1784725200",
        },
      })));

      expect(snapshot).toMatchObject({
        availability: "exhausted",
        source: "provider-response-headers",
        confidence: "authoritative",
        primary: { bucketId: "primary", usedPercent: 100 },
      });
    });

  });

  it("keeps a depleted credit balance interpretable", () => {
    // Codex reports a residual balance alongside `has_credits: false`. The
    // sanitized contract forbids a balance once credits are unavailable, so
    // constructing one made the whole snapshot unparseable.
    const snapshot = parseCodexProviderUsage({
      provider: "codex-oauth",
      credentialId: "credential-opaque-depleted",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      body: {
        rate_limit: { allowed: true, limit_reached: false },
        credits: { has_credits: false, unlimited: false, balance: "0" },
      },
    });

    expect(snapshot).toMatchObject({
      availability: "available",
      source: "provider-endpoint",
      credits: { status: "unavailable", balance: null },
    });
  });

  it("preserves provider exhaustion classification without raw payload details", () => {
    const snapshot = parseCodexProviderUsage({
      provider: "codex-oauth",
      credentialId: "credential-opaque-5",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      body: {
        plan_type: "team",
        rate_limit: { allowed: false, limit_reached: true },
        rate_limit_reached_type: { kind: "workspace_member_credits_depleted" },
      },
    });

    expect(snapshot).toMatchObject({
      availability: "exhausted",
      exhaustionReason: "workspace-member-credits-depleted",
    });
  });

  it("preserves exact credit decrements and spend-control exhaustion", () => {
    const available = parseCodexProviderUsage({
      provider: "codex-oauth",
      credentialId: "credential-opaque-6",
      observedAt: OBSERVED_AT,
      validUntil: VALID_UNTIL,
      body: {
        rate_limit: { allowed: true, limit_reached: false },
        credits: { has_credits: true, unlimited: false, balance: "17.500" },
        spend_control: {
          reached: false,
          individual_limit: { limit: "25.00", used: "8.125", remaining_percent: 67 },
        },
      },
    });
    const exhausted = parseCodexProviderUsage({
      provider: "codex-oauth",
      credentialId: "credential-opaque-6",
      observedAt: "2026-07-22T12:01:00.000Z",
      validUntil: "2026-07-22T12:06:00.000Z",
      body: {
        rate_limit: { allowed: true, limit_reached: false },
        credits: { has_credits: true, unlimited: false, balance: "16.375" },
        spend_control: {
          reached: true,
          individual_limit: { limit: "25.00", used: "25.00", remaining_percent: 0 },
        },
      },
    });

    expect(available.credits?.balance).toEqual({
      atoms: "175", scale: 1, unit: "credit",
      scheme: { kind: "credit", creditSchemeId: "codex-oauth" },
    });
    expect(exhausted.credits?.balance).toEqual({
      atoms: "16375", scale: 3, unit: "credit",
      scheme: { kind: "credit", creditSchemeId: "codex-oauth" },
    });
    expect(exhausted).toMatchObject({
      availability: "exhausted",
      exhaustionReason: "spend-control-reached",
      spendControl: {
        status: "exhausted",
        used: { atoms: "25", scale: 0 },
        remainingPercent: 0,
      },
    });
  });

  it("replaces an exhausted window with fresh provider rollover evidence", () => {
    const store = new InMemoryProviderUsageStore();
    store.put(parseCodexProviderUsage({
      provider: "codex-oauth",
      credentialId: "credential-opaque-7",
      observedAt: OBSERVED_AT,
      validUntil: "2026-07-22T13:00:00.000Z",
      body: {
        rate_limit: {
          allowed: false,
          limit_reached: true,
          primary_window: { used_percent: 100, limit_window_seconds: 18_000, reset_at: 1784725200 },
        },
      },
    }));
    store.put(parseCodexProviderUsage({
      provider: "codex-oauth",
      credentialId: "credential-opaque-7",
      observedAt: "2026-07-22T13:00:01.000Z",
      validUntil: "2026-07-22T13:05:01.000Z",
      body: {
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: { used_percent: 0, limit_window_seconds: 18_000, reset_at: 1784743200 },
        },
      },
    }));

    expect(store.get(
      "codex-oauth",
      "credential-opaque-7",
      new Date("2026-07-22T13:01:00.000Z"),
    )).toMatchObject({
      availability: "available",
      exhaustionReason: null,
      primary: {
        bucketId: "primary",
        usedPercent: 0,
        windowDurationMinutes: 300,
        resetsAt: "2026-07-22T18:00:00.000Z",
      },
    });
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
      exhaustionReason: null,
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
      exhaustionReason: null,
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
  it("retains expired file-backed snapshots for honest diagnostic projection", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "kiln-provider-usage-retained-"));
    try {
      const store = new FileProviderUsageStore({ rootDir });
      await store.put(parseCodexProviderUsage({
        provider: "codex-oauth",
        credentialId: "credential-retained",
        observedAt: OBSERVED_AT,
        validUntil: VALID_UNTIL,
        body: { rate_limit: { allowed: true, limit_reached: false } },
      }));

      await expect(store.list("codex-oauth", new Date("2026-07-22T12:06:00.000Z"))).resolves.toEqual([]);
      await expect(store.listRetained("codex-oauth")).resolves.toEqual([
        expect.objectContaining({ credentialId: "credential-retained", validUntil: VALID_UNTIL }),
      ]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("resolves the selected credential immediately before the request and persists only sanitized evidence", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "kiln-provider-usage-"));
    try {
      const store = new FileProviderUsageStore({ rootDir });
      const resolveCredential = vi.fn(async () => ({
        credentialId: "credential-opaque-1",
        accessToken: "secret-token",
        chatgptAccountId: "account-secret",
      }));
      const fetch = createTestFetch(vi.fn(async () => new Response(JSON.stringify({
        plan_type: "plus",
        rate_limit: { allowed: true, limit_reached: false, primary_window: { used_percent: 12, reset_at: 1784725200 } },
        email: "operator@example.test",
      }), { status: 200, headers: { authorization: "must-not-survive" } })));
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

  it("classifies a transport failure and persists no transport error details", async () => {
    const store = new InMemoryProviderUsageStore();
    const reader = new CodexProviderUsageReader({
      fetch: createTestFetch(async () => { throw new Error("secret transport failure"); }),
      store,
      now: () => new Date(OBSERVED_AT),
    });
    const snapshot = await reader.read({
      provider: "codex-oauth",
      credentialId: "credential-opaque-2",
      resolveCredential: async () => ({ credentialId: "credential-opaque-2", accessToken: "secret", chatgptAccountId: "account" }),
    });
    expect(snapshot).toMatchObject({
      availability: "unknown",
      source: "provider-request-failed",
      confidence: "unknown",
    });
    expect(snapshot.httpStatus).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain("secret transport failure");
  });
});
