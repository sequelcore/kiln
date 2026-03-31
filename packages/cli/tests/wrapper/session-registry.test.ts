import { describe, it, expect } from "vitest";
import {
  SessionRegistry,
  createDefaultRegistry,
  SessionUnavailableError,
  translatePermission,
} from "../../src/wrapper/session-registry.js";
import type { SessionCapabilities, IKilnSession } from "../../src/wrapper/session.js";

const makeMockSession = (id: string): IKilnSession => ({
  sessionId: id,
  capabilities: {
    mcp: true,
    streaming: true,
    resume: false,
    costTrackingMode: "native",
    supportedTools: [],
    maxContextTokens: null,
    priority: 1,
    fallbackTo: null,
    permissionPolicy: { approval: "ask", sandbox: "none" },
  },
  run: async function* () {
    yield { type: "completed", totalUsd: 0, durationMs: 0, isError: false, isPreflightCrash: false };
  },
  dispose: async () => {},
});

const MOCK_CAPA: SessionCapabilities = {
  mcp: true,
  streaming: true,
  resume: false,
  costTrackingMode: "native",
  supportedTools: [],
  maxContextTokens: null,
  priority: 1,
  fallbackTo: null,
  permissionPolicy: { approval: "ask", sandbox: "none" },
};

const MOCK_CAPA_CODEX: SessionCapabilities = {
  ...MOCK_CAPA,
  mcp: false,
  costTrackingMode: "computed",
  priority: 3,
};

describe("SessionRegistry", () => {
  const makeRegistry = (): SessionRegistry =>
    new SessionRegistry([
      {
        id: "claude",
        costTier: "high",
        capabilities: MOCK_CAPA,
        create: (id) => makeMockSession(String(id)),
      },
      {
        id: "codex",
        costTier: "low",
        capabilities: MOCK_CAPA_CODEX,
        create: (id) => makeMockSession(String(id)),
      },
      {
        id: "opencode",
        costTier: "medium",
        capabilities: MOCK_CAPA,
        create: (id) => makeMockSession(String(id)),
      },
    ]);

  describe("registry construction", () => {
    it("createDefaultRegistry returns a SessionRegistry", () => {
      const { registry } = createDefaultRegistry();
      expect(registry).toBeInstanceOf(SessionRegistry);
    });

    it("list() returns 3 providers with health healthy", () => {
      const { registry } = createDefaultRegistry();
      const providers = registry.list();
      expect(providers).toHaveLength(3);
      const ids = providers.map((p) => p.id).sort();
      expect(ids).toEqual(["claude", "codex", "opencode"]);
      for (const p of providers) {
        expect(p.health).toBe("healthy");
      }
    });

    it("list() includes costTier and capabilities", () => {
      const { registry } = createDefaultRegistry();
      const providers = registry.list();
      for (const p of providers) {
        expect(p.costTier).toBeTruthy();
        expect(p.capabilities).toBeTruthy();
        expect(p.capabilities.priority).toBeGreaterThan(0);
      }
    });
  });

  describe("selectBest — capability filtering", () => {
    it("requiresMcp=true excludes codex (mcp: false)", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({ requiresMcp: true });
      expect(result.primary).toBe("claude");
      expect(result.scores.find((s) => s.id === "codex")?.excluded).toBe(true);
      expect(result.scores.find((s) => s.id === "codex")?.exclusionReason).toContain("MCP");
    });

    it("requiresStreaming=true excludes nothing (all support it)", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({ requiresStreaming: true });
      expect(result.primary).toBe("claude");
    });

    it("requiresResume=true excludes all → throws SessionUnavailableError", () => {
      const reg = makeRegistry();
      expect(() => reg.selectBest({ requiresResume: true })).toThrow(SessionUnavailableError);
    });

    it("SessionUnavailableError contains requirements and scores", () => {
      const reg = makeRegistry();
      try {
        reg.selectBest({ requiresResume: true });
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SessionUnavailableError);
        const e = err as SessionUnavailableError;
        expect(e.requirements.requiresResume).toBe(true);
        expect(e.scores).toHaveLength(3);
      }
    });
  });

  describe("selectBest — scoring", () => {
    it("preferredProvider=claude → claude is primary", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({ preferredProvider: "claude" });
      expect(result.primary).toBe("claude");
      expect(result.scores.find((s) => s.id === "claude")?.score).toBeGreaterThan(
        result.scores.find((s) => s.id === "opencode")!.score,
      );
    });

    it("preferredProvider=codex → codex is primary even though priority is 3", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({ preferredProvider: "codex" });
      expect(result.primary).toBe("codex");
    });

    it("no preferences → claude is primary (priority 1 wins)", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({});
      expect(result.primary).toBe("claude");
    });

    it("maxCostTier=low → only codex satisfies, codex is primary", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({ maxCostTier: "low" });
      expect(result.primary).toBe("codex");
    });

    it("maxCostTier=low → cost tier is a score modifier, not a hard exclusion", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({ maxCostTier: "low" });
      expect(result.scores.find((s) => s.id === "claude")?.excluded).toBe(false);
      expect(result.scores.find((s) => s.id === "opencode")?.excluded).toBe(false);
      expect(result.scores.find((s) => s.id === "codex")?.excluded).toBe(false);
      expect(result.scores.find((s) => s.id === "codex")?.score).toBeGreaterThan(
        result.scores.find((s) => s.id === "opencode")!.score,
      );
    });

    it("scores include reasons array", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({});
      for (const score of result.scores) {
        expect(Array.isArray(score.reasons)).toBe(true);
        expect(score.reasons.length).toBeGreaterThan(0);
      }
    });
  });

  describe("selectBest — fallback ordering", () => {
    it("no preferences → orderedFallbacks = [opencode, codex] (priority order)", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({});
      expect(result.primary).toBe("claude");
      expect(result.orderedFallbacks).toEqual(["opencode", "codex"]);
    });

    it("preferredProvider=codex → orderedFallbacks = [claude, opencode]", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({ preferredProvider: "codex" });
      expect(result.primary).toBe("codex");
      expect(result.orderedFallbacks).toContain("claude");
      expect(result.orderedFallbacks).toContain("opencode");
      expect(result.orderedFallbacks).not.toContain("codex");
    });

    it("all scores returned in SelectionResult.scores", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({});
      expect(result.scores).toHaveLength(3);
      const ids = result.scores.map((s) => s.id).sort();
      expect(ids).toEqual(["claude", "codex", "opencode"]);
    });
  });

  describe("circuit breaker — state transitions", () => {
    it("3× reportFailure(false) → getHealth returns suppressed", () => {
      const reg = makeRegistry();
      reg.reportFailure("claude", false);
      reg.reportFailure("claude", false);
      reg.reportFailure("claude", false);
      expect(reg.getHealth("claude")).toBe("suppressed");
    });

    it("after 3 failures, codex is excluded from selectBest", () => {
      const reg = makeRegistry();
      reg.reportFailure("claude", false);
      reg.reportFailure("claude", false);
      reg.reportFailure("claude", false);
      const result = reg.selectBest({});
      expect(result.primary).not.toBe("claude");
      expect(result.orderedFallbacks).not.toContain("claude");
    });

    it("getHealth returns suppressed before suppressUntil elapses", () => {
      const reg = makeRegistry();
      reg.reportFailure("claude", false);
      reg.reportFailure("claude", false);
      reg.reportFailure("claude", false);
      expect(reg.getHealth("claude")).toBe("suppressed");
    });

    it("reportSuccess resets failure count when closed", () => {
      const reg = makeRegistry();
      reg.reportFailure("claude", false);
      reg.reportFailure("claude", false);
      reg.reportSuccess("claude");
      reg.reportFailure("claude", false);
      reg.reportFailure("claude", false);
      expect(reg.getHealth("claude")).toBe("healthy");
    });

    it("reportFailure with isPreflightCrash=true counts as failure", () => {
      const reg = makeRegistry();
      reg.reportFailure("claude", true);
      reg.reportFailure("claude", false);
      reg.reportFailure("claude", false);
      expect(reg.getHealth("claude")).toBe("suppressed");
    });

    it("suppressed provider excluded from selectBest", () => {
      const reg = makeRegistry();
      for (let i = 0; i < 3; i++) reg.reportFailure("claude", false);
      const result = reg.selectBest({});
      expect(result.primary).toBe("opencode");
      expect(result.orderedFallbacks).not.toContain("claude");
    });

    it("if primary is suppressed, next priority becomes primary", () => {
      const reg = makeRegistry();
      for (let i = 0; i < 3; i++) reg.reportFailure("claude", false);
      const result = reg.selectBest({});
      expect(result.primary).toBe("opencode");
    });
  });

  describe("circuit breaker — half-open transition", () => {
    it("after suppressUntil elapses → getHealth returns half-open", () => {
      const reg = makeRegistry();
      for (let i = 0; i < 3; i++) reg.reportFailure("claude", false);
      const cb = (reg as unknown as { circuitBreakers: Map<string, { suppressUntil: number | null }> }).circuitBreakers.get("claude")!;
      cb.suppressUntil = Date.now() - 1;
      expect(reg.getHealth("claude")).toBe("half-open");
    });

    it("reportSuccess in half-open → getHealth returns healthy", () => {
      const reg = makeRegistry();
      for (let i = 0; i < 3; i++) reg.reportFailure("claude", false);
      const cb = (reg as unknown as { circuitBreakers: Map<string, { suppressUntil: number | null }> }).circuitBreakers.get("claude")!;
      cb.suppressUntil = Date.now() - 1;
      reg.getHealth("claude");
      reg.reportSuccess("claude");
      expect(reg.getHealth("claude")).toBe("healthy");
    });

    it("reportFailure in half-open → getHealth returns suppressed (reopen)", () => {
      const reg = makeRegistry();
      for (let i = 0; i < 3; i++) reg.reportFailure("claude", false);
      const cb = (reg as unknown as { circuitBreakers: Map<string, { suppressUntil: number | null }> }).circuitBreakers.get("claude")!;
      cb.suppressUntil = Date.now() - 1;
      reg.getHealth("claude");
      reg.reportFailure("claude", false);
      expect(reg.getHealth("claude")).toBe("suppressed");
    });
  });

  describe("session creation", () => {
    const policy = { approval: "ask" as const, sandbox: "none" as const };

    it("createSession(claude) returns an IKilnSession", () => {
      const reg = makeRegistry();
      const session = reg.createSession("claude", { task: "test", permissionPolicy: policy });
      expect(typeof session.run).toBe("function");
      expect(typeof session.dispose).toBe("function");
      expect(typeof session.sessionId).toBe("string");
    });

    it("createSession(codex) returns an IKilnSession", () => {
      const reg = makeRegistry();
      const session = reg.createSession("codex", { task: "test", permissionPolicy: policy });
      expect(typeof session.run).toBe("function");
      expect(typeof session.dispose).toBe("function");
    });

    it("createSession(opencode) returns an IKilnSession", () => {
      const reg = makeRegistry();
      const session = reg.createSession("opencode", { task: "test", permissionPolicy: policy });
      expect(typeof session.run).toBe("function");
      expect(typeof session.dispose).toBe("function");
    });

    it("createSession with unknown id throws Error", () => {
      const reg = makeRegistry();
      expect(() => reg.createSession("unknown" as never, { task: "test", permissionPolicy: policy })).toThrow("Unknown provider");
    });
  });

  describe("createDefaultRegistry", () => {
    it("returns registry with all 3 providers", () => {
      const { registry } = createDefaultRegistry();
      const providers = registry.list();
      expect(providers).toHaveLength(3);
    });

    it("claude provider has costTier high and priority 1", () => {
      const { registry } = createDefaultRegistry();
      const claude = registry.list().find((p) => p.id === "claude")!;
      expect(claude.costTier).toBe("high");
      expect(claude.capabilities.priority).toBe(1);
      expect(claude.capabilities.mcp).toBe(true);
    });

    it("codex provider has costTier low and priority 3", () => {
      const { registry } = createDefaultRegistry();
      const codex = registry.list().find((p) => p.id === "codex")!;
      expect(codex.costTier).toBe("low");
      expect(codex.capabilities.priority).toBe(3);
      expect(codex.capabilities.mcp).toBe(false);
    });

    it("opencode provider has costTier medium and priority 2", () => {
      const { registry } = createDefaultRegistry();
      const opencode = registry.list().find((p) => p.id === "opencode")!;
      expect(opencode.costTier).toBe("medium");
      expect(opencode.capabilities.priority).toBe(2);
      expect(opencode.capabilities.mcp).toBe(true);
    });

    it("codex has costTrackingMode computed", () => {
      const { registry } = createDefaultRegistry();
      const codex = registry.list().find((p) => p.id === "codex")!;
      expect(codex.capabilities.costTrackingMode).toBe("computed");
    });

    it("all providers have permissionPolicy in capabilities", () => {
      const { registry } = createDefaultRegistry();
      for (const p of registry.list()) {
        expect(p.capabilities.permissionPolicy).toBeDefined();
        expect(p.capabilities.permissionPolicy.approval).toBeDefined();
        expect(p.capabilities.permissionPolicy.sandbox).toBeDefined();
      }
    });
  });

  describe("translatePermission — claude backend", () => {
    it("auto-approve + none → acceptEdits, skip false", () => {
      const result = translatePermission({ approval: "auto-approve", sandbox: "none" }, "claude");
      expect(result.backend).toBe("claude");
      const cfg = result.config as { permissionMode: string; allowDangerouslySkipPermissions: boolean };
      expect(cfg.permissionMode).toBe("acceptEdits");
      expect(cfg.allowDangerouslySkipPermissions).toBe(false);
    });

    it("auto-approve + workspace-write → bypassPermissions, skip true", () => {
      const result = translatePermission({ approval: "auto-approve", sandbox: "workspace-write" }, "claude");
      const cfg = result.config as { permissionMode: string; allowDangerouslySkipPermissions: boolean };
      expect(cfg.permissionMode).toBe("bypassPermissions");
      expect(cfg.allowDangerouslySkipPermissions).toBe(true);
    });

    it("auto-approve + full → bypassPermissions, skip true", () => {
      const result = translatePermission({ approval: "auto-approve", sandbox: "full" }, "claude");
      const cfg = result.config as { permissionMode: string; allowDangerouslySkipPermissions: boolean };
      expect(cfg.permissionMode).toBe("bypassPermissions");
      expect(cfg.allowDangerouslySkipPermissions).toBe(true);
    });

    it("ask + any → default, skip false", () => {
      for (const sandbox of ["none", "workspace-write", "full"] as const) {
        const result = translatePermission({ approval: "ask", sandbox }, "claude");
        const cfg = result.config as { permissionMode: string; allowDangerouslySkipPermissions: boolean };
        expect(cfg.permissionMode).toBe("default");
        expect(cfg.allowDangerouslySkipPermissions).toBe(false);
      }
    });

    it("deny + any → plan, skip false", () => {
      for (const sandbox of ["none", "workspace-write", "full"] as const) {
        const result = translatePermission({ approval: "deny", sandbox }, "claude");
        const cfg = result.config as { permissionMode: string; allowDangerouslySkipPermissions: boolean };
        expect(cfg.permissionMode).toBe("plan");
        expect(cfg.allowDangerouslySkipPermissions).toBe(false);
      }
    });
  });

  describe("translatePermission — codex backend", () => {
    it("auto-approve + none → on-request, workspace-write", () => {
      const result = translatePermission({ approval: "auto-approve", sandbox: "none" }, "codex");
      expect(result.backend).toBe("codex");
      const cfg = result.config as { approvalMode: string; sandboxMode: string };
      expect(cfg.approvalMode).toBe("on-request");
      expect(cfg.sandboxMode).toBe("workspace-write");
    });

    it("auto-approve + workspace-write → never, workspace-write", () => {
      const result = translatePermission({ approval: "auto-approve", sandbox: "workspace-write" }, "codex");
      const cfg = result.config as { approvalMode: string; sandboxMode: string };
      expect(cfg.approvalMode).toBe("never");
      expect(cfg.sandboxMode).toBe("workspace-write");
    });

    it("auto-approve + full → never, danger-full-access", () => {
      const result = translatePermission({ approval: "auto-approve", sandbox: "full" }, "codex");
      const cfg = result.config as { approvalMode: string; sandboxMode: string };
      expect(cfg.approvalMode).toBe("never");
      expect(cfg.sandboxMode).toBe("danger-full-access");
    });

    it("ask + any → on-request, workspace-write", () => {
      for (const sandbox of ["none", "workspace-write", "full"] as const) {
        const result = translatePermission({ approval: "ask", sandbox }, "codex");
        const cfg = result.config as { approvalMode: string; sandboxMode: string };
        expect(cfg.approvalMode).toBe("on-request");
        expect(cfg.sandboxMode).toBe("workspace-write");
      }
    });

    it("deny + any → untrusted, workspace-write", () => {
      for (const sandbox of ["none", "workspace-write", "full"] as const) {
        const result = translatePermission({ approval: "deny", sandbox }, "codex");
        const cfg = result.config as { approvalMode: string; sandboxMode: string };
        expect(cfg.approvalMode).toBe("untrusted");
        expect(cfg.sandboxMode).toBe("workspace-write");
      }
    });
  });

  describe("translatePermission — opencode backend", () => {
    it("auto-approve + none → ask", () => {
      const result = translatePermission({ approval: "auto-approve", sandbox: "none" }, "opencode");
      expect(result.backend).toBe("opencode");
      const cfg = result.config as { permissionDefault: string };
      expect(cfg.permissionDefault).toBe("ask");
    });

    it("auto-approve + workspace-write → allow", () => {
      const result = translatePermission({ approval: "auto-approve", sandbox: "workspace-write" }, "opencode");
      const cfg = result.config as { permissionDefault: string };
      expect(cfg.permissionDefault).toBe("allow");
    });

    it("auto-approve + full → allow", () => {
      const result = translatePermission({ approval: "auto-approve", sandbox: "full" }, "opencode");
      const cfg = result.config as { permissionDefault: string };
      expect(cfg.permissionDefault).toBe("allow");
    });

    it("ask + any → ask", () => {
      for (const sandbox of ["none", "workspace-write", "full"] as const) {
        const result = translatePermission({ approval: "ask", sandbox }, "opencode");
        const cfg = result.config as { permissionDefault: string };
        expect(cfg.permissionDefault).toBe("ask");
      }
    });

    it("deny + any → deny", () => {
      for (const sandbox of ["none", "workspace-write", "full"] as const) {
        const result = translatePermission({ approval: "deny", sandbox }, "opencode");
        const cfg = result.config as { permissionDefault: string };
        expect(cfg.permissionDefault).toBe("deny");
      }
    });
  });
});
