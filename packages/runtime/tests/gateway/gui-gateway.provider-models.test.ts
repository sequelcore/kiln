import "./gui-gateway-test-fixture.js";
import * as guiFixture from "./gui-gateway-test-fixture.js";
import {
  rmSync,
} from "node:fs";
import {
  execFileSync,
  spawn,
} from "node:child_process";
import {
  EventEmitter,
} from "node:events";
import {
  CredentialPool,
  GPT4O,
  OPENCODE_BASE_URL,
  type OpenCodeAuthFile,
  type OpenCodeTier,
} from "@kilnai/core/agents";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  processAdmittedTurn,
} from "../../src/gateway/message-pipeline/index.js";
import {
  buildGuiOperatorDiscoveryResults,
  buildWelcomeProviderDescriptors,
  discoverCodexCliModelDiscovery,
  discoverGuiDirectProviderModelDiscovery,
  discoverOpencodeCliModelDiscovery,
  resolveOpenCodeExecutable,
  markGuiProviderDiscoveryStale,
  projectGuiProviderModelDiscovery,
  projectGuiOperatorModels,
  resolveGuiOperatorDiscoveryResults,
} from "../../src/gateway/gui-provider-models.js";
import {
  CodexOAuthCredentialPoolService,
} from "../../src/agents/credential-pool/codex-oauth-credential-pool.js";
import {
  OpenCodeCredentialPoolService,
} from "../../src/agents/credential-pool/opencode-credential-pool.js";
import {
  RuntimeSession,
} from "../../src/session/runtime-session.js";
import {
  defineRuntimeSessionAuthorityFacet,
} from "../../src/session/runtime-session-authority-facet.js";

const {guiOperatorTransportDefaults, createGuiDist, selectGuiTestExecutionTarget, makeGuiOperatorDiscoveryFromModels} = guiFixture;
const guiSocketHarness = guiFixture.getGuiSocketHarness();

type GuiOperatorDiscoveryBuilderInput = Parameters<typeof buildGuiOperatorDiscoveryResults>[0];

const AVAILABLE_CANONICAL_PROVIDERS: Record<string, boolean> = {
  anthropic: true,
  openai: true,
  deepseek: true,
  openrouter: true,
  ollama: true,
  "opencode-go": true,
  "opencode-zen": true,
  "codex-oauth": true,
};

function makeGuiOperatorDiscoveryBuilderInput(
  overrides: Partial<GuiOperatorDiscoveryBuilderInput> = {},
): GuiOperatorDiscoveryBuilderInput {
  return {
    opencodeModels: [],
    codexModels: [],
    ...overrides,
  };
}

function projectGuiOperatorDiscoveryInput(input: GuiOperatorDiscoveryBuilderInput): Record<string, string[]> {
  return projectGuiOperatorModels(buildGuiOperatorDiscoveryResults(input));
}

function projectDirectProviderDiscoveryForTest(
  directProviderDiscovery: Awaited<ReturnType<typeof discoverGuiDirectProviderModelDiscovery>>,
  providerAvailability: Readonly<Record<string, boolean>>,
): Record<string, string[]> {
  return projectGuiOperatorModels(buildGuiOperatorDiscoveryResults({
    opencodeModels: [],
    codexModels: [],
    providerAvailability,
    directProviderDiscovery,
  }));
}

function mockOpenCodeCredentialPool(
  credentialsForTier: (tier: OpenCodeTier) => readonly OpenCodeAuthFile[] = () => [],
) {
  return vi.spyOn(OpenCodeCredentialPoolService.prototype, "createPool").mockImplementation(async (tier) =>
    new CredentialPool("opencode-api", {
      credentials: credentialsForTier(tier).map((auth, index) => ({
        id: `${tier}-${index}`,
        label: `${tier}-${index}`,
        providerId: "opencode-api",
        source: "manual" as const,
        priority: 0,
        tier: auth.tier,
        auth,
        requestCount: 0,
        lastSuccess: null,
        lastExhausted: null,
        cooldownUntil: null,
        invalidReason: null,
        softLeaseCount: 0,
      })),
    }),
  );
}

describe("GUI gateway provider and model discovery", () => {
  it("builds structured provider discovery results with unavailable reasons", () => {
    const checkedAt = "2026-04-28T12:00:00.000Z";
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: ["gpt-5.4"],
      providerAvailability: {
        claude: true,
        codex: true,
        openai: true,
        "codex-oauth": false,
      },
      lastCheckedAt: checkedAt,
    });

    expect(discovery.find((entry) => entry.provider === "claude")).toMatchObject({
      provider: "claude",
      available: true,
      models: [],
      status: "model_selection_not_required",
      reason: "Claude CLI is available. Model selection is not required.",
      authState: "not_required",
      lastCheckedAt: checkedAt,
    });
    expect(discovery.find((entry) => entry.provider === "codex")).toMatchObject({
      provider: "codex",
      available: true,
      models: ["gpt-5.4"],
      status: "available",
    });
    expect(discovery.find((entry) => entry.provider === "openai")).toMatchObject({
      provider: "openai",
      available: false,
      models: [],
      status: "empty_model_list",
      reason: "No models were discovered for OpenAI.",
    });
    expect(discovery.find((entry) => entry.provider === "codex-oauth")).toMatchObject({
      provider: "codex-oauth",
      available: false,
      models: [],
      status: "missing_auth",
      reason: "Codex OAuth is unavailable in this runtime.",
    });

    expect(projectGuiOperatorModels(discovery)).toEqual({
      claude: [],
      codex: ["gpt-5.4"],
    });
    expect(buildWelcomeProviderDescriptors(discovery).find((entry) => entry.id === "openai")).toMatchObject({
      id: "openai",
      available: false,
      models: [],
      status: "empty_model_list",
      reason: "No models were discovered for OpenAI.",
    });
  });

  it("projects exact Claude CLI deliberation capabilities into operator discovery", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      claudeModels: ["claude-sonnet-5"],
      claudeDiscovery: {
        models: ["claude-sonnet-5"],
        modelCapabilities: {
          "claude-sonnet-5": {
            deliberation: {
              provider: "claude",
              model: "claude-sonnet-5",
              levels: [{ id: "low" }, { id: "high" }],
              supportsAdaptive: true,
              evidence: {
                sourceIdentity: "claude-code-model-catalog",
                sourceRevision: "2.1.226",
                observedAt: "2026-08-10T00:00:00.000Z",
              },
            },
          },
        },
        status: "available",
        reason: "Claude Code models discovered through the Agent SDK control plane.",
        authState: "authenticated",
      },
      opencodeModels: [],
      codexModels: [],
    });

    expect(discovery.find((entry) => entry.provider === "claude")).toMatchObject({
      available: true,
      models: ["claude-sonnet-5"],
      modelCapabilities: {
        "claude-sonnet-5": {
          deliberation: {
            provider: "claude",
            model: "claude-sonnet-5",
            levels: [{ id: "low" }, { id: "high" }],
            evidence: { sourceRevision: "2.1.226" },
          },
        },
      },
    });
  });

  it("projects unhealthy direct provider model routes into structured discovery", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: [],
      providerAvailability: { openrouter: true },
      directProviderDiscovery: {
        openrouter: {
          models: ["openrouter/free", "qwen/qwen3-coder:free"],
          modelRouteHealth: {
            "openrouter/free": {
              healthy: true,
            },
            "qwen/qwen3-coder:free": {
              healthy: false,
              reason: "Provider/model route 'openrouter/qwen/qwen3-coder:free' is cooling down.",
              cooldownUntil: 1_777_777_777_000,
            },
            "unused/free": {
              healthy: false,
              reason: "This model is not advertised.",
            },
          },
          status: "available",
          reason: "OpenRouter models discovered.",
          authState: "authenticated",
        },
      },
      lastCheckedAt: "2026-04-28T12:00:00.000Z",
    });

    expect(discovery.find((entry) => entry.provider === "openrouter")).toMatchObject({
      provider: "openrouter",
      available: true,
      models: ["openrouter/free", "qwen/qwen3-coder:free"],
      modelRouteHealth: {
        "openrouter/free": {
          healthy: true,
        },
        "qwen/qwen3-coder:free": {
          healthy: false,
          reason: "Provider/model route 'openrouter/qwen/qwen3-coder:free' is cooling down.",
          cooldownUntil: 1_777_777_777_000,
        },
      },
    });

    const projection = projectGuiProviderModelDiscovery(discovery, {
      observedAt: "2026-04-28T12:00:00.000Z",
    });
    expect(projection.entries.find((entry) =>
      entry.providerRoute.providerId === "openrouter"
      && entry.providerRoute.providerModelId === "openrouter/free"
    )).toMatchObject({
      routeHealth: {
        status: "healthy",
      },
      eligibility: {
        reasonCodes: expect.not.arrayContaining([
          "missing-route-health-evidence",
          "route-unhealthy",
        ]),
      },
    });
    expect(projection.entries.find((entry) =>
      entry.providerRoute.providerId === "openrouter"
      && entry.providerRoute.providerModelId === "qwen/qwen3-coder:free"
    )).toMatchObject({
      routeHealth: {
        status: "unhealthy",
        reason: "Provider/model route 'openrouter/qwen/qwen3-coder:free' is cooling down.",
      },
      eligibility: {
        eligible: false,
        reasonCodes: expect.arrayContaining(["route-unhealthy"]),
      },
    });
    expect(projection.entries.find((entry) =>
      entry.providerRoute.providerId === "openrouter"
      && entry.providerRoute.providerModelId === "qwen/qwen3-coder:free"
    )?.eligibility.reasonCodes).not.toContain("missing-route-health-evidence");
  });

  it("keeps Claude model-less when availability says it is live", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: [],
      providerAvailability: { claude: true },
      lastCheckedAt: "2026-04-28T12:00:00.000Z",
    });

    expect(discovery.find((entry) => entry.provider === "claude")).toMatchObject({
      provider: "claude",
      available: true,
      models: [],
      status: "model_selection_not_required",
      reason: "Claude CLI is available. Model selection is not required.",
    });
    expect(projectGuiOperatorModels(discovery).claude).toEqual([]);
    expect(buildWelcomeProviderDescriptors(discovery).find((entry) => entry.id === "claude")).toMatchObject({
      id: "claude",
      models: [],
      available: true,
    });
  });

  it("does not probe Codex or OpenCode CLI models when provider availability is empty", async () => {
    vi.mocked(execFileSync).mockClear();
    vi.mocked(spawn).mockClear();

    const discovery = await resolveGuiOperatorDiscoveryResults({});

    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    expect(discovery.find((entry) => entry.provider === "codex")).toMatchObject({
      provider: "codex",
      available: false,
      status: "cli_missing",
    });
    expect(discovery.find((entry) => entry.provider === "opencode")).toMatchObject({
      provider: "opencode",
      available: false,
      status: "cli_missing",
    });
  });

  it("keeps Codex and OpenCode CLI model discovery active when availability admits them", async () => {
    vi.mocked(execFileSync).mockClear();
    vi.mocked(spawn).mockClear();

    await resolveGuiOperatorDiscoveryResults({
      codex: true,
      opencode: true,
    });

    expect(vi.mocked(execFileSync)).toHaveBeenCalled();
    expect(vi.mocked(spawn)).toHaveBeenCalled();
  });
});


describe("projectGuiOperatorModels", () => {
  it("anchors implicit catalog observation time to the latest provider observation", () => {
    const projection = projectGuiProviderModelDiscovery([{
      provider: "codex-oauth",
      available: true,
      models: ["gpt-5.5"],
      status: "available",
      reason: "Codex OAuth models discovered.",
      authState: "authenticated",
      lastCheckedAt: "2026-07-02T12:00:00.000Z",
    }, {
      provider: "opencode-go",
      available: true,
      models: ["deepseek-v4-flash"],
      status: "available",
      reason: "OpenCode Go models discovered.",
      authState: "authenticated",
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    }]);

    expect(projection.catalogEvidence.observedAt).toBe("2026-07-02T12:00:00.000Z");
  });

  it("rehydrates continuation authority before allocating the next canonical turn after restart", async () => {
    const distDir = createGuiDist();
    const stop = vi.fn();
    const resolveGuiOperatorDiscoverySpy = vi
      .spyOn(await import("../../src/gateway/gui-provider-models.js"), "resolveGuiOperatorDiscoveryResults")
      .mockResolvedValue(makeGuiOperatorDiscoveryFromModels({ openai: [GPT4O] }));
    vi.mocked(processAdmittedTurn).mockReset();
    vi.mocked(processAdmittedTurn).mockResolvedValue({
      ok: true,
      result: {
        parts: [{ type: "text", text: "admitted" }], inputTokens: 1, outputTokens: 1,
        cacheReadTokens: 0, cacheWriteTokens: 0, queued: false,
        sessionId: "transport-output", sessionMode: "mode-a", traceId: "trace",
      },
    } as never);
    vi.stubGlobal("Bun", {
      serve: vi.fn().mockImplementation(({ port }: { port?: number }) => ({ port: port ?? 4810, stop })),
    });
    const { startGuiGateway } = await import("../../src/gateway/gui-gateway.js");
    let gateway: Awaited<ReturnType<typeof startGuiGateway>> | undefined;

    try {
      const firstBundleWrites: unknown[] = [];
      const firstAdoptionWrites: unknown[] = [];
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({}) as never,
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai", setProvider: vi.fn(),
            getModel: () => GPT4O, setModel: vi.fn(),
          },
          authorityAdmissionEvidenceStore: {
            persist: async (bundle) => { firstBundleWrites.push(bundle); },
            loadSessionFacet: async () => undefined,
          },
          persistCanonicalSessionEvents: async (events) => { firstAdoptionWrites.push(...events); },
        },
      });
      let connection = guiSocketHarness.simulateConnection({ userId: "restart-user" });
      await selectGuiTestExecutionTarget(connection.handlers, connection.wsCtx);
      await connection.handlers.onMessage!(new MessageEvent("message", {
        data: JSON.stringify({ type: "message", content: "first turn" }),
      }), connection.wsCtx);

      const firstBundle = firstBundleWrites[0] as import("../../src/session/effective-authority-admission-bundle.js").EffectiveAuthorityAdmissionBundle;
      const firstAdoption = firstAdoptionWrites[0] as import("@kilnai/core").CanonicalSessionEvent;
      expect(firstBundle.turnId).toBe(`${firstBundle.sessionId}:turn:1`);
      gateway.shutdown();
      gateway = undefined;

      const secondBundleWrites: typeof firstBundle[] = [];
      const secondAdoptionWrites: import("@kilnai/core").CanonicalSessionEvent[] = [];
      const hydrateCanonicalSession = async ({ session }: { readonly session: RuntimeSession }) => {
        session.addUserMessage([{ type: "text", text: "persisted first user turn" }]);
        session.addAssistantMessage([{ type: "text", text: "persisted first assistant turn" }]);
        session.appendSessionEvents([firstAdoption]);
        return { rehydrated: true as const, messageCount: 2, sourceSequence: 1 };
      };
      const resumeSessionHydrator = vi.fn()
        .mockResolvedValueOnce({ rehydrated: false as const, messageCount: 0, reason: "temporary transcript failure" })
        .mockImplementation(hydrateCanonicalSession);
      gateway = await startGuiGateway({
        guiDistPath: distDir,
        getSnapshot: async () => ({}) as never,
        operatorTransport: {
          ...guiOperatorTransportDefaults,
          sessionManager: {
            getProvider: () => "openai", setProvider: vi.fn(),
            getModel: () => GPT4O, setModel: vi.fn(),
          },
          resumeSessionHydrator: resumeSessionHydrator as never,
          authorityAdmissionEvidenceStore: {
            persist: async (bundle) => { secondBundleWrites.push(bundle); },
            loadSessionFacet: async () => defineRuntimeSessionAuthorityFacet({
              sessionId: firstBundle.sessionId,
              sessionRevision: firstBundle.configuration.sessionRevision,
              ...firstBundle.session,
            }),
          },
          persistCanonicalSessionEvents: async (events) => { secondAdoptionWrites.push(...events); },
        },
      });
      connection = guiSocketHarness.simulateConnection({ userId: "restart-user" });
      await selectGuiTestExecutionTarget(connection.handlers, connection.wsCtx);
      await connection.handlers.onMessage!(new MessageEvent("message", {
        data: JSON.stringify({
          type: "message", content: "continued turn", continuationSessionId: firstBundle.sessionId,
        }),
      }), connection.wsCtx);

      expect(resumeSessionHydrator).toHaveBeenCalledOnce();
      expect(secondBundleWrites).toHaveLength(0);
      await connection.handlers.onMessage!(new MessageEvent("message", {
        data: JSON.stringify({
          type: "message", content: "retry continued turn", continuationSessionId: firstBundle.sessionId,
        }),
      }), connection.wsCtx);

      expect(resumeSessionHydrator).toHaveBeenCalledTimes(2);
      expect(secondBundleWrites[0]?.turnId).toBe(`${firstBundle.sessionId}:turn:2`);
      expect(secondAdoptionWrites[0]).toMatchObject({
        operatorTurnId: `${firstBundle.sessionId}:turn:2`,
      });
    } finally {
      resolveGuiOperatorDiscoverySpy.mockRestore();
      gateway?.shutdown();
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it("projects large OpenCode catalogs as diagnostic evidence without making routes selectable", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: Array.from({ length: 397 }, (_, index) => `provider-${index}/model-${index}`),
      opencodeDiscovery: {
        models: Array.from({ length: 397 }, (_, index) => `provider-${index}/model-${index}`),
        status: "available",
        reason: "OpenCode CLI models discovered.",
        authState: "authenticated",
      },
      codexModels: [],
      providerAvailability: { opencode: true },
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    });

    const projection = projectGuiProviderModelDiscovery(discovery, {
      observedAt: "2026-07-01T12:00:00.000Z",
    });

    expect(projection.catalogEvidence).toMatchObject({
      status: "partial",
      counts: { total: 397, returned: 397, omitted: 0 },
    });
    expect(projection.entries).toHaveLength(397);
    const firstEntry = projection.entries[0]!;
    expect(firstEntry).toMatchObject({
      providerRoute: {
        providerId: "opencode",
        providerModelId: "provider-0/model-0",
        scope: "opencode-harness",
      },
      harnessRoute: {
        harnessId: "opencode",
        reportedProviderId: "opencode",
        reportedModelId: "provider-0/model-0",
      },
      rawEvidence: {
        rawId: "provider-0/model-0",
      },
      credentialEvidence: {
        state: "authenticated",
      },
      entitlementEvidence: {
        state: "unknown",
      },
      freshness: {
        status: "fresh",
      },
      routeHealth: {
        status: "healthy",
      },
      policyAdmission: {
        use: "interactive",
        status: "admitted",
      },
      eligibility: {
        eligible: false,
      },
    });
    expect(firstEntry.eligibility.reasonCodes).toEqual(expect.arrayContaining([
      "missing-entitlement-evidence",
    ]));
  });

  it("keeps direct provider route-health diagnostic without granting eligibility", () => {
    const projection = projectGuiProviderModelDiscovery([{
      provider: "openrouter",
      available: true,
      models: ["openrouter/free"],
      modelRouteHealth: {
        "openrouter/free": { healthy: true },
      },
      status: "available",
      reason: "OpenRouter models discovered.",
      authState: "authenticated",
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    }], {
      observedAt: "2026-07-01T12:00:00.000Z",
    });

    expect(projection.entries).toHaveLength(1);
    const firstEntry = projection.entries[0]!;
    expect(firstEntry).toMatchObject({
      credentialEvidence: { state: "authenticated" },
      entitlementEvidence: { state: "unknown" },
      routeHealth: { status: "healthy" },
      policyAdmission: { use: "interactive", status: "admitted" },
      eligibility: {
        eligible: false,
        reasonCodes: expect.arrayContaining([
          "missing-entitlement-evidence",
        ]),
      },
    });
    expect(firstEntry.eligibility.reasonCodes).not.toContain("missing-route-health-evidence");
  });

  it("marks account-scoped direct service models eligible for interactive GUI selection", () => {
    const projection = projectGuiProviderModelDiscovery([{
      provider: "opencode-go",
      available: true,
      models: ["deepseek-v4-flash"],
      status: "available",
      reason: "OpenCode Go models discovered.",
      authState: "authenticated",
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    }, {
      provider: "codex-oauth",
      available: true,
      models: ["gpt-5.5"],
      modelCapabilities: {
        "gpt-5.5": { supportsFunctionTools: false, supportsRuntimeTools: false },
      },
      status: "available",
      reason: "Codex OAuth models discovered.",
      authState: "authenticated",
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    }], {
      observedAt: "2026-07-01T12:00:00.000Z",
    });

    expect(projection.entries).toHaveLength(2);
    expect(projection.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerRoute: {
          providerId: "opencode-go",
          providerModelId: "deepseek-v4-flash",
          scope: "opencode-service",
        },
        credentialEvidence: expect.objectContaining({ state: "authenticated" }),
        entitlementEvidence: expect.objectContaining({ state: "confirmed" }),
        routeHealth: expect.objectContaining({ status: "healthy" }),
        policyAdmission: expect.objectContaining({ use: "interactive", status: "admitted" }),
        eligibility: { eligible: true, reasonCodes: [] },
      }),
      expect.objectContaining({
        providerRoute: {
          providerId: "codex-oauth",
          providerModelId: "gpt-5.5",
          scope: "direct-provider",
        },
        credentialEvidence: expect.objectContaining({ state: "authenticated" }),
        entitlementEvidence: expect.objectContaining({ state: "confirmed" }),
        routeHealth: expect.objectContaining({ status: "healthy" }),
        policyAdmission: expect.objectContaining({ use: "interactive", status: "admitted" }),
        eligibility: { eligible: true, reasonCodes: [] },
        modelCapabilities: { supportsFunctionTools: false, supportsRuntimeTools: false },
      }),
    ]));
  });

  it("keeps stale catalog entries visible but fail-closed in the provider-model projection", () => {
    const discovery = markGuiProviderDiscoveryStale(buildGuiOperatorDiscoveryResults({
      opencodeModels: ["openai/gpt-5.4-mini"],
      opencodeDiscovery: {
        models: ["openai/gpt-5.4-mini"],
        status: "available",
        reason: "OpenCode CLI models discovered.",
        authState: "authenticated",
      },
      codexModels: [],
      providerAvailability: { opencode: true },
      lastCheckedAt: "2026-07-01T12:00:00.000Z",
    }));

    const projection = projectGuiProviderModelDiscovery(discovery, {
      observedAt: "2026-07-01T12:00:00.000Z",
    });

    expect(projection.catalogEvidence.status).toBe("partial");
    expect(projection.entries).toHaveLength(1);
    const firstEntry = projection.entries[0]!;
    expect(firstEntry).toMatchObject({
      freshness: { status: "stale" },
      eligibility: { eligible: false },
    });
    expect(firstEntry.eligibility.reasonCodes).toContain("stale-discovered-evidence");
  });

  it("includes discovered codex-oauth subscription models from direct OAuth discovery", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      opencodeModels: ["openai/gpt-5.4-mini"],
      codexModels: ["gpt-5.4", "gpt-5.4-mini"],
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        "codex-oauth": {
          models: ["gpt-5.4-mini"],
          status: "available",
          reason: "Codex OAuth models discovered.",
          authState: "authenticated",
        },
      },
    }));

    expect(models["codex-oauth"]).toEqual(["gpt-5.4-mini"]);
    expect(models.codex).toEqual(["gpt-5.4", "gpt-5.4-mini"]);
    expect(models.opencode).toEqual(["openai/gpt-5.4-mini"]);
  });

  it("does not expose codex-oauth when only local Codex CLI models are discovered", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      codexModels: ["gpt-5.4"],
    }));

    expect(models.codex).toEqual(["gpt-5.4"]);
    expect(models["codex-oauth"]).toBeUndefined();
  });

  it("publishes only directly discovered codex-oauth models when direct OAuth discovery is present", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      codexModels: ["gpt-5.4"],
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        "codex-oauth": {
          models: ["gpt-5.4-mini"],
          status: "available",
          reason: "Codex OAuth models discovered.",
          authState: "authenticated",
        },
      },
    }));

    expect(models["codex-oauth"]).toEqual(["gpt-5.4-mini"]);
    expect(models["codex-oauth"]).not.toContain("gpt-5.4");
  });

  it("uses structured codex-oauth discovery instead of local Codex CLI discovery", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: [],
      codexModels: ["gpt-5.4"],
      codexDiscovery: {
        models: ["gpt-5.4"],
        status: "available",
        reason: "Codex CLI models discovered.",
        authState: "authenticated",
      },
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        "codex-oauth": {
          models: ["gpt-5.4-mini"],
          status: "available",
          reason: "Codex OAuth models discovered.",
          authState: "authenticated",
        },
      },
      lastCheckedAt: "2026-04-28T12:00:00.000Z",
    });

    expect(discovery.find((entry) => entry.provider === "codex")).toMatchObject({
      provider: "codex",
      available: true,
      models: ["gpt-5.4"],
      reason: "Codex CLI models discovered.",
    });
    expect(discovery.find((entry) => entry.provider === "codex-oauth")).toMatchObject({
      provider: "codex-oauth",
      available: true,
      models: ["gpt-5.4-mini"],
      reason: "Codex OAuth models discovered.",
    });
    expect(projectGuiOperatorModels(discovery)["codex-oauth"]).not.toContain("gpt-5.4");
  });

  it("publishes discovered direct provider models when discovery and availability agree", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        anthropic: {
          models: ["claude-sonnet-4-6"],
          status: "available",
          reason: "Anthropic models discovered.",
          authState: "authenticated",
        },
        openai: {
          models: [GPT4O],
          status: "available",
          reason: "OpenAI models discovered.",
          authState: "authenticated",
        },
        deepseek: {
          models: ["deepseek-chat"],
          status: "available",
          reason: "DeepSeek models discovered.",
          authState: "authenticated",
        },
        openrouter: {
          models: ["nvidia/nemotron-3-nano-30b-a3b:free"],
          status: "available",
          reason: "OpenRouter models discovered.",
          authState: "authenticated",
        },
        "opencode-go": {
          models: ["minimax-m2.5"],
          status: "available",
          reason: "OpenCode Go models discovered.",
          authState: "authenticated",
        },
        "opencode-zen": {
          models: ["openai/gpt-5.4"],
          status: "available",
          reason: "OpenCode Zen models discovered.",
          authState: "authenticated",
        },
        ollama: {
          models: ["ollama-local"],
          status: "available",
          reason: "Ollama models discovered.",
          authState: "not_required",
        },
      },
    }));

    expect(models.anthropic).toContain("claude-sonnet-4-6");
    expect(models.openai).toContain(GPT4O);
    expect(models.deepseek).toContain("deepseek-chat");
    expect(models.openrouter).toContain("nvidia/nemotron-3-nano-30b-a3b:free");
    expect(models["opencode-go"]).toContain("minimax-m2.5");
    expect(models["opencode-zen"]).toContain("openai/gpt-5.4");
    expect(models.ollama).toContain("ollama-local");
    expect(models.claude).toBeUndefined();
  });

  it("keeps OpenCode CLI wrapper models separate from OpenCode subscription models", () => {
    const discovery = buildGuiOperatorDiscoveryResults({
      opencodeModels: ["opencode/wrapper-model"],
      codexModels: [],
      opencodeDiscovery: {
        models: ["opencode/wrapper-model"],
        status: "available",
        reason: "OpenCode CLI models discovered.",
        authState: "authenticated",
      },
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        "opencode-go": {
          models: ["opencode/go-model"],
          status: "available",
          reason: "OpenCode Go models discovered.",
          authState: "authenticated",
        },
        "opencode-zen": {
          models: ["opencode/zen-model"],
          status: "available",
          reason: "OpenCode Zen models discovered.",
          authState: "authenticated",
        },
      },
    });

    const models = projectGuiOperatorModels(discovery);

    expect(models.opencode).toEqual(["opencode/wrapper-model"]);
    expect(models["opencode-go"]).toEqual(["opencode/go-model"]);
    expect(models["opencode-zen"]).toEqual(["opencode/zen-model"]);
    expect(models.opencode).not.toContain("opencode/go-model");
    expect(models.opencode).not.toContain("opencode/zen-model");
    expect(models["opencode-go"]).not.toContain("opencode/wrapper-model");
    expect(models["opencode-zen"]).not.toContain("opencode/wrapper-model");
  });

  it("publishes Claude as a model-less operator provider when availability says it is live", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      providerAvailability: {
        claude: true,
      },
    }));

    expect(models.claude).toEqual([]);
  });

  it("does not expose codex-oauth when codex discovery returns no models", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput({
      providerAvailability: AVAILABLE_CANONICAL_PROVIDERS,
      directProviderDiscovery: {
        openai: {
          models: [GPT4O],
          status: "available",
          reason: "OpenAI models discovered.",
          authState: "authenticated",
        },
      },
    }));

    expect(models.codex).toBeUndefined();
    expect(models["codex-oauth"]).toBeUndefined();
    expect(models.openai).toContain(GPT4O);
  });
});

describe("discoverOpencodeCliModelDiscovery", () => {
  afterEach(() => {
    vi.mocked(execFileSync).mockReturnValue("");
    vi.unstubAllGlobals();
  });

  it("probes an npm OpenCode command shim with the platform-required shell mode", () => {
    vi.mocked(execFileSync).mockImplementation((command) => {
      if (String(command).toLowerCase().endsWith("opencode.cmd")) return "opencode 1.18.16";
      throw new Error("not this candidate");
    });

    expect(resolveOpenCodeExecutable()).toMatchObject({ evidence: { version: "1.18.16" } });
    const shimCall = vi.mocked(execFileSync).mock.calls.find(([command]) =>
      String(command).toLowerCase().endsWith("opencode.cmd"));
    expect(shimCall?.[2]).toEqual(expect.objectContaining({
      shell: process.platform === "win32",
    }));
  });

  it("discovers only enabled OpenCode variants through its local structured model API", async () => {
    vi.mocked(execFileSync).mockImplementation((_command, args) => {
      if (args?.includes("--version")) {
        return "opencode 1.0.0";
      }
      return "";
    });
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      queueMicrotask(() => {
        proc.stdout.emit("data", Buffer.from("opencode server listening on http://127.0.0.1:43123\n"));
      });
      return proc as never;
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [
        {
          id: "gpt-5.4",
          providerID: "opencode",
          enabled: true,
          variants: [
            { id: "none", body: { enableThinking: false } },
            { id: "minimal", body: { modelParams: { reasoning_effort: "minimal" } } },
            { id: "low", body: { reasoningEffort: "low" } },
            { id: "medium", body: { thinkingConfig: { thinkingLevel: "medium" } } },
            { id: "xhigh", body: { reasoning: { effort: "xhigh" } } },
            { id: "max", body: { enable_thinking: true, thinking_budget: 32000 } },
            { id: "high", body: { reasoningEffort: "low" } },
            { id: "high", body: { reasoningEffort: "high", thinking: { type: "disabled" } } },
            { id: "high", body: { textVerbosity: "high" } },
          ],
        },
        {
          id: "disabled-model",
          providerID: "opencode",
          enabled: false,
          variants: [{ id: "high" }],
        },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(discoverOpencodeCliModelDiscovery()).resolves.toMatchObject({
      models: ["opencode/gpt-5.4"],
      status: "available",
      reason: "OpenCode CLI models discovered through its local model API.",
      authState: "authenticated",
      modelCapabilities: {
        "opencode/gpt-5.4": {
          deliberation: {
            provider: "opencode",
            model: "opencode/gpt-5.4",
            levels: [
              { id: "none" },
              { id: "minimal" },
              { id: "low" },
              { id: "medium" },
              { id: "xhigh" },
              { id: "max" },
            ],
            supportsAdaptive: false,
            evidence: {
              sourceIdentity: "opencode-cli-model-catalog",
              sourceRevision: expect.stringMatching(/^1\.0\.0:[a-f0-9]{16}$/u),
            },
          },
        },
      },
    });
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/api\/model$/u), expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(spawn).toHaveBeenCalledWith(expect.any(String), ["serve", "--hostname=127.0.0.1", "--port=0"], expect.objectContaining({
      stdio: ["ignore", "pipe", "pipe"],
    }));
  });

  it("revises OpenCode capability evidence when variant reasoning semantics change", async () => {
    vi.mocked(execFileSync).mockImplementation((_command, args) => args?.includes("--version") ? "opencode 1.0.0" : "");
    vi.mocked(spawn).mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      queueMicrotask(() => proc.stdout.emit("data", Buffer.from("opencode server listening on http://127.0.0.1:43123\n")));
      return proc as never;
    });
    let budget = 16000;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{
        id: "reasoning-model",
        providerID: "provider",
        enabled: true,
        variants: [{ id: "high", body: { enable_thinking: true, thinking_budget: budget } }],
      }],
    }), { status: 200 })));

    const first = await discoverOpencodeCliModelDiscovery();
    budget = 32000;
    const second = await discoverOpencodeCliModelDiscovery();

    const firstDeliberation = first.modelCapabilities?.["provider/reasoning-model"]?.deliberation;
    const secondDeliberation = second.modelCapabilities?.["provider/reasoning-model"]?.deliberation;
    if (!firstDeliberation || !secondDeliberation) {
      throw new Error("Expected OpenCode reasoning deliberation evidence in both discoveries.");
    }
    expect(firstDeliberation.evidence.sourceRevision).not.toBe(secondDeliberation.evidence.sourceRevision);
  });

  it("diagnoses missing OpenCode CLI executable", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("missing opencode");
    });

    await expect(discoverOpencodeCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "cli_missing",
      reason: "OpenCode CLI executable was not found.",
      authState: "not_required",
    });
  });

  it("diagnoses OpenCode local model server failure after the executable is found", async () => {
    vi.mocked(execFileSync).mockImplementation((_command, args) => {
      if (args?.includes("--version")) {
        return "opencode 1.0.0";
      }
      return "";
    });
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      queueMicrotask(() => proc.emit("close", 1));
      return proc as never;
    });

    await expect(discoverOpencodeCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "OpenCode CLI model server failed.",
      authState: "unknown",
    });
  });

  it("diagnoses an empty OpenCode structured model list", async () => {
    vi.mocked(execFileSync).mockImplementation((_command, args) => {
      if (args?.includes("--version")) {
        return "opencode 1.0.0";
      }
      return "";
    });
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      queueMicrotask(() => {
        proc.stdout.emit("data", Buffer.from("opencode server listening on http://127.0.0.1:43123\n"));
      });
      return proc as never;
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));

    await expect(discoverOpencodeCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenCode local model API returned an empty model list.",
      authState: "unknown",
    });
  });
});

describe("discoverCodexCliModelDiscovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(execFileSync).mockReturnValue("");
  });

  it("initializes Codex app-server before requesting local models", async () => {
    const writes: unknown[] = [];
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = {
        write: vi.fn((payload: string) => {
          const message = JSON.parse(payload.trim()) as Record<string, unknown>;
          writes.push(message);
          if (message.method === "initialize") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({
                id: message.id,
                result: {
                  userAgent: "codex-test",
                  codexHome: "C:/tmp/codex",
                  platformFamily: "windows",
                  platformOs: "windows",
                },
              }) + "\n"));
            });
          }
          if (message.method === "model/list") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({
                id: message.id,
                result: {
                  data: [
                    { id: "gpt-5.4" },
                    { id: "gpt-5.4-mini" },
                  ],
                },
              }) + "\n"));
            });
          }
          return true;
        }),
      };
      proc.kill = vi.fn(() => {
        proc.emit("close");
      });
      return proc as never;
    });

    const discovery = await discoverCodexCliModelDiscovery();

    expect(spawn).toHaveBeenCalledWith(expect.any(String), ["app-server"], {
      shell: expect.any(Boolean),
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    expect(writes).toEqual([
      expect.objectContaining({
        method: "initialize",
        id: 1,
      }),
      { method: "initialized" },
      expect.objectContaining({
        method: "model/list",
        id: 2,
        params: { limit: 100, includeHidden: false },
      }),
    ]);
    expect(discovery).toMatchObject({
      models: ["gpt-5.4", "gpt-5.4-mini"],
      status: "available",
      reason: "Codex CLI models discovered.",
      authState: "authenticated",
    });
  });

  it("does not finish Codex discovery until the app-server process has closed", async () => {
    let proc!: EventEmitter & {
      stdout: EventEmitter;
      stdin: { write: ReturnType<typeof vi.fn> };
      kill: ReturnType<typeof vi.fn>;
      pid: number;
      exitCode: number | null;
    };
    vi.mocked(spawn).mockImplementationOnce(() => {
      proc = new EventEmitter() as typeof proc;
      proc.pid = 4321;
      proc.exitCode = null;
      proc.stdout = new EventEmitter();
      proc.stdin = {
        write: vi.fn((payload: string) => {
          const message = JSON.parse(payload.trim()) as Record<string, unknown>;
          queueMicrotask(() => {
            proc.stdout.emit("data", Buffer.from(JSON.stringify(
              message.method === "initialize"
                ? { id: message.id, result: {} }
                : { id: message.id, result: { data: [{ id: "gpt-5.4" }] } },
            ) + "\n"));
          });
          return true;
        }),
      };
      proc.kill = vi.fn(() => true);
      return proc as never;
    });

    let resolved = false;
    const discoveryPromise = discoverCodexCliModelDiscovery().then((result) => {
      resolved = true;
      return result;
    });

    await vi.waitFor(() => {
      expect(proc.kill).toHaveBeenCalled();
    });
    if (process.platform === "win32") {
      expect(execFileSync).toHaveBeenCalledWith(
        "taskkill.exe",
        ["/PID", "4321", "/T", "/F"],
        { stdio: "ignore", windowsHide: true, timeout: 1_000 },
      );
    }
    expect(resolved).toBe(false);

    proc.exitCode = 0;
    proc.emit("close", 0, null);
    await expect(discoveryPromise).resolves.toMatchObject({
      models: ["gpt-5.4"],
      status: "available",
    });
  });

  it("blocks repeated Codex discovery when app-server does not confirm shutdown", async () => {
    vi.useFakeTimers();
    vi.mocked(spawn).mockClear();
    let proc!: EventEmitter & {
      stdout: EventEmitter;
      stdin: { write: ReturnType<typeof vi.fn> };
      kill: ReturnType<typeof vi.fn>;
      pid: number;
      exitCode: number | null;
    };
    vi.mocked(spawn).mockImplementationOnce(() => {
      proc = new EventEmitter() as typeof proc;
      proc.pid = 9876;
      proc.exitCode = null;
      proc.stdout = new EventEmitter();
      proc.stdin = {
        write: vi.fn((payload: string) => {
          const message = JSON.parse(payload.trim()) as Record<string, unknown>;
          queueMicrotask(() => {
            proc.stdout.emit("data", Buffer.from(JSON.stringify(
              message.method === "initialize"
                ? { id: message.id, result: {} }
                : { id: message.id, result: { data: [{ id: "gpt-5.4" }] } },
            ) + "\n"));
          });
          return true;
        }),
      };
      proc.kill = vi.fn(() => true);
      return proc as never;
    });

    try {
      const first = discoverCodexCliModelDiscovery();
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(first).resolves.toMatchObject({
        status: "endpoint_error",
        reason: "Codex app-server did not confirm shutdown; further discovery is blocked until it closes.",
      });

      await expect(discoverCodexCliModelDiscovery()).resolves.toMatchObject({
        status: "endpoint_error",
        reason: "A previous Codex app-server process did not confirm shutdown; discovery is blocked until it closes.",
      });
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      proc.exitCode = 0;
      proc.emit("close", 0, null);
      vi.useRealTimers();
    }
  });

  it("diagnoses missing Codex CLI executable", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("missing codex");
    });

    await expect(discoverCodexCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "cli_missing",
      reason: "Codex CLI executable was not found.",
      authState: "not_required",
    });
  });

  it("diagnoses Codex app-server timeout", async () => {
    vi.useFakeTimers();
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = { write: vi.fn(() => true) };
      proc.kill = vi.fn(() => {
        proc.emit("close");
      });
      return proc as never;
    });

    const discoveryPromise = discoverCodexCliModelDiscovery();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(discoveryPromise).resolves.toMatchObject({
      models: [],
      status: "endpoint_timeout",
      reason: "Codex app-server did not return models before timeout.",
      authState: "unknown",
    });
  });

  it("diagnoses Codex app-server auth failures", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = {
        write: vi.fn((payload: string) => {
          const message = JSON.parse(payload.trim()) as Record<string, unknown>;
          if (message.method === "initialize") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({ id: message.id, result: {} }) + "\n"));
            });
          }
          if (message.method === "model/list") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({
                id: message.id,
                error: { code: -32000, message: "OpenAI authentication required" },
              }) + "\n"));
            });
          }
          return true;
        }),
      };
      proc.kill = vi.fn(() => {
        proc.emit("close");
      });
      return proc as never;
    });

    await expect(discoverCodexCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "Codex CLI authentication is missing or expired.",
      authState: "missing",
    });
  });

  it("diagnoses Codex model version gates separately from endpoint failures", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = {
        write: vi.fn((payload: string) => {
          const message = JSON.parse(payload.trim()) as Record<string, unknown>;
          if (message.method === "initialize") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({ id: message.id, result: {} }) + "\n"));
            });
          }
          if (message.method === "model/list") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({
                id: message.id,
                error: {
                  code: -32603,
                  message: "The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
                },
              }) + "\n"));
            });
          }
          return true;
        }),
      };
      proc.kill = vi.fn(() => {
        proc.emit("close");
      });
      return proc as never;
    });

    await expect(discoverCodexCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "model_version_unsupported",
      reason: "Codex CLI model support is out of date: The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
      authState: "authenticated",
    });
  });

  it("diagnoses an empty Codex app-server model list", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stdin = {
        write: vi.fn((payload: string) => {
          const message = JSON.parse(payload.trim()) as Record<string, unknown>;
          if (message.method === "initialize") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({ id: message.id, result: {} }) + "\n"));
            });
          }
          if (message.method === "model/list") {
            queueMicrotask(() => {
              proc.stdout.emit("data", Buffer.from(JSON.stringify({
                id: message.id,
                result: { data: [] },
              }) + "\n"));
            });
          }
          return true;
        }),
      };
      proc.kill = vi.fn(() => {
        proc.emit("close");
      });
      return proc as never;
    });

    await expect(discoverCodexCliModelDiscovery()).resolves.toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "Codex app-server returned an empty model list.",
      authState: "unknown",
    });
  });

});

describe("discoverGuiDirectProviderModelDiscovery", () => {
  it("discovers OpenAI chat-capable models and filters clearly incompatible model families", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === "https://api.openai.com/v1/models",
      json: async () => ({
        data: [
          { id: "gpt-5.4" },
          { id: "gpt-4o-mini" },
          { id: "o3" },
          { id: "ft:gpt-4o-mini:sequel:custom:abc123" },
          { id: "text-embedding-3-large" },
          { id: "omni-moderation-latest" },
          { id: "tts-1" },
          { id: "whisper-1" },
          { id: "gpt-image-1" },
          { id: "dall-e-3" },
          { id: "gpt-realtime" },
          { id: "gpt-audio" },
          { id: "computer-use-preview" },
        ],
      }),
    }));
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { openai: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.openai).toMatchObject({
      status: "available",
      reason: "OpenAI models discovered.",
      authState: "authenticated",
    });
    expect(models.openai).toEqual([
      "gpt-5.4",
      "gpt-4o-mini",
      "o3",
      "ft:gpt-4o-mini:sequel:custom:abc123",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-openai-key" },
      }),
    );
  });

  it("diagnoses missing OpenAI API credentials", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openai: true,
    });

    expect(discovered.openai).toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "OPENAI_API_KEY is missing.",
      authState: "missing",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("diagnoses OpenAI model endpoint failures", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openai: true,
    });

    expect(discovered.openai).toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "OpenAI model endpoint failed.",
      authState: "unknown",
    });
  });

  it("diagnoses empty OpenAI model lists", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openai: true,
    });

    expect(discovered.openai).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenAI model endpoint returned an empty model list.",
      authState: "unknown",
    });
  });

  it("diagnoses OpenAI lists with no usable chat models after filtering", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: "text-embedding-3-large" },
          { id: "omni-moderation-latest" },
          { id: "gpt-image-1" },
        ],
      }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openai: true,
    });

    expect(discovered.openai).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenAI model endpoint returned no usable chat models.",
      authState: "unknown",
    });
  });

  it("discovers Anthropic message-capable models from the Models API", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === "https://api.anthropic.com/v1/models",
      json: async () => ({
        data: [
          {
            id: "claude-opus-4-7",
            type: "model",
            max_input_tokens: 1_000_000,
            max_tokens: 128_000,
            capabilities: {
              messages: { supported: true },
            },
          },
          {
            id: "claude-sonnet-4-6",
            type: "model",
            max_input_tokens: 1_000_000,
            max_tokens: 64_000,
            capabilities: {
              messages: { supported: true },
            },
          },
          {
            id: "claude-embedding-preview",
            type: "model",
            capabilities: {
              messages: { supported: false },
            },
          },
        ],
      }),
    }));
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { anthropic: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.anthropic).toMatchObject({
      status: "available",
      reason: "Anthropic models discovered.",
      authState: "authenticated",
    });
    expect(models.anthropic).toEqual([
      "claude-opus-4-7",
      "claude-sonnet-4-6",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": "test-anthropic-key",
        },
      }),
    );
  });

  it("keeps Anthropic Claude IDs when the provider omits capability metadata", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: "claude-haiku-4-5-20251001", type: "model" },
          { id: "not-claude-experimental", type: "model" },
        ],
      }),
    })));

    const providerAvailability = { anthropic: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(models.anthropic).toEqual(["claude-haiku-4-5-20251001"]);
  });

  it("diagnoses missing Anthropic API credentials", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      anthropic: true,
    });

    expect(discovered.anthropic).toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "ANTHROPIC_API_KEY is missing.",
      authState: "missing",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("diagnoses Anthropic model endpoint failures", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      anthropic: true,
    });

    expect(discovered.anthropic).toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "Anthropic model endpoint failed.",
      authState: "unknown",
    });
  });

  it("diagnoses empty Anthropic model lists", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      anthropic: true,
    });

    expect(discovered.anthropic).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "Anthropic model endpoint returned an empty model list.",
      authState: "unknown",
    });
  });

  it("diagnoses Anthropic lists with no message-capable models after filtering", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "claude-embedding-preview",
            type: "model",
            capabilities: {
              messages: { supported: false },
            },
          },
          {
            id: "non-claude-model",
            type: "model",
          },
        ],
      }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      anthropic: true,
    });

    expect(discovered.anthropic).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "Anthropic model endpoint returned no message-capable models.",
      authState: "unknown",
    });
  });

  it("discovers DeepSeek chat and reasoner models from the Models API", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === "https://api.deepseek.com/models",
      json: async () => ({
        object: "list",
        data: [
          { id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" },
          { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" },
          { id: "deepseek-chat", object: "model", owned_by: "deepseek" },
          { id: "deepseek-reasoner", object: "model", owned_by: "deepseek" },
          { id: "deepseek-embedding-preview", object: "model", owned_by: "deepseek" },
          { id: "not-deepseek-chat", object: "model", owned_by: "third-party" },
        ],
      }),
    }));
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { deepseek: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.deepseek).toMatchObject({
      status: "available",
      reason: "DeepSeek models discovered.",
      authState: "authenticated",
    });
    expect(models.deepseek).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-chat",
      "deepseek-reasoner",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.deepseek.com/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-deepseek-key" },
      }),
    );
  });

  it("diagnoses missing DeepSeek API credentials", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      deepseek: true,
    });

    expect(discovered.deepseek).toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "DEEPSEEK_API_KEY is missing.",
      authState: "missing",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("diagnoses DeepSeek model endpoint failures", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      deepseek: true,
    });

    expect(discovered.deepseek).toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "DeepSeek model endpoint failed.",
      authState: "unknown",
    });
  });

  it("diagnoses empty DeepSeek model lists", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ object: "list", data: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      deepseek: true,
    });

    expect(discovered.deepseek).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "DeepSeek model endpoint returned an empty model list.",
      authState: "unknown",
    });
  });

  it("diagnoses DeepSeek lists with no usable chat models after filtering", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: "deepseek-embedding-preview" },
          { id: "deepseek-audio-preview" },
          { id: "not-deepseek-chat" },
        ],
      }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      deepseek: true,
    });

    expect(discovered.deepseek).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "DeepSeek model endpoint returned no usable chat models.",
      authState: "unknown",
    });
  });

  it("discovers OpenRouter text chat models and filters incompatible modalities", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === "https://openrouter.ai/api/v1/models",
      json: async () => ({
        data: [
          {
            id: "openai/gpt-4.1",
            architecture: {
              modality: "text->text",
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
            supported_parameters: ["tools", "temperature"],
          },
          {
            id: "anthropic/claude-sonnet-4.5",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
            context_length: 200_000,
          },
          {
            id: "openai/text-embedding-3-large",
            architecture: {
              modality: "text->embedding",
              input_modalities: ["text"],
              output_modalities: ["embedding"],
            },
          },
          {
            id: "google/gemini-image-preview",
            architecture: {
              modality: "text->image",
              input_modalities: ["text"],
              output_modalities: ["image"],
            },
          },
          {
            id: "unscoped-model",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
          },
        ],
      }),
    }));
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { openrouter: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.openrouter).toMatchObject({
      status: "available",
      reason: "OpenRouter models discovered.",
      authState: "authenticated",
    });
    expect(models.openrouter).toEqual([
      "openai/gpt-4.1",
      "anthropic/claude-sonnet-4.5",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-openrouter-key" },
      }),
    );
  });

  it("diagnoses missing OpenRouter API credentials", async () => {
    const fetchSpy = vi.fn();
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", fetchSpy);

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openrouter: true,
    });

    expect(discovered.openrouter).toMatchObject({
      models: [],
      status: "missing_auth",
      reason: "OPENROUTER_API_KEY is missing.",
      authState: "missing",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("diagnoses OpenRouter model endpoint failures", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openrouter: true,
    });

    expect(discovered.openrouter).toMatchObject({
      models: [],
      status: "endpoint_error",
      reason: "OpenRouter model endpoint failed.",
      authState: "unknown",
    });
  });

  it("diagnoses empty OpenRouter model lists", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openrouter: true,
    });

    expect(discovered.openrouter).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenRouter model endpoint returned an empty model list.",
      authState: "unknown",
    });
  });

  it("diagnoses OpenRouter lists with no usable text chat models after filtering", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "openai/text-embedding-3-large",
            architecture: { output_modalities: ["embedding"] },
          },
          {
            id: "google/gemini-image-preview",
            architecture: { output_modalities: ["image"] },
          },
        ],
      }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      openrouter: true,
    });

    expect(discovered.openrouter).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "OpenRouter model endpoint returned no usable text chat models.",
      authState: "unknown",
    });
  });

  it("discovers locally installed Ollama models from the daemon without remote auth", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        models: [
          { name: "llama3.1:8b", digest: "sha256-local-a" },
          { model: "qwen2.5-coder:7b", digest: "sha256-local-b" },
          { id: "remote/library-model" },
          { name: "  " },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = { ollama: true };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(discovered.ollama).toMatchObject({
      models: ["llama3.1:8b", "qwen2.5-coder:7b"],
      status: "available",
      reason: "Ollama models discovered.",
      authState: "not_required",
    });
    expect(models.ollama).toEqual(["llama3.1:8b", "qwen2.5-coder:7b"]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("diagnoses an unreachable Ollama daemon separately from no installed models", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      ollama: true,
    });

    expect(discovered.ollama).toMatchObject({
      models: [],
      status: "daemon_unreachable",
      reason: "Ollama daemon is not reachable at http://localhost:11434.",
      authState: "not_required",
    });
  });

  it("diagnoses an Ollama daemon with no installed models", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [] }),
    })));

    const discovered = await discoverGuiDirectProviderModelDiscovery({
      ollama: true,
    });

    expect(discovered.ollama).toMatchObject({
      models: [],
      status: "empty_model_list",
      reason: "Ollama daemon returned no installed models.",
      authState: "not_required",
    });
  });

  it.each([
    ["go", "opencode-go", "https://opencode.ai/zen/go/v1/models"],
    ["zen", "opencode-zen", `${OPENCODE_BASE_URL}/models`],
  ])("discovers %s tier OpenCode models from the tiered credential pool", async (tier, providerId, modelsUrl) => {
    const poolSpy = mockOpenCodeCredentialPool((requestedTier) => requestedTier === tier
      ? [{
          api_key: "test-opencode-key",
          tier: tier as "go" | "zen",
          created_at: "2026-01-01T00:00:00.000Z",
        }]
      : []);
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: url === modelsUrl,
      json: async () => ({ data: [{ id: "opencode/live-model" }] }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        [providerId]: true,
      };
      const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
      const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);
      expect(models[providerId]).toEqual(["opencode/live-model"]);
      expect(models[tier === "go" ? "opencode-zen" : "opencode-go"]).toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledWith(
        modelsUrl,
        expect.objectContaining({
          headers: { Authorization: "Bearer test-opencode-key" },
        }),
      );
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("uses OPENCODE_API_KEY to discover both OpenCode Go and Zen requested tiers", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        data: [
          { id: url.includes("/go/") ? "go-model" : "zen-model" },
        ],
      }),
    }));
    vi.stubEnv("OPENCODE_API_KEY", "env-opencode-key");
    vi.stubGlobal("fetch", fetchSpy);

    const providerAvailability = {
      "opencode-go": true,
      "opencode-zen": true,
    };
    const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
    const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

    expect(models["opencode-go"]).toEqual(["go-model"]);
    expect(models["opencode-zen"]).toEqual(["zen-model"]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer env-opencode-key" } }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      `${OPENCODE_BASE_URL}/models`,
      expect.objectContaining({ headers: { Authorization: "Bearer env-opencode-key" } }),
    );
  });

  it("uses tiered Kiln OpenCode credential pool entries to discover Go and Zen models", async () => {
    const poolSpy = mockOpenCodeCredentialPool((tier) => [{
      api_key: tier === "go" ? "go-pool-key" : "zen-pool-key",
      tier,
      created_at: "2026-05-15T00:00:00.000Z",
    }]);
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        data: [
          { id: url.includes("/go/") ? "go-model" : "zen-model" },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        "opencode-go": true,
        "opencode-zen": true,
      };
      const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
      const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);

      expect(models["opencode-go"]).toEqual(["go-model"]);
      expect(models["opencode-zen"]).toEqual(["zen-model"]);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://opencode.ai/zen/go/v1/models",
        expect.objectContaining({ headers: { Authorization: "Bearer go-pool-key" } }),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        `${OPENCODE_BASE_URL}/models`,
        expect.objectContaining({ headers: { Authorization: "Bearer zen-pool-key" } }),
      );
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("diagnoses missing OpenCode API credentials for requested subscription tiers", async () => {
    const poolSpy = mockOpenCodeCredentialPool();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "opencode-go": true,
        "opencode-zen": true,
      });

      expect(discovered["opencode-go"]).toMatchObject({
        models: [],
        status: "missing_auth",
        reason: "No OpenCode Go credential is linked.",
        authState: "missing",
      });
      expect(discovered["opencode-zen"]).toMatchObject({
        models: [],
        status: "missing_auth",
        reason: "No OpenCode Zen credential is linked.",
        authState: "missing",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("diagnoses OpenCode subscription model endpoint failures", async () => {
    const poolSpy = mockOpenCodeCredentialPool((tier) => [{
      api_key: "test-opencode-key",
      tier,
      created_at: "2026-01-01T00:00:00.000Z",
    }]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "opencode-go": true,
      });

      expect(discovered["opencode-go"]).toMatchObject({
        models: [],
        status: "endpoint_error",
        reason: "OpenCode Go model endpoint failed.",
        authState: "unknown",
      });
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("diagnoses empty OpenCode subscription model responses", async () => {
    const poolSpy = mockOpenCodeCredentialPool((tier) => [{
      api_key: "test-opencode-key",
      tier,
      created_at: "2026-01-01T00:00:00.000Z",
    }]);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "opencode-zen": true,
      });

      expect(discovered["opencode-zen"]).toMatchObject({
        models: [],
        status: "empty_model_list",
        reason: "OpenCode Zen model endpoint returned an empty model list.",
        authState: "unknown",
      });
    } finally {
      poolSpy.mockRestore();
    }
  });

  it("discovers codex-oauth models from live OAuth auth and the Codex models endpoint", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([{ credentialId: "test", accessToken: "test-codex-token" }]);
    const fetchSpy = vi.fn(async (url: string, _options?: RequestInit) => {
      const requestedUrl = new URL(url);
      return {
        ok: (
          requestedUrl.origin === "https://chatgpt.com"
          && requestedUrl.pathname === "/backend-api/codex/models"
          && requestedUrl.searchParams.get("client_version") === "2.0.0"
        ),
        json: async () => ({
          models: [
            {
              slug: "gpt-5.4",
              shell_type: "shell_command",
              apply_patch_tool_type: "freeform",
              supports_parallel_tool_calls: true,
              context_window: 272000,
              input_modalities: ["text", "image"],
              default_reasoning_level: "medium",
              supported_reasoning_levels: [
                { effort: "low", description: "Fast responses with lighter reasoning" },
                { effort: "medium", description: "Balances speed and reasoning depth" },
                { effort: "high", description: "Greater reasoning depth" },
              ],
            },
            {
              slug: "gpt-5.4-mini",
              shell_type: "disabled",
            },
            {
              slug: "gpt-no-functions",
              supports_tools: false,
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        "codex-oauth": true,
      };
      const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
      const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);
      expect(models["codex-oauth"]).toEqual(["gpt-5.4", "gpt-5.4-mini", "gpt-no-functions"]);
      expect(discovered["codex-oauth"]?.modelCapabilities).toEqual({
        "gpt-5.4": {
          supportsNativeShellTools: true,
          supportsNativePatchTools: true,
          supportsParallelToolCalls: true,
          contextWindow: 272000,
          supportsVision: true,
          deliberation: {
            provider: "codex-oauth",
            model: "gpt-5.4",
            levels: [{ id: "low" }, { id: "medium" }, { id: "high" }],
            defaultLevel: "medium",
            supportsAdaptive: true,
            evidence: {
              sourceIdentity: "codex-oauth-model-catalog",
              sourceRevision: "gpt-5.4",
              observedAt: expect.any(String),
            },
          },
        },
        "gpt-5.4-mini": {
          supportsNativeShellTools: false,
        },
        "gpt-no-functions": {
          supportsFunctionTools: false,
          supportsRuntimeTools: false,
          supportsTools: false,
        },
      });
      const discoveryResults = buildGuiOperatorDiscoveryResults({
        opencodeModels: [],
        codexModels: [],
        providerAvailability,
        directProviderDiscovery: discovered,
        lastCheckedAt: "2026-04-28T12:00:00.000Z",
      });
      expect(discoveryResults.find((entry) => entry.provider === "codex-oauth")?.modelCapabilities)
        .toEqual(discovered["codex-oauth"]?.modelCapabilities);
      const [url, options] = fetchSpy.mock.calls[0] ?? [];
      const requestedUrl = new URL(String(url));
      expect(requestedUrl.origin).toBe("https://chatgpt.com");
      expect(requestedUrl.pathname).toBe("/backend-api/codex/models");
      expect(requestedUrl.searchParams.get("client_version")).toBe("2.0.0");
      expect(options).toEqual(expect.objectContaining({
        headers: { Authorization: "Bearer test-codex-token" },
      }));
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("skips backend-invalidated codex-oauth credentials during model discovery", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([
        { credentialId: "old", accessToken: "old-invalidated-token" },
        { credentialId: "fresh", accessToken: "fresh-token" },
      ]);
    const recordAuthenticationFailureSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "recordAuthenticationFailure")
      .mockResolvedValue();
    const fetchSpy = vi.fn(async (_url: string, options?: RequestInit) => {
      const authorization = (options?.headers as Record<string, string> | undefined)?.Authorization;
      if (authorization === "Bearer old-invalidated-token") {
        return {
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => JSON.stringify({
            error: {
              message: "Your authentication token has been invalidated. Please try signing in again.",
              code: "token_invalidated",
            },
          }),
        };
      }
      return {
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ models: [{ slug: "gpt-5.4" }] }),
      };
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });

      expect(discovered["codex-oauth"]).toMatchObject({
        models: ["gpt-5.4"],
        status: "available",
        authState: "authenticated",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls.map(([, options]) => (options?.headers as Record<string, string>).Authorization))
        .toEqual(["Bearer old-invalidated-token", "Bearer fresh-token"]);
      expect(recordAuthenticationFailureSpy).toHaveBeenCalledWith("old");
    } finally {
      codexAuthSpy.mockRestore();
      recordAuthenticationFailureSpy.mockRestore();
    }
  });

  it("diagnoses missing codex-oauth OAuth credentials", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([]);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });
      expect(discovered["codex-oauth"]).toMatchObject({
        models: [],
        status: "missing_auth",
        reason: "Codex OAuth authentication is missing.",
        authState: "missing",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("diagnoses expired codex-oauth OAuth credentials", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockRejectedValue(new Error("refresh token expired"));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });
      expect(discovered["codex-oauth"]).toMatchObject({
        models: [],
        status: "auth_expired",
        reason: "Codex OAuth authentication is expired.",
        authState: "expired",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("diagnoses codex-oauth model endpoint failure", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([{ credentialId: "test", accessToken: "test-codex-token-endpoint-failure" }]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });
      expect(discovered["codex-oauth"]).toMatchObject({
        models: [],
        status: "endpoint_error",
        reason: "Codex OAuth model endpoint failed.",
        authState: "unknown",
      });
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("diagnoses an empty codex-oauth model response", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([{ credentialId: "test", accessToken: "test-codex-token-empty-models" }]);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ models: [] }),
    })));

    try {
      const discovered = await discoverGuiDirectProviderModelDiscovery({
        "codex-oauth": true,
      });
      expect(discovered["codex-oauth"]).toMatchObject({
        models: [],
        status: "empty_model_list",
        reason: "Codex OAuth model endpoint returned an empty model list.",
        authState: "unknown",
      });
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("reuses in-flight and cached codex-oauth model discovery", async () => {
    const codexAuthSpy = vi
      .spyOn(CodexOAuthCredentialPoolService.prototype, "listValidAccessTokenCandidates")
      .mockResolvedValue([{ credentialId: "test", accessToken: "test-codex-token-cache" }]);
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        models: [{ slug: "gpt-5.4" }],
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        "codex-oauth": true,
      };
      const [first, second] = await Promise.all([
        discoverGuiDirectProviderModelDiscovery(providerAvailability),
        discoverGuiDirectProviderModelDiscovery(providerAvailability),
      ]);
      const third = await discoverGuiDirectProviderModelDiscovery(providerAvailability);

      expect(projectDirectProviderDiscoveryForTest(first, providerAvailability)["codex-oauth"]).toEqual(["gpt-5.4"]);
      expect(projectDirectProviderDiscoveryForTest(second, providerAvailability)["codex-oauth"]).toEqual(["gpt-5.4"]);
      expect(projectDirectProviderDiscoveryForTest(third, providerAvailability)["codex-oauth"]).toEqual(["gpt-5.4"]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      codexAuthSpy.mockRestore();
    }
  });

  it("does not expose opencode-go/opencode-zen without live OpenCode auth and /models discovery", async () => {
    const poolSpy = mockOpenCodeCredentialPool();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const providerAvailability = {
        "opencode-go": true,
        "opencode-zen": true,
      };
      const discovered = await discoverGuiDirectProviderModelDiscovery(providerAvailability);
      const models = projectDirectProviderDiscoveryForTest(discovered, providerAvailability);
      expect(models["opencode-go"]).toBeUndefined();
      expect(models["opencode-zen"]).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalledWith(
        `${OPENCODE_BASE_URL}/models`,
        expect.anything(),
      );
    } finally {
      poolSpy.mockRestore();
    }
  });
});

describe("buildWelcomeProviderDescriptors", () => {
  it("includes live modeled providers and strips stale model lists from model-less providers", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      claude: ["claude-sonnet-4-6"],
      "opencode-go": ["minimax-m2.5"],
      openai: ["gpt-5.4"],
    });

    expect(descriptors).toEqual([
      expect.objectContaining({
        id: "claude",
        models: [],
        available: true,
      }),
      expect.objectContaining({
        id: "opencode-go",
        models: ["minimax-m2.5"],
        available: true,
      }),
      expect.objectContaining({
        id: "openai",
        models: ["gpt-5.4"],
        available: true,
      }),
    ]);
  });

  it("omits metadata-only providers when they are absent from the live model map", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      claude: ["claude-sonnet-4-6"],
      "codex-oauth": ["gpt-5.4-mini"],
    });

    expect(descriptors.map((descriptor) => descriptor.id)).toEqual([
      "claude",
      "codex-oauth",
    ]);
    expect(descriptors.find((descriptor) => descriptor.id === "opencode-go")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "opencode-zen")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "openai")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "anthropic")).toBeUndefined();
  });

  it("omits providers whose advertised model lists are empty instead of surfacing unavailable static descriptors", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      openai: [],
      anthropic: ["claude-sonnet-4-6"],
      "opencode-go": [],
      "opencode-zen": [],
    });

    expect(descriptors.map((descriptor) => descriptor.id)).toEqual(["anthropic"]);
    expect(descriptors.find((descriptor) => descriptor.id === "openai")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "opencode-go")).toBeUndefined();
    expect(descriptors.find((descriptor) => descriptor.id === "opencode-zen")).toBeUndefined();
  });

  it("includes model-less Claude as an available welcome provider descriptor", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      claude: [],
    });

    expect(descriptors).toEqual([
      expect.objectContaining({
        id: "claude",
        available: true,
        models: [],
      }),
    ]);
  });

  it("does not expose codex-oauth when codex discovery returns no models", () => {
    const descriptors = buildWelcomeProviderDescriptors(
      projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput()),
    );

    expect(descriptors.find((descriptor) => descriptor.id === "codex-oauth")?.available ?? false).toBe(false);
  });

  it("does not expose codex or codex-oauth when codex discovery returns no models", () => {
    const models = projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput());

    expect(models.codex).toBeUndefined();
    expect(models["codex-oauth"]).toBeUndefined();

    const descriptors = buildWelcomeProviderDescriptors(models);

    expect(descriptors.find((descriptor) => descriptor.id === "codex")?.available ?? false).toBe(false);
    expect(descriptors.find((descriptor) => descriptor.id === "codex-oauth")?.available ?? false).toBe(false);
  });

  it("does not expose opencode as available when discovery returns no models", () => {
    const descriptors = buildWelcomeProviderDescriptors(
      projectGuiOperatorDiscoveryInput(makeGuiOperatorDiscoveryBuilderInput()),
    );

    expect(descriptors.find((descriptor) => descriptor.id === "opencode")?.available ?? false).toBe(false);
  });

  it("does not surface unknown provider ids from the operator models map", () => {
    const descriptors = buildWelcomeProviderDescriptors({
      claude: ["claude-sonnet-4-6"],
      unknown: ["mystery-model"],
    });

    expect(descriptors.map((descriptor) => descriptor.id)).not.toContain("unknown");
  });
});
