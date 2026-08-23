import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkBudget, checkTier } from "../../src/gateway/budget-middleware.js";

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeBillingConfig() {
  return {
    budgetEndpoint: "https://api.example.com/budget?tenantId={userId}",
    overBudgetMessage: "Budget exhausted.",
    headers: {
      "X-Gateway-Secret": "test-secret",
    },
    tiers: {
      free: { agents: ["fast"] },
      pro: { agents: ["fast", "coding"] },
    },
  };
}

describe("checkBudget", () => {
  it("returns allowed when API responds with allowed=true", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ allowed: true, remaining: 50000, unit: "tokens" }),
    } as Response);

    const result = await checkBudget(makeBillingConfig(), "kilvo-abc123");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(50000);
    expect(result.unit).toBe("tokens");
    expect(result.overBudgetMessage).toBeUndefined();
  });

  it("returns not allowed with overBudgetMessage when API responds with allowed=false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ allowed: false, remaining: 0, unit: "tokens", reason: "Monthly token quota exhausted" }),
    } as Response);

    const result = await checkBudget(makeBillingConfig(), "kilvo-abc123");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.unit).toBe("tokens");
    expect(result.overBudgetMessage).toBe("Budget exhausted.");
  });

  it("sends auth headers from billing config", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ allowed: true, remaining: 1000, unit: "tokens" }),
    } as Response);

    await checkBudget(makeBillingConfig(), "kilvo-abc123");

    const [, options] = mockFetch.mock.calls[0]!;
    const headers = (options as RequestInit).headers as Record<string, string>;
    expect(headers["X-Gateway-Secret"]).toBe("test-secret");
  });

  it("interpolates {userId} in endpoint URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ allowed: true, remaining: 1000, unit: "tokens" }),
    } as Response);

    await checkBudget(makeBillingConfig(), "kilvo-tenant1");

    const [calledUrl] = mockFetch.mock.calls[0]!;
    expect(calledUrl).toBe("https://api.example.com/budget?tenantId=kilvo-tenant1");
  });

  it("returns blocked on fetch error (fail-closed)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await checkBudget(makeBillingConfig(), "kilvo-abc123");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(-1);
    expect(result.unit).toBe("unknown");
  });

  it("returns blocked on non-OK response (fail-closed)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const result = await checkBudget(makeBillingConfig(), "kilvo-abc123");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(-1);
    expect(result.unit).toBe("unknown");
  });
});

describe("checkTier", () => {
  it("allows when tier is in plan's agents list", () => {
    const result = checkTier(makeBillingConfig(), "free", "fast");

    expect(result.allowed).toBe(true);
    expect(result.requestedTier).toBe("fast");
    expect(result.allowedTiers).toContain("fast");
  });

  it("rejects when tier is not in plan's agents list", () => {
    const result = checkTier(makeBillingConfig(), "free", "coding");

    expect(result.allowed).toBe(false);
    expect(result.requestedTier).toBe("coding");
    expect(result.allowedTiers).not.toContain("coding");
  });

  it("allows pro plan to use coding tier", () => {
    const result = checkTier(makeBillingConfig(), "pro", "coding");

    expect(result.allowed).toBe(true);
    expect(result.allowedTiers).toContain("fast");
    expect(result.allowedTiers).toContain("coding");
  });

  it("allows when no tiers configured (fail-open)", () => {
    const billing = {
      budgetEndpoint: "https://api.example.com/budget?tenantId={userId}",
      overBudgetMessage: "Budget exhausted.",
    };

    const result = checkTier(billing, "free", "reasoning");

    expect(result.allowed).toBe(true);
    expect(result.allowedTiers).toHaveLength(0);
  });

  it("allows when plan not found in tiers (fail-open)", () => {
    const result = checkTier(makeBillingConfig(), "enterprise", "reasoning");

    expect(result.allowed).toBe(true);
    expect(result.requestedTier).toBe("reasoning");
    expect(result.allowedTiers).toHaveLength(0);
  });
});
