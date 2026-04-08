import { describe, expect, it } from "vitest";
import {
  SessionRegistry,
  createDefaultRegistry,
  SessionUnavailableError,
  isDirectApiProvider,
  translatePermission,
  translatePermissionForProvider,
} from "../../src/wrapper/session-registry.js";
import type { SessionCapabilities, IKilnSession, KilnPermissionPolicy } from "../../src/wrapper/session.js";

const makeMockSession = (id: string): IKilnSession => ({
  sessionId: id,
  capabilities: {
    mcp: true,
    streaming: true,
    resumable: false,
    resume: false,
    costTrackingMode: "native",
    supportedTools: [],
    maxContextTokens: null,
    priority: 1,
    fallbackTo: null,
    permissionPolicy: { approval: "on-request", sandbox: "read-only" },
  },
  run: async function* () {
    yield { type: "completed", totalUsd: 0, durationMs: 0, isError: false, isPreflightCrash: false };
  },
  dispose: async () => {},
  providerSessionId: undefined,
});

const BASE_POLICY: KilnPermissionPolicy = { approval: "on-request", sandbox: "read-only" };

const MOCK_CAPA: SessionCapabilities = {
  mcp: true,
  streaming: true,
  resumable: false,
  resume: false,
  costTrackingMode: "native",
  supportedTools: [],
  maxContextTokens: null,
  priority: 1,
  fallbackTo: null,
  permissionPolicy: BASE_POLICY,
};

const CAPABILITIES: Record<string, SessionCapabilities> = {
  claude: { ...MOCK_CAPA, priority: 1, mcp: true },
  opencode: { ...MOCK_CAPA, priority: 2, mcp: true },
  codex: { ...MOCK_CAPA, priority: 3, mcp: false, costTrackingMode: "computed" },
  anthropic: { ...MOCK_CAPA, priority: 4, mcp: false, costTrackingMode: "computed" },
  openai: { ...MOCK_CAPA, priority: 5, mcp: false, costTrackingMode: "computed" },
  openrouter: { ...MOCK_CAPA, priority: 6, mcp: false, costTrackingMode: "computed" },
  deepseek: { ...MOCK_CAPA, priority: 7, mcp: false, costTrackingMode: "computed" },
  ollama: { ...MOCK_CAPA, priority: 8, mcp: false, costTrackingMode: "computed" },
};

const COST_TIERS = {
  claude: "high",
  opencode: "medium",
  codex: "low",
  anthropic: "high",
  openai: "high",
  openrouter: "low",
  deepseek: "medium",
  ollama: "low",
} as const;

const ALL_PROVIDER_IDS = [
  "claude",
  "codex",
  "opencode",
  "anthropic",
  "openai",
  "deepseek",
  "openrouter",
  "ollama",
] as const;

const GRANULAR_POLICY = {
  approval: "on-request" as const,
  sandbox: "workspace-write" as const,
  tools: [{ tool: "Edit", action: "deny" as const }],
  commands: [{ pattern: "*", action: "allow" as const }],
  fileGovernance: { denyGlobs: ["**/.env"] },
  dataFirewall: [{ destination: "logs", action: "redact" as const }],
  agentScopes: [{ agent: "planner", inherit: false }],
};

function makeRegistry(ids: readonly string[] = ALL_PROVIDER_IDS): SessionRegistry {
  return new SessionRegistry(
    ids.map((id) => {
      const providerId = id as (typeof ALL_PROVIDER_IDS)[number];
      return {
        id: providerId,
        costTier: COST_TIERS[providerId],
        capabilities: CAPABILITIES[providerId],
      create: () => makeMockSession(id),
      };
    }),
  );
}

describe("SessionRegistry", () => {
  describe("provider helpers", () => {
    it("identifies direct API providers", () => {
      expect(isDirectApiProvider("openrouter")).toBe(true);
      expect(isDirectApiProvider("ollama")).toBe(true);
      expect(isDirectApiProvider("claude")).toBe(false);
      expect(isDirectApiProvider("codex")).toBe(false);
      expect(isDirectApiProvider("opencode")).toBe(false);
    });
  });

  describe("registry construction", () => {
    it("createDefaultRegistry returns a SessionRegistry", () => {
      const { registry } = createDefaultRegistry();
      expect(registry).toBeInstanceOf(SessionRegistry);
    });

    it("list() returns 8 providers with healthy status", () => {
      const { registry } = createDefaultRegistry();
      const providers = registry.list();
      expect(providers).toHaveLength(8);
      const ids = providers.map((p) => p.id).sort();
      expect(ids).toEqual([...ALL_PROVIDER_IDS].sort());
      for (const p of providers) {
        expect(p.health).toBe("healthy");
      }
    });

    it("list() iterates dynamic provider keys", () => {
      const registry = makeRegistry(["openai", "ollama"]);
      const providers = registry.list();
      expect(providers.map((p) => p.id)).toEqual(["openai", "ollama"]);
    });
  });

  describe("selectBest", () => {
    it("requiresMcp=true excludes all direct providers and codex", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({ requiresMcp: true });
      expect(result.primary).toBe("claude");
      expect(result.scores.find((s) => s.id === "codex")?.excluded).toBe(true);
      expect(result.scores.find((s) => s.id === "openai")?.excluded).toBe(true);
      expect(result.scores.find((s) => s.id === "ollama")?.excluded).toBe(true);
    });

    it("requiresResume=true excludes all providers and throws", () => {
      const reg = makeRegistry();
      expect(() => reg.selectBest({ requiresResume: true })).toThrow(SessionUnavailableError);
      try {
        reg.selectBest({ requiresResume: true });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SessionUnavailableError);
        const e = err as SessionUnavailableError;
        expect(e.scores).toHaveLength(8);
      }
    });

    it("preferred direct provider wins when available", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({ preferredProvider: "openrouter" });
      expect(result.primary).toBe("openrouter");
    });

    it("maxCostTier=low prefers codex among low-tier providers", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({ maxCostTier: "low" });
      expect(result.primary).toBe("codex");
    });

    it("selectBest iterates dynamic keys", () => {
      const reg = makeRegistry(["openai", "ollama"]);
      const result = reg.selectBest({});
      expect(result.primary).toBe("openai");
      expect(result.scores).toHaveLength(2);
    });
  });

  describe("circuit breaker parity", () => {
    it("suppresses provider after 3 failures", () => {
      const reg = makeRegistry();
      reg.reportFailure("claude", false);
      reg.reportFailure("claude", false);
      reg.reportFailure("claude", false);
      expect(reg.getHealth("claude")).toBe("suppressed");
    });

    it("suppressed primary is excluded from selectBest", () => {
      const reg = makeRegistry();
      for (let i = 0; i < 3; i++) reg.reportFailure("claude", false);
      const result = reg.selectBest({});
      expect(result.primary).toBe("opencode");
      expect(result.orderedFallbacks).not.toContain("claude");
    });

    it("half-open transitions to healthy on success", () => {
      const reg = makeRegistry();
      for (let i = 0; i < 3; i++) reg.reportFailure("claude", false);
      const cb = (
        reg as unknown as { circuitBreakers: Map<string, { suppressUntil: number | null }> }
      ).circuitBreakers.get("claude");
      if (!cb) {
        throw new Error("missing circuit breaker state");
      }
      cb.suppressUntil = Date.now() - 1;
      expect(reg.getHealth("claude")).toBe("half-open");
      reg.reportSuccess("claude");
      expect(reg.getHealth("claude")).toBe("healthy");
    });
  });

  describe("createDefaultRegistry direct providers", () => {
    it("registers direct provider descriptors with expected priority and cost tiers", () => {
      const { registry } = createDefaultRegistry();
      const anthropic = registry.list().find((p) => p.id === "anthropic");
      const openai = registry.list().find((p) => p.id === "openai");
      const openrouter = registry.list().find((p) => p.id === "openrouter");
      const deepseek = registry.list().find((p) => p.id === "deepseek");
      const ollama = registry.list().find((p) => p.id === "ollama");

      expect(anthropic?.costTier).toBe("high");
      expect(anthropic?.capabilities.priority).toBe(4);
      expect(openai?.costTier).toBe("high");
      expect(openai?.capabilities.priority).toBe(5);
      expect(openrouter?.costTier).toBe("low");
      expect(openrouter?.capabilities.priority).toBe(6);
      expect(deepseek?.costTier).toBe("medium");
      expect(deepseek?.capabilities.priority).toBe(7);
      expect(ollama?.costTier).toBe("low");
      expect(ollama?.capabilities.priority).toBe(8);
    });

    it("createSession(openai) returns an IKilnSession", () => {
      const { registry } = createDefaultRegistry();
      const session = registry.createSession("openai", {
        task: "test",
        permissionPolicy: BASE_POLICY,
      });
      expect(typeof session.run).toBe("function");
      expect(typeof session.dispose).toBe("function");
    });

    it("passes translated provider constraints into direct provider session", () => {
      const { registry } = createDefaultRegistry();
      const session = registry.createSession("openai", {
        task: "test",
        permissionPolicy: GRANULAR_POLICY,
      });
      const internal = session as unknown as {
        config?: { constraintInstructions?: readonly string[] };
      };
      expect(internal.config?.constraintInstructions?.length).toBeGreaterThan(0);
      expect(internal.config?.constraintInstructions?.[0]).toContain("Kiln policy constraints for openai");
    });
  });

  describe("translation contracts", () => {
    it("translatePermission keeps codex granular constraints visible", () => {
      const result = translatePermission(GRANULAR_POLICY, "codex");
      expect(result.representableRules).toHaveLength(0);
      expect(result.unsupportedRules.length).toBeGreaterThan(0);
      expect(result.constraintInstructions.length).toBeGreaterThan(1);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("translatePermissionForProvider emits constraints and warnings for direct providers", () => {
      const result = translatePermissionForProvider(GRANULAR_POLICY, "openai");
      expect(result.provider).toBe("openai");
      expect(result.unsupportedRules.length).toBeGreaterThan(0);
      expect(result.constraintInstructions.length).toBeGreaterThan(1);
      expect(result.constraintInstructions[0]).toContain("Kiln policy constraints for openai");
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});
