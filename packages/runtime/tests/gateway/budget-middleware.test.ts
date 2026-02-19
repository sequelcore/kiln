import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkBudget, reportUsage, checkTier } from "../../src/gateway/budget-middleware.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeBillingConfig() {
  return {
    budgetEndpoint: "https://api.example.com/users/{userId}/ai-budget",
    usageEndpoint: "https://api.example.com/users/{userId}/ai-usage",
    overBudgetMessage: "Budget exhausted.",
    tiers: {
      free: { agents: ["fast"] },
      pro: { agents: ["fast", "coding"] },
    },
  };
}

describe("checkBudget", () => {
  it("returns allowed when remaining > 0", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ remaining: 50000, unit: "tokens" }),
    } as Response);

    const result = await checkBudget(makeBillingConfig(), "user-123");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(50000);
    expect(result.unit).toBe("tokens");
    expect(result.overBudgetMessage).toBeUndefined();
  });

  it("returns not allowed with overBudgetMessage when remaining <= 0", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ remaining: 0, unit: "tokens" }),
    } as Response);

    const result = await checkBudget(makeBillingConfig(), "user-123");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.unit).toBe("tokens");
    expect(result.overBudgetMessage).toBe("Budget exhausted.");
  });

  it("returns not allowed when remaining is negative", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ remaining: -100, unit: "tokens" }),
    } as Response);

    const result = await checkBudget(makeBillingConfig(), "user-456");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(-100);
  });

  it("interpolates {userId} in endpoint URL", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ remaining: 1000, unit: "requests" }),
    } as Response);

    await checkBudget(makeBillingConfig(), "user-abc");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.example.com/users/user-abc/ai-budget",
    );
  });

  it("returns allowed on fetch error (fail-open)", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("Network error"));

    const result = await checkBudget(makeBillingConfig(), "user-123");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(-1);
    expect(result.unit).toBe("unknown");
  });

  it("returns allowed on non-OK response (fail-open)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const result = await checkBudget(makeBillingConfig(), "user-123");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(-1);
    expect(result.unit).toBe("unknown");
  });
});

describe("reportUsage", () => {
  it("sends POST with correct body", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
    } as Response);

    const usage = { tokens: 1500, model: "claude-sonnet-4-6", role: "coding" };
    await reportUsage(makeBillingConfig(), "user-123", usage);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.example.com/users/user-123/ai-usage",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(usage),
      },
    );
  });

  it("does not throw on fetch error", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("Network error"));

    const usage = { tokens: 500, model: "claude-haiku-4-5-20251001", role: "fast" };
    await expect(reportUsage(makeBillingConfig(), "user-123", usage)).resolves.toBeUndefined();
  });

  it("interpolates {userId} in endpoint URL", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
    } as Response);

    const usage = { tokens: 200, model: "claude-opus-4-6", role: "reasoning" };
    await reportUsage(makeBillingConfig(), "user-xyz", usage);

    const [calledUrl] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(calledUrl).toBe("https://api.example.com/users/user-xyz/ai-usage");
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
      budgetEndpoint: "https://api.example.com/users/{userId}/ai-budget",
      usageEndpoint: "https://api.example.com/users/{userId}/ai-usage",
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
