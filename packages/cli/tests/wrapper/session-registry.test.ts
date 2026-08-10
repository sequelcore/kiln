import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const osMockState = vi.hoisted(() => ({
  mockedHomedir: `${(process.env.TEMP ?? process.cwd()).replace(/\\/g, "/")}/kiln-session-registry-home-${process.pid}-${Date.now()}`,
}));
const TEST_HOME_DIR = osMockState.mockedHomedir;

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  const mocked = {
    ...actual,
    homedir: () => osMockState.mockedHomedir || actual.homedir(),
  };
  return {
    ...mocked,
    default: mocked,
  };
});

type MockOpenCodeAuthFile = {
  tier: "go" | "zen";
  api_key?: string | null;
} | null;

const DEFAULT_OPENCODE_API_KEY = "test-opencode-key";
const DEFAULT_OPENCODE_AUTH_FILE: Exclude<MockOpenCodeAuthFile, null> = {
  tier: "go",
  api_key: "stored-opencode-key",
};
const DEFAULT_CODEX_OAUTH_AVAILABLE = true;
const DIRECT_API_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY",
] as const;
const DIRECT_PROVIDER_MODELS = {
  "codex-oauth": "gpt-5.4",
  "opencode-go": "minimax-m2.5",
  "opencode-zen": "anthropic/claude-sonnet-4-6",
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  deepseek: "deepseek-chat",
  openrouter: "nvidia/nemotron-3-nano-30b-a3b:free",
  ollama: "llama3.1",
  lmstudio: "qwen/qwen3.5-9b",
} as const satisfies Record<
  Exclude<ProviderId, "claude" | "codex" | "opencode">,
  string
>;
const DEFAULT_DIRECT_API_ENV = Object.fromEntries(
  DIRECT_API_ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof DIRECT_API_ENV_KEYS)[number], string | undefined>;
const OPENCODE_AUTH_FILE_PATH = join(TEST_HOME_DIR, ".kiln", "auth", "opencode.json");
const CODEX_OAUTH_FILE_PATH = join(TEST_HOME_DIR, ".kiln", "auth", "codex-oauth.json");

const coreSurfaceMocks = vi.hoisted(() => {
  process.env.OPENCODE_API_KEY = "test-opencode-key";
  return {
    codexOauthAvailable: true,
    toolNames: ["MockRead", "MockWrite"],
    opencodeAuthFile: { tier: "go", api_key: "stored-opencode-key" } as MockOpenCodeAuthFile,
  };
});

const claudeSdkMocks = vi.hoisted(() => ({
  lastQuery: undefined as { options?: { env?: Record<string, string | undefined>; effort?: string } } | undefined,
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn((input: { options?: { env?: Record<string, string | undefined>; effort?: string } }) => {
    claudeSdkMocks.lastQuery = input;
    return (async function* () {
      yield { type: "result", total_cost_usd: 0, is_error: false };
    })();
  }),
}));

vi.mock("@kilnai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/core")>();
  return {
    ...actual,
    CodexOAuthAuth: class {
      async hasValidCredentials(): Promise<boolean> {
        return coreSurfaceMocks.codexOauthAvailable;
      }
    },
    OpenCodeAuth: class {
      async loadAuthFile(): Promise<MockOpenCodeAuthFile> {
        return coreSurfaceMocks.opencodeAuthFile
          ? { ...coreSurfaceMocks.opencodeAuthFile }
          : null;
      }
    },
    createDefaultBuiltinToolSurface: vi.fn(() => ({
      ...actual.createDefaultBuiltinToolSurface(),
      toolNames: coreSurfaceMocks.toolNames,
    })),
  };
});

import {
  SessionRegistry,
  createDefaultRegistry,
  SessionUnavailableError,
  getProviderDisplayInfo,
  getRuntimeProviderAvailability,
  isDirectApiProvider,
  translatePermission,
  translatePermissionForProvider,
  type ProviderId,
} from "../../src/wrapper/session-registry.js";
import type { SessionCapabilities, IKilnSession, KilnPermissionPolicy } from "../../src/wrapper/session.js";
import type { DeliberationResolution } from "@kilnai/core";
import { ProviderSession } from "../../src/wrapper/provider-session.js";

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
    yield { type: "completed", totalUsd: 0, durationMs: 0, outcome: "completed", isPreflightCrash: false };
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
  "codex-oauth": { ...MOCK_CAPA, priority: 1, mcp: false, costTrackingMode: "computed" },
  claude: { ...MOCK_CAPA, priority: 1, mcp: true },
  opencode: { ...MOCK_CAPA, priority: 2, mcp: true },
  codex: { ...MOCK_CAPA, priority: 3, mcp: true, costTrackingMode: "computed" },
  "opencode-go": { ...MOCK_CAPA, priority: 2, mcp: false, costTrackingMode: "computed" },
  "opencode-zen": { ...MOCK_CAPA, priority: 3, mcp: false, costTrackingMode: "computed" },
  anthropic: { ...MOCK_CAPA, priority: 4, mcp: false, costTrackingMode: "computed" },
  openai: { ...MOCK_CAPA, priority: 5, mcp: false, costTrackingMode: "computed" },
  openrouter: { ...MOCK_CAPA, priority: 6, mcp: false, costTrackingMode: "computed" },
  deepseek: { ...MOCK_CAPA, priority: 7, mcp: false, costTrackingMode: "computed" },
  ollama: { ...MOCK_CAPA, priority: 8, mcp: false, costTrackingMode: "computed" },
  lmstudio: { ...MOCK_CAPA, priority: 9, mcp: false, costTrackingMode: "computed" },
};

const COST_TIERS = {
  "codex-oauth": "low",
  claude: "high",
  opencode: "medium",
  codex: "low",
  "opencode-go": "low",
  "opencode-zen": "medium",
  anthropic: "high",
  openai: "high",
  openrouter: "low",
  deepseek: "medium",
  ollama: "low",
  lmstudio: "low",
} as const;

const ALL_PROVIDER_IDS = [
  "codex-oauth",
  "opencode-go",
  "opencode-zen",
  "claude",
  "codex",
  "opencode",
  "anthropic",
  "openai",
  "deepseek",
  "openrouter",
  "ollama",
  "lmstudio",
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
        deliberationTransport: "none" as const,
        costTier: COST_TIERS[providerId],
        capabilities: CAPABILITIES[providerId],
        create: () => makeMockSession(id),
      };
    }),
  );
}

async function importSessionRegistryWithOpenCodeAuth(options: {
  readonly envApiKey?: string;
  readonly authFile: MockOpenCodeAuthFile;
}) {
  writeOpenCodeAuthFile(options.authFile ? { ...options.authFile } : null);
  if (options.envApiKey === undefined) {
    delete process.env.OPENCODE_API_KEY;
  } else {
    process.env.OPENCODE_API_KEY = options.envApiKey;
  }
  vi.resetModules();
  return import("../../src/wrapper/session-registry.js");
}

function restoreOpenCodeAuthDefaults(): void {
  process.env.OPENCODE_API_KEY = DEFAULT_OPENCODE_API_KEY;
  coreSurfaceMocks.codexOauthAvailable = DEFAULT_CODEX_OAUTH_AVAILABLE;
  coreSurfaceMocks.opencodeAuthFile = { ...DEFAULT_OPENCODE_AUTH_FILE };
  writeOpenCodeAuthFile({ ...DEFAULT_OPENCODE_AUTH_FILE });
  writeCodexOauthFile(true);
}

function writeOpenCodeAuthFile(authFile: MockOpenCodeAuthFile): void {
  mkdirSync(join(TEST_HOME_DIR, ".kiln", "auth"), { recursive: true });
  if (!authFile) {
    rmSync(OPENCODE_AUTH_FILE_PATH, { force: true });
    return;
  }
  writeFileSync(OPENCODE_AUTH_FILE_PATH, JSON.stringify(authFile), "utf8");
}

function writeCodexOauthFile(available: boolean): void {
  mkdirSync(join(TEST_HOME_DIR, ".kiln", "auth"), { recursive: true });
  if (!available) {
    rmSync(CODEX_OAUTH_FILE_PATH, { force: true });
    return;
  }
  writeFileSync(CODEX_OAUTH_FILE_PATH, JSON.stringify({
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_at: "2099-01-01T00:00:00.000Z",
  }), "utf8");
}

function restoreDirectApiEnvDefaults(): void {
  for (const key of DIRECT_API_ENV_KEYS) {
    const value = DEFAULT_DIRECT_API_ENV[key];
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

async function importSessionRegistryWithDirectApiEnv(
  env: Partial<Record<(typeof DIRECT_API_ENV_KEYS)[number], string | undefined>>,
) {
  restoreDirectApiEnvDefaults();
  for (const [key, value] of Object.entries(env) as Array<
    [(typeof DIRECT_API_ENV_KEYS)[number], string | undefined]
  >) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
  vi.resetModules();
  return import("../../src/wrapper/session-registry.js");
}

afterEach(() => {
  restoreOpenCodeAuthDefaults();
  restoreDirectApiEnvDefaults();
});

afterAll(() => {
  osMockState.mockedHomedir = "";
  rmSync(TEST_HOME_DIR, { recursive: true, force: true });
});

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

    it("list() returns all providers with healthy status", () => {
      const { registry } = createDefaultRegistry();
      const providers = registry.list();
      expect(providers).toHaveLength(ALL_PROVIDER_IDS.length);
      const ids = providers.map((p) => p.id).sort();
      expect(ids).toEqual([...ALL_PROVIDER_IDS].sort());
      for (const p of providers) {
        expect(p.health).toBe("healthy");
      }
    });

    it("declares deliberation transport per executable provider boundary", () => {
      const transports = Object.fromEntries(
        createDefaultRegistry().registry.list().map((provider) => [provider.id, provider.deliberationTransport]),
      );

      expect(transports).toMatchObject({
        claude: "native-level",
        codex: "native-level",
        opencode: "native-level",
        "codex-oauth": "native-level",
        "opencode-go": "none",
        "opencode-zen": "none",
        anthropic: "native-level",
        openai: "native-level",
        deepseek: "none",
        openrouter: "none",
        ollama: "none",
        lmstudio: "none",
      });
    });

    it("list() iterates dynamic provider keys", () => {
      const registry = makeRegistry(["openai", "ollama"]);
      const providers = registry.list();
      expect(providers.map((p) => p.id)).toEqual(["openai", "ollama"]);
    });

    it.each(["claude", "codex", "opencode"] as const)(
      "preserves configured runtime session identity for %s harness sessions",
      (provider) => {
        const { registry } = createDefaultRegistry();
        const runtimeSessionId = `kiln-tui:${provider}:session-1`;

        const session = registry.createSession(provider, {
          runtimeSessionId,
          task: "test",
          permissionPolicy: BASE_POLICY,
        });

        expect(session.sessionId).toBe(runtimeSessionId);
      },
    );

    it("isolates pooled Claude credentials through CLAUDE_CONFIG_DIR", async () => {
      const credentialDir = join(TEST_HOME_DIR, ".kiln", "auth", "claude-code");
      const isolatedConfigDir = join(TEST_HOME_DIR, "claude-account-a");
      mkdirSync(credentialDir, { recursive: true });
      const timestamp = new Date().toISOString();
      writeFileSync(join(credentialDir, "account-a.json"), JSON.stringify({
        id: "account-a",
        label: "Claude account A",
        providerId: "claude-code",
        source: "manual",
        priority: 0,
        auth: { homeDir: isolatedConfigDir },
        createdAt: timestamp,
        updatedAt: timestamp,
      }), "utf8");
      claudeSdkMocks.lastQuery = undefined;
      const { registry } = createDefaultRegistry();
      const session = registry.createSession("claude", {
        task: "test",
        permissionPolicy: BASE_POLICY,
      });

      for await (const _event of session.run({ prompt: "test", cwd: process.cwd() })) {
        // consume the synthetic SDK result
      }

      expect(claudeSdkMocks.lastQuery?.options?.env?.CLAUDE_CONFIG_DIR).toBe(isolatedConfigDir);
    });

    it("passes an admitted Claude deliberation resolution through the registry", async () => {
      claudeSdkMocks.lastQuery = undefined;
      const { registry } = createDefaultRegistry();
      const deliberationResolution = {
        status: "exact",
        selectedLevel: "high",
        source: "task",
        capabilityEvidence: {
          sourceIdentity: "claude-code-model-catalog",
          sourceRevision: "2.1.226",
          observedAt: "2026-08-10T00:00:00.000Z",
        },
      } as DeliberationResolution;
      const session = registry.createSession("claude", {
        task: "test",
        permissionPolicy: BASE_POLICY,
        deliberationResolution,
      });

      for await (const _event of session.run({ prompt: "test", cwd: process.cwd() })) {
        // Consume the synthetic SDK result so the wrapper constructs its options.
      }

      expect(claudeSdkMocks.lastQuery?.options?.effort).toBe("high");
    });

    it("binds the default Claude session to its native config home for private plan containment", async () => {
      const credentialDir = join(TEST_HOME_DIR, ".kiln", "auth", "claude-code");
      rmSync(credentialDir, { recursive: true, force: true });
      const nativeConfigDir = join(TEST_HOME_DIR, ".claude");
      mkdirSync(join(nativeConfigDir, "plans"), { recursive: true });
      claudeSdkMocks.lastQuery = undefined;
      const { registry } = createDefaultRegistry();
      const session = registry.createSession("claude", {
        task: "test",
        permissionPolicy: { approval: "untrusted", sandbox: "read-only" },
        privatePlanArtifactCapability: {
          capabilityId: "claude-code-private-plan-artifacts-v1",
          harness: "claude-code",
          version: "2.1.226",
          relativeDirectory: "plans",
        },
      });

      for await (const _event of session.run({ prompt: "test", cwd: process.cwd() })) {
        // consume the synthetic SDK result and private artifact evidence
      }

      expect(claudeSdkMocks.lastQuery?.options?.env?.CLAUDE_CONFIG_DIR).toBe(nativeConfigDir);
    });

    it("preserves configured runtime session identity for direct provider sessions", () => {
      const { registry } = createDefaultRegistry();
      const session = registry.createSession("ollama", {
        runtimeSessionId: "kiln-tui:ollama:session-1",
        model: DIRECT_PROVIDER_MODELS.ollama,
        task: "test",
        permissionPolicy: BASE_POLICY,
      });

      expect(session.sessionId).toBe("kiln-tui:ollama:session-1");
      expect(session).toBeInstanceOf(ProviderSession);
    });

    it("getProviderDisplayInfo derives display metadata without owning provider models", () => {
      const { registry } = createDefaultRegistry();
      const displayInfo = getProviderDisplayInfo(registry);

      const subscription = displayInfo.find((entry) => entry.group === "subscription");
      expect(subscription).toBeDefined();
      expect(subscription?.free).toBe(true);

      expect(displayInfo.find((entry) => entry.id === "claude")).toMatchObject({
        group: "harness",
        models: [],
        free: false,
      });

      expect(displayInfo.find((entry) => entry.id === "codex")).toMatchObject({
        group: "harness",
        models: [],
        free: false,
      });

      expect(displayInfo.find((entry) => entry.id === "openrouter")).toMatchObject({
        group: "direct-api",
        models: [],
        free: true,
      });
      expect(displayInfo.find((entry) => entry.id === "opencode-go")).toMatchObject({
        group: "subscription",
        models: [],
        free: true,
      });
      expect(displayInfo.find((entry) => entry.id === "opencode-zen")).toMatchObject({
        group: "direct-api",
        models: [],
        free: false,
      });
    });

    it("runtime availability honors descriptor availability for env-gated direct providers", () => {
      const registry = new SessionRegistry([{
        id: "openai",
        costTier: "high",
        capabilities: CAPABILITIES.openai,
        isAvailable: () => false,
        create: () => makeMockSession("openai"),
      }]);

      expect(getRuntimeProviderAvailability(registry)).toEqual({ openai: false });
    });

    it.each(["codex-oauth", "opencode-go", "opencode-zen"] as const)(
      "runtime availability leaves %s auth state to runtime model discovery",
      (provider) => {
        const registry = new SessionRegistry([{
          id: provider,
          costTier: COST_TIERS[provider],
          capabilities: CAPABILITIES[provider],
          isAvailable: () => false,
          create: () => makeMockSession(provider),
        }]);

        expect(getRuntimeProviderAvailability(registry)).toEqual({ [provider]: true });
      },
    );

    it("runtime availability suppresses providers before descriptor availability checks", () => {
      const isAvailable = vi.fn(() => true);
      const registry = new SessionRegistry([{
        id: "openai",
        costTier: "high",
        capabilities: CAPABILITIES.openai,
        isAvailable,
        create: () => makeMockSession("openai"),
      }]);

      registry.reportFailure("openai", false);
      registry.reportFailure("openai", false);
      registry.reportFailure("openai", false);

      expect(getRuntimeProviderAvailability(registry)).toEqual({ openai: false });
      expect(isAvailable).not.toHaveBeenCalled();
    });
  });

  describe("selectBest", () => {
    it("requiresMcp=true retains Codex through governed native projection", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({ requiresMcp: true });
      expect(result.primary).toBe("claude");
      expect(result.scores.find((s) => s.id === "codex")?.excluded).toBe(false);
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
        expect(e.scores).toHaveLength(ALL_PROVIDER_IDS.length);
      }
    });

    it("preferred direct provider wins when available", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({ preferredProvider: "openrouter" });
      expect(result.primary).toBe("openrouter");
    });

    it("maxCostTier=low selects a provider from the low tier set", () => {
      const reg = makeRegistry();
      const result = reg.selectBest({ maxCostTier: "low" });
      const selected = reg.list().find((provider) => provider.id === result.primary);
      expect(selected?.costTier).toBe("low");
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
      expect(result.primary).toBe("codex-oauth");
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
      const opencodeGo = registry.list().find((p) => p.id === "opencode-go");
      const opencodeZen = registry.list().find((p) => p.id === "opencode-zen");
      const openai = registry.list().find((p) => p.id === "openai");
      const openrouter = registry.list().find((p) => p.id === "openrouter");
      const deepseek = registry.list().find((p) => p.id === "deepseek");
      const ollama = registry.list().find((p) => p.id === "ollama");

      expect(opencodeGo?.costTier).toBe("low");
      expect(opencodeGo?.capabilities.priority).toBe(2);
      expect(opencodeZen?.costTier).toBe("medium");
      expect(opencodeZen?.capabilities.priority).toBe(3);
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

    it("keeps default direct-provider metadata free of model-dependent tool support", () => {
      const { registry } = createDefaultRegistry();
      const directProviders = registry.list().filter((provider) => isDirectApiProvider(provider.id));

      expect(directProviders.length).toBeGreaterThan(0);
      for (const provider of directProviders) {
        expect(provider.capabilities.supportedTools).toHaveLength(0);
      }
    });

    it("createSession(openai) returns an IKilnSession when OPENAI_API_KEY is present", async () => {
      const { createDefaultRegistry: createRegistryWithOpenAiAuth } = await importSessionRegistryWithDirectApiEnv({
        OPENAI_API_KEY: "test-openai-key",
      });
      const { registry } = createRegistryWithOpenAiAuth();
      const session = registry.createSession("openai", {
        model: DIRECT_PROVIDER_MODELS.openai,
        task: "test",
        permissionPolicy: BASE_POLICY,
      });
      expect(typeof session.run).toBe("function");
      expect(typeof session.dispose).toBe("function");
    });

    it("rejects createSession when a descriptor reports unavailable", () => {
      const create = vi.fn(() => makeMockSession("openai"));
      const registry = new SessionRegistry([{
        id: "openai",
        costTier: "high",
        capabilities: CAPABILITIES.openai,
        isAvailable: () => false,
        create,
      }]);

      expect(() => registry.createSession("openai", {
        task: "test",
        permissionPolicy: BASE_POLICY,
      })).toThrow("Provider unavailable: openai");
      expect(create).not.toHaveBeenCalled();
    });

    it("creates direct provider sessions with the requested granular policy", async () => {
      const { createDefaultRegistry: createRegistryWithOpenAiAuth } = await importSessionRegistryWithDirectApiEnv({
        OPENAI_API_KEY: "test-openai-key",
      });
      const { registry } = createRegistryWithOpenAiAuth();
      const session = registry.createSession("openai", {
        model: DIRECT_PROVIDER_MODELS.openai,
        task: "test",
        permissionPolicy: GRANULAR_POLICY,
      });

      expect(session.constructor.name).toBe("ProviderSession");
      expect(session.capabilities.permissionPolicy).toBe(GRANULAR_POLICY);
    });

    it.each([
      { provider: "codex-oauth", envKey: undefined },
      { provider: "opencode-go", envKey: undefined },
      { provider: "opencode-zen", envKey: undefined },
      { provider: "anthropic", envKey: "ANTHROPIC_API_KEY" },
      { provider: "openai", envKey: "OPENAI_API_KEY" },
      { provider: "deepseek", envKey: "DEEPSEEK_API_KEY" },
      { provider: "openrouter", envKey: "OPENROUTER_API_KEY" },
      { provider: "ollama", envKey: undefined },
    ] satisfies Array<{
      readonly provider: keyof typeof DIRECT_PROVIDER_MODELS;
      readonly envKey?: (typeof DIRECT_API_ENV_KEYS)[number];
    }>)(
      "$provider fails closed when the configured model is missing or blank",
      async ({ provider, envKey }) => {
        const module = envKey
          ? await importSessionRegistryWithDirectApiEnv({ [envKey]: `test-${provider}-key` })
          : await import("../../src/wrapper/session-registry.js");
        const { registry } = module.createDefaultRegistry();

        expect(() => registry.createSession(provider, {
          task: "test",
          permissionPolicy: BASE_POLICY,
        })).toThrow(`Direct provider '${provider}' requires a non-empty configured model`);
        expect(() => registry.createSession(provider, {
          model: "   ",
          task: "test",
          permissionPolicy: BASE_POLICY,
        })).toThrow(`Direct provider '${provider}' requires a non-empty configured model`);
      },
    );

    it.each([
      { provider: "anthropic", envKey: "ANTHROPIC_API_KEY" },
      { provider: "openai", envKey: "OPENAI_API_KEY" },
      { provider: "deepseek", envKey: "DEEPSEEK_API_KEY" },
      { provider: "openrouter", envKey: "OPENROUTER_API_KEY" },
    ] as const)(
      "$provider is unavailable when $envKey is absent",
      async ({ provider, envKey }) => {
        const { createDefaultRegistry: createRegistryWithoutAuth } = await importSessionRegistryWithDirectApiEnv({
          [envKey]: undefined,
        });

        const { registry } = createRegistryWithoutAuth();
        const descriptor = registry.list().find((candidate) => candidate.id === provider);

        expect(descriptor?.isAvailable?.()).toBe(false);
      },
    );

    it.each([
      { provider: "anthropic", envKey: "ANTHROPIC_API_KEY" },
      { provider: "openai", envKey: "OPENAI_API_KEY" },
      { provider: "deepseek", envKey: "DEEPSEEK_API_KEY" },
      { provider: "openrouter", envKey: "OPENROUTER_API_KEY" },
    ] as const)(
      "$provider is unavailable when $envKey is blank",
      async ({ provider, envKey }) => {
        const { createDefaultRegistry: createRegistryWithoutAuth } = await importSessionRegistryWithDirectApiEnv({
          [envKey]: "   ",
        });

        const { registry } = createRegistryWithoutAuth();
        const descriptor = registry.list().find((candidate) => candidate.id === provider);

        expect(descriptor?.isAvailable?.()).toBe(false);
      },
    );

    it("createSession(openai) fails closed when OPENAI_API_KEY is absent", async () => {
      const { createDefaultRegistry: createRegistryWithoutOpenAiAuth } = await importSessionRegistryWithDirectApiEnv({
        OPENAI_API_KEY: undefined,
      });
      const { registry } = createRegistryWithoutOpenAiAuth();

      expect(() => registry.createSession("openai", {
        task: "test",
        permissionPolicy: BASE_POLICY,
      })).toThrow("Provider unavailable: openai");
    });

    it("ollama remains available when API-key-backed direct provider env vars are absent", async () => {
      const { createDefaultRegistry: createRegistryWithoutDirectApiKeys } = await importSessionRegistryWithDirectApiEnv({
        ANTHROPIC_API_KEY: undefined,
        OPENAI_API_KEY: undefined,
        DEEPSEEK_API_KEY: undefined,
        OPENROUTER_API_KEY: undefined,
      });
      const { registry } = createRegistryWithoutDirectApiKeys();

      const descriptor = registry.list().find((candidate) => candidate.id === "ollama");
      const session = registry.createSession("ollama", {
        model: DIRECT_PROVIDER_MODELS.ollama,
        task: "test",
        permissionPolicy: BASE_POLICY,
      });

      expect(descriptor?.health).toBe("healthy");
      expect(typeof session.run).toBe("function");
    });

    it.each(["codex-oauth", "opencode-go", "opencode-zen"] as const)(
      "%s leaves auth-backed availability to runtime model discovery instead of CLI registry snapshots",
      async (provider) => {
        try {
          delete process.env.OPENCODE_API_KEY;
          writeCodexOauthFile(false);
          writeOpenCodeAuthFile(null);
          vi.resetModules();
          const sessionRegistryModule = await import("../../src/wrapper/session-registry.js");
          const { registry } = sessionRegistryModule.createDefaultRegistry();
          const descriptor = registry.list().find((candidate) => candidate.id === provider);

          expect(descriptor?.isAvailable).toBeUndefined();
          const session = registry.createSession(provider, {
            model: DIRECT_PROVIDER_MODELS[provider],
            task: "test",
            permissionPolicy: BASE_POLICY,
          });
          expect(session.constructor.name).toBe("ProviderSession");
        } finally {
          restoreOpenCodeAuthDefaults();
        }
      },
    );
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

  describe("direct-provider execution-mode routing", () => {
    it.each([
      { provider: "anthropic", model: "claude-sonnet-4-6", envKey: "ANTHROPIC_API_KEY" },
      { provider: "codex-oauth", model: "gpt-5.4", envKey: undefined },
      { provider: "opencode-go", model: "minimax-m2.5", envKey: undefined },
      { provider: "opencode-zen", model: "anthropic/claude-sonnet-4-6", envKey: undefined },
      { provider: "openai", model: "gpt-4o", envKey: "OPENAI_API_KEY" },
      { provider: "deepseek", model: "deepseek-chat", envKey: "DEEPSEEK_API_KEY" },
      { provider: "openrouter", model: "nvidia/nemotron-3-nano-30b-a3b:free", envKey: "OPENROUTER_API_KEY" },
    ] satisfies Array<{
      readonly provider: ProviderId;
      readonly model?: string;
      readonly envKey?: (typeof DIRECT_API_ENV_KEYS)[number];
    }>)(
      "uses one ProviderSession path for executable $provider sessions",
      async ({ provider, model, envKey }) => {
        const module = envKey
          ? await importSessionRegistryWithDirectApiEnv({ [envKey]: `test-${provider}-key` })
          : await import("../../src/wrapper/session-registry.js");
        const { registry } = module.createDefaultRegistry();
        const session = registry.createSession(provider, {
          task: "test",
          ...(model ? { model } : {}),
          permissionPolicy: BASE_POLICY,
        });

        expect(session.constructor.name).toBe("ProviderSession");
        expect(session.capabilities.supportedTools.length).toBeGreaterThan(0);
      },
    );

    it.each([
      { provider: "deepseek", model: "deepseek-reasoner", envKey: "DEEPSEEK_API_KEY" },
      { provider: "ollama", model: "llama3.1", envKey: undefined },
    ] satisfies Array<{
      readonly provider: ProviderId;
      readonly model?: string;
      readonly envKey?: (typeof DIRECT_API_ENV_KEYS)[number];
    }>)(
      "keeps $provider sessions text-only when the selected model profile cannot execute tools",
      async ({ provider, model, envKey }) => {
        const module = envKey
          ? await importSessionRegistryWithDirectApiEnv({ [envKey]: `test-${provider}-key` })
          : await import("../../src/wrapper/session-registry.js");
        const { registry } = module.createDefaultRegistry();
        const session = registry.createSession(provider, {
          task: "test",
          ...(model ? { model } : {}),
          permissionPolicy: BASE_POLICY,
        });

        expect(session.constructor.name).toBe("ProviderSession");
        expect(session.capabilities.supportedTools).toHaveLength(0);
      },
    );

    it.each([
      "codex-oauth",
      "opencode-go",
      "opencode-zen",
      "anthropic",
      "openai",
      "deepseek",
      "openrouter",
      "ollama",
    ] satisfies ProviderId[])("selection favors preferred direct provider %s without encoding execution mode", (provider) => {
      const registry = makeRegistry();

      const result = registry.selectBest({ preferredProvider: provider });

      expect(result.primary).toBe(provider);
    });
  });
});
