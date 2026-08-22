import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentTaskApplicationService,
  RuntimeManagedAgentInvocationService,
  SqliteManagedAccountLeaseAuthority,
  type AgentTaskRecord,
} from "@kilnai/runtime";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

/**
 * Shared between the `config-status.js` mock (still the sole source of
 * `workGovernance` evidence, consulted by `inspection.inspectWorkGovernance()`)
 * and the `global-config.js` mock below. Managed-agent intent remains global,
 * while target and authority identity live in their dedicated V4 catalogs.
 */
const TEST_MANAGED_AGENTS_CONFIG = {
  enabled: true,
  defaultAuthorityProfileId: "test-readonly",
  intents: [{
    id: "test-agent",
    purpose: "Run the bounded managed test agent.",
    authorityProfileId: "test-readonly",
    target: { mode: "explicit", targetId: "managed-codex" },
    paidUsage: "ask-before-spend",
  }],
} as const;

const TEST_AUTHORITY_PROFILES = [{
  id: "test-readonly",
  admissionProfile: "foundation-readonly-plan",
  workingDirectory: "project",
  tools: {
    allowed: ["read"],
    network: false,
    writes: false,
  },
  memory: { access: "read-only" },
}] as const;

const TEST_TARGET_CATALOG = {
  evidenceRevision: `sha256:${"0".repeat(64)}` as const,
  accounts: [{
    id: "test-account",
    providerId: "codex-oauth",
    credentialId: "synthetic-test-credential",
    maxConcurrency: 1,
    reservedAffinitySlots: 0,
    economics: { creditPosture: "disabled", overagePosture: "disabled" },
  }],
  accountPolicies: [{ id: "managed-codex-policy", accountIds: ["test-account"], strategy: "economic-least-pressure" }],
  targets: [{
    id: "managed-codex",
    kind: "direct",
    label: "Managed Codex",
    providerId: "codex-oauth",
    providerModelId: "gpt-5.6-terra",
    dataClassification: "internal",
    accountSelection: { mode: "automatic", accountPolicyId: "managed-codex-policy" },
    economics: { authBillingChannel: "oauth", executionMode: "direct", serviceTier: "standard", fallbackPosture: "disabled", overagePosture: "disabled", executionEnvelope: { limits: [] } },
  }],
} as const;

vi.mock("../../src/config/config-merger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/config-merger.js")>();
  return {
    ...actual,
    loadResolvedKilnMcpConfiguration: vi.fn(() => ({
      servers: {},
      diagnostics: [],
    })),
  };
});

vi.mock("../../src/config/global-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/global-config.js")>();
  const fixtures = await import("../config/execution-target-evidence-fixture.js");
  const config = (): import("../../src/config/global-config.js").KilnGlobalConfig => ({
    version: "4",
    managedAgents: TEST_MANAGED_AGENTS_CONFIG,
    authorityProfiles: TEST_AUTHORITY_PROFILES,
    targetCatalog: TEST_TARGET_CATALOG,
  });
  return {
    ...actual,
    readGlobalConfig: vi.fn(config),
    readGlobalExecutionTargetAuthority: vi.fn(() => fixtures.syntheticExecutionTargetAuthority(config())),
  };
});

vi.mock("../../src/application/config-status.js", () => ({
  readConfigStatusSnapshot: vi.fn(async (options?: { readonly projectPath?: string }) => {
    const projectRoot = options?.projectPath ?? "C:/workspace/unresolved";
    const effectiveConfig = {
      schemaRevision: 1,
      health: "current",
      fields: [{
        identity: "/workGovernance",
        value: {
        defaultPosture: "orchestrate",
        requireDelegationFor: ["managed-agents"],
        requiredEvidence: ["surface-map", "tests"],
        },
        scope: "effective",
        source: "global",
        sourcePath: "C:/Users/ExampleUser/.kiln/config.yaml",
        defaultStatus: "explicit",
        overrideChain: [{
          scope: "global",
          sourcePath: "C:/Users/ExampleUser/.kiln/config.yaml",
          disposition: "selected",
        }],
        health: "current",
        schemaRevision: 1,
        activation: "next-turn",
        sensitivity: "public",
      }],
    };
    return {
      evidenceVersion: 3,
      generatedAt: new Date().toISOString(),
      project: {
        rootPath: projectRoot,
        projectName: "kiln",
        hasGitRoot: true,
        hasKilnYaml: true,
        kilnYaml: { path: resolve(projectRoot, ".kiln", "kiln.yaml"), status: "valid" },
        projectContext: { path: resolve(projectRoot, ".kiln", "project-context.md"), status: "valid" },
      },
      global: { path: "C:/Users/ExampleUser/.kiln/config.yaml", status: "valid" },
      effectiveConfigStatus: "valid",
      effectiveConfig,
      errors: [],
      projections: [],
      permissionIntegrity: [],
      mcp: { servers: [], diagnostics: [] },
      setup: {
        projectRoot,
        projectContext: {
          path: resolve(projectRoot, ".kiln", "project-context.md"),
          status: "valid",
          recommendation: "none",
        },
        repoShims: [],
        globalInstructionShims: [],
        nativeProjections: [],
        permissionIntegrity: [],
        recommendedActions: ["none"],
      },
      harnessCapabilities: [],
    };
  }),
}));

import {
  createOperatorProjectAgentTaskApplicationComposition,
  createOperatorProjectAgentTaskApplicationService,
  OperatorProjectAgentTaskDispatcher,
  summarizeOperatorProjectManagedAgents,
} from "../../src/application/operator-project-agent-tasks.js";
import { readConfigStatusSnapshot } from "../../src/application/config-status.js";

describe("operator project agent-task production composition", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires the server-trusted project root and never falls back to discovery", async () => {
    await expect(createOperatorProjectAgentTaskApplicationComposition({
      projectPath: undefined,
    } as never)).rejects.toMatchObject({ code: "project_identity_unavailable" });
  });

  it("coalesces dispatch by job id, drains active work, and turns worker failures terminal", async () => {
    const dispatch = deferred<AgentTaskRecord>();
    const failed = {
      ...({} as AgentTaskRecord),
      id: "job-async-0001",
      state: "failed" as const,
    };
    const service = {
      dispatch: vi.fn(async () => dispatch.promise),
      failDispatch: vi.fn(async () => failed),
    };
    const dispatcher = new OperatorProjectAgentTaskDispatcher(service);

    const first = dispatcher.dispatch("job-async-0001");
    const duplicate = dispatcher.dispatch("job-async-0001");
    expect(first).toBe(duplicate);
    await vi.waitFor(() => expect(service.dispatch).toHaveBeenCalledOnce());
    expect(service.dispatch).toHaveBeenCalledOnce();

    let drained = false;
    const close = dispatcher.close().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    dispatch.resolve(failed);
    await expect(close).resolves.toBeUndefined();
    expect(drained).toBe(true);

    const rejected = {
      ...({} as AgentTaskRecord),
      id: "job-async-0002",
      state: "queued" as const,
    };
    const failedDispatcher = new OperatorProjectAgentTaskDispatcher({
      dispatch: vi.fn(async () => { throw new Error("worker failure"); }),
      failDispatch: vi.fn(async () => ({ ...rejected, state: "failed" as const })),
    });
    await expect(failedDispatcher.dispatch(rejected.id)).resolves.toMatchObject({
      id: rejected.id,
      state: "failed",
    });
    await failedDispatcher.close();
  });

  it("rejects canonical governance evidence bound to a different project", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "kiln-agent-task-governance-root-"));
    mkdirSync(resolve(projectRoot, ".kiln"), { recursive: true });
    writeFileSync(resolve(projectRoot, ".kiln", "kiln.yaml"), "version: '1'\n", "utf8");
    const composition = await createOperatorProjectAgentTaskApplicationComposition({
      projectPath: projectRoot,
      discoverProviderModels: async () => ({}),
    });
    try {
      const candidate = await readConfigStatusSnapshot({ projectPath: projectRoot });
      vi.mocked(readConfigStatusSnapshot).mockResolvedValueOnce({
        ...candidate,
        project: { ...candidate.project, rootPath: resolve(projectRoot, "other-project") },
      });
      await expect(composition.application.accept({
        objective: "Reject cross-project governance evidence.",
        configuredAgentProfileId: "missing-agent",
        callerId: "claude-native-harness",
        idempotencyKey: "cross-project-governance-proof",
      })).rejects.toMatchObject({ code: "governance_unavailable" });
    } finally {
      await composition.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("recovers persisted jobs without constructing an execution owner", async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), "kiln-agent-task-recovery-"));
    mkdirSync(resolve(projectRoot, ".kiln"), { recursive: true });
    writeFileSync(resolve(projectRoot, ".kiln", "kiln.yaml"), "version: '1'\n", "utf8");
    const recoverInvocations = vi
      .spyOn(RuntimeManagedAgentInvocationService.prototype, "recoverPersistedInvocations")
      .mockResolvedValue({ recovered: [], accountLeases: [] });
    const recoveryOrder: string[] = [];
    const recoverCommitments = vi
      .spyOn(SqliteManagedAccountLeaseAuthority.prototype, "recoverCommitments")
      .mockImplementation(() => {
        recoveryOrder.push("authority");
        return [];
      });
    const recoverInterrupted = vi
      .spyOn(AgentTaskApplicationService.prototype, "recoverInterrupted")
      .mockImplementation(async () => {
        recoveryOrder.push("jobs");
        return [];
      });

    try {
      const composition = await createOperatorProjectAgentTaskApplicationComposition({
        discoverProviderModels: async () => ({}),
        projectPath: projectRoot,
      });
      await composition.close();

      expect(recoverInvocations).not.toHaveBeenCalled();
      expect(recoverInterrupted).toHaveBeenCalledOnce();
      expect(recoveryOrder).toEqual(["authority", "jobs"]);
    } finally {
      recoverInvocations.mockRestore();
      recoverInterrupted.mockRestore();
      recoverCommitments.mockRestore();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("projects policy agents from candidate admission without selecting a route", () => {
    const route = (id: string, providerId: string) => ({
      routeId: id,
      providerId,
      economicPolicyIds: ["bounded-policy"],
      economicCapability: {
        status: "verified",
        adapterCapabilityId: `${providerId}-direct`,
        adapterCapabilityVersion: "1",
      },
      profiles: [{
        authorityProfileId: "test-readonly",
        admissionProfile: "foundation-readonly-plan",
      }],
    });
    const agents = [
      { name: "economic-worker", role: "Policy-only worker", goal: "Policy-only economic worker.", tier: "fast" as const, scope: "project" as const, authorityProfileId: "test-readonly" },
    ];

    expect(summarizeOperatorProjectManagedAgents(agents, undefined)).toMatchObject([{
      configuredAgentProfileId: "economic-worker",
      availability: "unavailable",
      admissionProfileId: "foundation-readonly-plan",
      diagnostic: "route_unavailable",
    }]);
    expect(summarizeOperatorProjectManagedAgents(agents, {
      routes: [
        route("codex-route", "codex-oauth"),
        route("opencode-route", "opencode-go"),
      ],
      agentCatalog: [{
        name: "economic-worker",
        authorityProfileId: "test-readonly",
        admissionProfile: "foundation-readonly-plan",
        economicPolicyId: "bounded-policy",
        economicPolicyRevision: "revision-001",
        economicPolicyCandidateRouteIds: ["codex-route", "opencode-route"],
      }],
    } as never)).toMatchObject([{
      configuredAgentProfileId: "economic-worker",
      availability: "admitted",
      admissionProfileId: "foundation-readonly-plan",
    }]);
    expect(summarizeOperatorProjectManagedAgents(agents, {
      routes: [],
      agentCatalog: [{
        name: "economic-worker",
        authorityProfileId: "test-readonly",
        admissionProfile: "foundation-readonly-plan",
        economicPolicyId: "bounded-policy",
        economicPolicyRevision: "revision-001",
        economicPolicyCandidateRouteIds: ["codex-route"],
      }],
      unavailableRoutes: [{ routeId: "codex-route", providerId: "codex-oauth", profiles: ["foundation-readonly-plan"] }],
    } as never)[0]).toMatchObject({
      configuredAgentProfileId: "economic-worker",
      availability: "unresolved",
      admissionProfileId: "foundation-readonly-plan",
      diagnostic: "eligibility_unresolved",
    });
  });

  it("does not admit a native-harness agent through a runtime-selected route", () => {
    const nativeRoute = {
      routeId: "claude-runtime-selected",
      routeSource: "explicit-managed-route" as const,
      providerId: "claude",
      model: "claude-sonnet-5",
      capability: {
        identity: { routeId: "claude-runtime-selected", revision: "configured-v1" },
        target: { providerId: "claude", modelId: "claude-sonnet-5" },
        adapter: { kind: "cli-harness" as const, capabilityId: "managed:claude-runtime-selected", capabilityVersion: "v1" },
        authorityCeiling: "read_only" as const,
        toolNames: ["read"],
        supportsRecursion: true,
        supportsAttachments: true,
        supportsWrite: false,
        proof: { status: "configured" as const, source: "provider-adapter-catalog" as const, provenProfiles: ["foundation-readonly-plan" as const] },
        capacity: { kind: "policy-bound" as const, accountPolicyId: "managed-claude" },
        settlement: { kind: "not-required" as const },
      },
      profiles: [{
        authorityProfileId: "test-readonly",
        admissionProfile: "foundation-readonly-plan" as const,
      }],
    };

    expect(summarizeOperatorProjectManagedAgents([
      { name: "native-reviewer", role: "Native reviewer", goal: "Native reviewer.", tier: "fast", scope: "project", targetId: nativeRoute.routeId, authorityProfileId: "test-readonly" },
    ], {
      routes: [nativeRoute],
      agentCatalog: [{
        name: "native-reviewer",
        routeId: nativeRoute.routeId,
        authorityProfileId: "test-readonly",
        admissionProfile: "foundation-readonly-plan",
      }],
    } as never)).toMatchObject([{
      configuredAgentProfileId: "native-reviewer",
      availability: "unavailable",
      diagnostic: "route_unavailable",
    }]);
  });

  it("uses the real application owner and fails a missing configured profile before provider execution", async () => {
    const recoverInterrupted = vi
      .spyOn(AgentTaskApplicationService.prototype, "recoverInterrupted")
      .mockResolvedValue([]);
    const service = await createOperatorProjectAgentTaskApplicationService({ projectPath: REPOSITORY_ROOT, discoverProviderModels: async () => ({}) });
    await expect(service.accept({
      objective: "Bounded production composition proof.",
      configuredAgentProfileId: "missing-agent",
      callerId: "codex-app",
      idempotencyKey: "production-composition-proof",
    })).rejects.toMatchObject({ code: "profile_unavailable" });
    recoverInterrupted.mockRestore();
  });
});
