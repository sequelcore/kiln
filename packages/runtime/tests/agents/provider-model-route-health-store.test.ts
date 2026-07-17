import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ProviderModelRouteHealthStore } from "../../src/agents/provider-route-health/index.js";

describe("ProviderModelRouteHealthStore", () => {
  it("persists route cooldown records without embedding credentials", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "kiln-route-health-"));
    const store = new ProviderModelRouteHealthStore({ rootDir });

    const record = await store.recordOutcome({
      providerId: "openrouter",
      modelId: "qwen/qwen3-coder:free",
      outcome: { type: "rate-limited" },
      errorMessage: "openrouter API error 429",
    });

    expect(record.cooldownUntil).toBeGreaterThan(Date.now());
    expect(await store.evaluateRouteHealth("openrouter", "qwen/qwen3-coder:free")).toMatchObject({
      healthy: false,
      reason: "Provider 'openrouter' model 'qwen/qwen3-coder:free' is cooling down after rate-limited",
    });
    expect(await readFile(join(rootDir, "openrouter.json"), "utf8")).toContain("qwen/qwen3-coder:free");
  });

  it("returns healthy for routes without prior failures", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "kiln-route-health-"));
    const store = new ProviderModelRouteHealthStore({ rootDir });

    await expect(store.evaluateRouteHealth("openrouter", "openrouter/free")).resolves.toEqual({
      healthy: true,
    });
  });

  it("round-trips route-specific failure evidence without converting it to a credential outcome", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "kiln-route-health-"));
    const store = new ProviderModelRouteHealthStore({ rootDir });

    await store.recordOutcome({
      providerId: "opencode-go",
      modelId: "kimi-k2-7-code",
      outcome: { type: "request-incompatible", reason: "invalid function name" },
      errorMessage: "opencode-go API error 400",
    });

    const reloaded = new ProviderModelRouteHealthStore({ rootDir });
    await expect(reloaded.readRouteHealth("opencode-go", "kimi-k2-7-code")).resolves.toMatchObject({
      cooldownUntil: null,
      lastOutcome: { type: "request-incompatible", reason: "invalid function name" },
    });
  });
});
