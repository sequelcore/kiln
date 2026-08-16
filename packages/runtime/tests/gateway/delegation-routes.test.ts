import { describe, it, expect, vi } from "vitest";
import type { ProviderAdapter } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { createDelegationRoutes } from "../../src/gateway/delegation-routes.js";
import type { DelegationRegistry, DelegationTarget } from "../../src/gateway/delegation-handler.js";

function makeMockProvider(content: string = '{"recommendation":"use TypeScript"}'): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      parts: textParts(content),
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function makeTarget(appName: string, content?: string): DelegationTarget {
  return { appName, provider: makeMockProvider(content), systemPrompt: `You are ${appName}.` };
}

function makeRegistry(...targets: DelegationTarget[]): DelegationRegistry {
  return { targets: new Map(targets.map((t) => [t.appName, t])) };
}

const validSchema = {
  type: "object",
  required: ["recommendation"],
  properties: {
    recommendation: { type: "string" },
  },
};

const validBody = {
  fromApp: "app-a",
  toApp: "app-b",
  task: "Should we use TypeScript?",
  schema: validSchema,
};

describe("createDelegationRoutes", () => {
  describe("POST /delegate", () => {
    it("returns 200 with AppDelegationResult for valid request", async () => {
      const registry = makeRegistry(makeTarget("app-b"));
      const app = createDelegationRoutes({ registry });

      const res = await app.request("/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        delegationId: string;
        fromApp: string;
        toApp: string;
        result: Record<string, unknown>;
        tokenUsage: { inputTokens: number; outputTokens: number };
        durationMs: number;
      };
      expect(body.fromApp).toBe("app-a");
      expect(body.toApp).toBe("app-b");
      expect(body.result).toEqual({ recommendation: "use TypeScript" });
      expect(body.tokenUsage.inputTokens).toBe(200);
      expect(body.tokenUsage.outputTokens).toBe(100);
      expect(typeof body.delegationId).toBe("string");
      expect(typeof body.durationMs).toBe("number");
    });

    it("returns 400 when fromApp is missing", async () => {
      const registry = makeRegistry(makeTarget("app-b"));
      const app = createDelegationRoutes({ registry });

      const res = await app.request("/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toApp: "app-b", task: "hello", schema: validSchema }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("fromApp");
    });

    it("returns 400 when toApp is missing", async () => {
      const registry = makeRegistry(makeTarget("app-b"));
      const app = createDelegationRoutes({ registry });

      const res = await app.request("/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromApp: "app-a", task: "hello", schema: validSchema }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("toApp");
    });

    it("returns 400 when task is missing", async () => {
      const registry = makeRegistry(makeTarget("app-b"));
      const app = createDelegationRoutes({ registry });

      const res = await app.request("/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromApp: "app-a", toApp: "app-b", schema: validSchema }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("task");
    });

    it("returns 400 when schema is missing", async () => {
      const registry = makeRegistry(makeTarget("app-b"));
      const app = createDelegationRoutes({ registry });

      const res = await app.request("/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromApp: "app-a", toApp: "app-b", task: "hello" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("schema");
    });

    it("returns 404 when target app not found", async () => {
      const registry = makeRegistry(); // empty registry
      const app = createDelegationRoutes({ registry });

      const res = await app.request("/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; code: string };
      expect(body.code).toBe("TARGET_APP_NOT_FOUND");
    });

    it("returns 408 on timeout", async () => {
      const slowProvider: ProviderAdapter = {
        name: "slow-mock",
        createMessage: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 500)),
        ),
        streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
      };
      const target: DelegationTarget = {
        appName: "app-b",
        provider: slowProvider,
        systemPrompt: "You are app-b.",
      };
      const registry = makeRegistry(target);
      const app = createDelegationRoutes({ registry });

      const res = await app.request("/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validBody, timeout: 50 }),
      });

      expect(res.status).toBe(408);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("TIMEOUT");
    });

    it("returns 422 when response fails schema validation", async () => {
      // Provider returns '{}' which is missing required "recommendation" field
      const registry = makeRegistry(makeTarget("app-b", "{}"));
      const app = createDelegationRoutes({ registry });

      const res = await app.request("/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string; error: string };
      expect(body.code).toBe("SCHEMA_VALIDATION_FAILED");
    });

    it("returns 502 when provider throws", async () => {
      const failingProvider: ProviderAdapter = {
        name: "failing-mock",
        createMessage: vi.fn().mockRejectedValue(new Error("Provider connection refused")),
        streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
      };
      const target: DelegationTarget = {
        appName: "app-b",
        provider: failingProvider,
        systemPrompt: "You are app-b.",
      };
      const registry = makeRegistry(target);
      const app = createDelegationRoutes({ registry });

      const res = await app.request("/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(502);
      const body = (await res.json()) as { code: string; error: string };
      expect(body.code).toBe("PROVIDER_ERROR");
      expect(body.error).toContain("Provider connection refused");
    });
  });

  describe("GET /delegation-targets", () => {
    it("returns list of available target names", async () => {
      const registry = makeRegistry(
        makeTarget("arete-ai"),
        makeTarget("codeson-ai"),
        makeTarget("anvil-ai"),
      );
      const app = createDelegationRoutes({ registry });

      const res = await app.request("/delegation-targets");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { targets: string[] };
      expect(body.targets).toHaveLength(3);
      expect(body.targets).toContain("arete-ai");
      expect(body.targets).toContain("codeson-ai");
      expect(body.targets).toContain("anvil-ai");
    });

    it("returns empty list when no targets registered", async () => {
      const registry = makeRegistry();
      const app = createDelegationRoutes({ registry });

      const res = await app.request("/delegation-targets");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { targets: string[] };
      expect(body.targets).toHaveLength(0);
    });
  });
});
