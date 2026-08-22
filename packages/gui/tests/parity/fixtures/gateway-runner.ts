import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildGuiOperatorDiscoveryResults,
  OperatorSessionExecutionBridge,
  projectAvailableModelCatalogForExecutionRoutes,
  projectGuiProviderModelDiscovery,
  startGuiGateway,
  type CliSessionFactory,
  type OperatorExecutionRouteSelectionPort,
  type OperatorTurnDispatchPort,
  type OperatorTurnDispatchResult,
  type OperatorTurnGuiDispatchPayload,
} from "../../../../runtime/src/index.js";
import {
  createCurrentExecutionRoute,
  parseExecutionTargetWizardRevision,
} from "../../../../cli/src/application/current-execution-route-creation.js";
import {
  defineExecutionTargetEvidenceSnapshot,
  executionTargetEvidenceRevision,
  projectExecutionCatalogFromIntent,
  type ExecutionTargetCatalogIntent,
  type ExecutionTargetEvidenceSnapshot,
} from "../../../../cli/src/config/execution-target-evidence-store.js";
import {
  InMemoryContextArtifactCache,
  SqliteMemoryRepository,
  type CreateMemoryRecordInput,
  type ExecutionCatalogInput,
  type MemoryProvenance,
} from "@kilnai/core";
import {
  OPERATOR_THEME_LABELS,
  OPERATOR_THEME_NAMES,
  type OperatorThemeName,
  type GuiProviderDiscoveryResult,
  type GuiSessionDetail,
  type OperatorSessionSummary,
  type KilnConfigSetupSnapshot,
  type ExecutionRouteCatalog,
  type KilnSettingsMutationResult,
  type KilnSettingsProposalProjection,
  type KilnSettingsProposalRequest,
  type KilnSettingsSnapshot,
} from "@kilnai/gateway-contracts";

function parseGatewayPort(): number {
  const raw = process.env.GUI_GATEWAY_PORT ?? "0";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid GUI_GATEWAY_PORT: ${raw}`);
  }
  return parsed;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizePrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (compact.length <= 60) return compact;
  return `${compact.slice(0, 57)}...`;
}

function responseChunks(prompt: string, userTurns: number): readonly string[] {
  if (prompt.toLowerCase().includes("markdown rendering check")) {
    return [
      "Checklist:\n\n",
      "- Provider discovery\n",
      "- GUI rendering\n\n",
      "| Surface | Status |\n| --- | --- |\n| Chat | fixed |\n",
    ];
  }
  if (prompt.toLowerCase().includes("hold stream for provider switch")) {
    return [
      "Reply ",
      "streaming ",
      "while ",
      "provider ",
      "selection ",
      "changes ",
      "for ",
      `echo:${summarizePrompt(prompt)}`,
    ];
  }
  return [
    "Reply ",
    `users:${userTurns} `,
    `echo:${summarizePrompt(prompt)}`,
  ];
}

const sessionSummaries: OperatorSessionSummary[] = [
  {
    sessionId: "claude-session-1",
    title: "Summarize parity checklist",
    tags: [],
    routesUsed: ["claude-default"],
    lastRoute: { routeId: "claude-default", provider: "claude" },
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    costUsd: 0.0123,
  },
  {
    sessionId: "claude-session-2",
    title: "Generate test fixture output",
    tags: [],
    routesUsed: ["claude-default"],
    lastRoute: { routeId: "claude-default", provider: "claude" },
    updatedAt: new Date(Date.now() - 120_000).toISOString(),
    costUsd: 0.0042,
  },
  {
    sessionId: "codex-session-1",
    title: "Refactor command routing",
    tags: [],
    routesUsed: ["codex-default"],
    lastRoute: { routeId: "codex-default", provider: "codex" },
    updatedAt: new Date(Date.now() - 180_000).toISOString(),
    costUsd: 0.0301,
  },
  {
    sessionId: "context-partial-session",
    title: "Inspect partial context evidence",
    tags: [],
    routesUsed: ["claude-default"],
    lastRoute: { routeId: "claude-default", provider: "claude" },
    updatedAt: new Date(Date.now() - 240_000).toISOString(),
    costUsd: 0.001,
  },
  {
    sessionId: "context-authoritative-session",
    title: "Inspect authoritative context evidence",
    tags: [],
    routesUsed: ["codex-default"],
    lastRoute: { routeId: "codex-default", provider: "codex" },
    updatedAt: new Date(Date.now() - 300_000).toISOString(),
    costUsd: 0.001,
  },
];

const operatorDiscovery: readonly GuiProviderDiscoveryResult[] = buildGuiOperatorDiscoveryResults({
  opencodeModels: [],
  codexModels: [],
  directProviderDiscovery: {
    "codex-oauth": {
      models: ["gpt-5.6-sol", "gpt-5.6-terra"],
      status: "available",
      reason: "Parity Codex OAuth models discovered.",
      authState: "authenticated",
    },
  },
  providerAvailability: {
    claude: true,
    codex: false,
    opencode: false,
  },
  lastCheckedAt: new Date().toISOString(),
});

const restoredSessionDetail: GuiSessionDetail = {
  id: "claude-session-1",
  meta: {
    kilnSessionId: "claude-session-1",
    title: "Summarize parity checklist",
    task: "Summarize parity checklist",
    startedAt: "2026-07-03T12:00:00.000Z",
    completedAt: "2026-07-03T12:00:03.000Z",
    lastProvider: "claude",
  },
  events: [
    {
      eventId: "parity-user-1",
      kilnSessionId: "claude-session-1",
      sequence: 1,
      timestamp: "2026-07-03T12:00:00.000Z",
      kind: "user_message",
      turnId: "parity-turn-1",
      payload: { content: "Read the persisted parity plan" },
    },
    {
      eventId: "parity-tool-start-1",
      kilnSessionId: "claude-session-1",
      sequence: 2,
      timestamp: "2026-07-03T12:00:01.000Z",
      kind: "tool_call_started",
      turnId: "parity-turn-1",
      payload: {
        toolCallId: "parity-tool-1",
        toolCallScopeId: "parity-turn-1",
        toolName: "read",
        input: { path: "docs/plan.md" },
      },
    },
    {
      eventId: "parity-tool-start-1",
      kilnSessionId: "claude-session-1",
      sequence: 2,
      timestamp: "2026-07-03T12:00:01.000Z",
      kind: "tool_call_started",
      turnId: "parity-turn-1",
      payload: {
        toolCallId: "parity-tool-1",
        toolCallScopeId: "parity-turn-1",
        toolName: "read",
        input: { path: "duplicate-must-not-render.md" },
      },
    },
    {
      eventId: "parity-tool-complete-1",
      kilnSessionId: "claude-session-1",
      sequence: 3,
      timestamp: "2026-07-03T12:00:02.000Z",
      kind: "tool_call_completed",
      turnId: "parity-turn-1",
      payload: {
        toolCallId: "parity-tool-1",
        toolCallScopeId: "parity-turn-1",
        toolName: "read",
        output: "Persisted parity plan contents",
        status: { state: "succeeded" },
      },
    },
    {
      eventId: "parity-tool-complete-1",
      kilnSessionId: "claude-session-1",
      sequence: 3,
      timestamp: "2026-07-03T12:00:02.000Z",
      kind: "tool_call_completed",
      turnId: "parity-turn-1",
      payload: {
        toolCallId: "parity-tool-1",
        toolCallScopeId: "parity-turn-1",
        toolName: "read",
        output: "Duplicate terminal payload",
        status: { state: "succeeded" },
      },
    },
    {
      eventId: "parity-assistant-1",
      kilnSessionId: "claude-session-1",
      sequence: 4,
      timestamp: "2026-07-03T12:00:03.000Z",
      kind: "assistant_message",
      turnId: "parity-turn-1",
      payload: { content: "The persisted parity plan is ready." },
    },
    {
      eventId: "parity-context-restored",
      kilnSessionId: "claude-session-1",
      sequence: 5,
      timestamp: "2026-07-03T12:00:03.000Z",
      kind: "context_usage_observed",
      turnId: "parity-turn-1",
      payload: {
        contextUsage: {
          state: "authoritative",
          usedTokens: 2_400,
          contextWindowTokens: 8_000,
          remainingTokens: 5_600,
          usedPercentage: 30,
          providerId: "claude",
          modelId: "claude-sonnet-4-6",
          turnId: "parity-turn-1",
          observedAt: "2026-07-03T12:00:03.000Z",
          measurement: "provider_reported",
          lifecycle: "restored",
          contextWindowAuthority: "provider_reported",
          freshness: "historical",
        },
      },
    },
  ],
};

const contextSessionDetails: Record<string, GuiSessionDetail> = {
  "context-partial-session": {
    id: "context-partial-session",
    meta: { kilnSessionId: "context-partial-session", title: "Inspect partial context evidence", startedAt: "2026-07-03T12:00:00.000Z" },
    events: [{
      eventId: "parity-context-partial",
      kilnSessionId: "context-partial-session",
      sequence: 1,
      timestamp: "2026-07-03T12:00:00.000Z",
      kind: "context_usage_observed",
      turnId: "context-partial-session:turn:1",
      payload: {
        contextUsage: {
          state: "partial",
          usedTokens: 2_400,
          providerId: "claude",
          modelId: "claude-sonnet-4-6",
          turnId: "context-partial-session:turn:1",
          observedAt: "2026-07-03T12:00:00.000Z",
          measurement: "runtime_estimate",
          lifecycle: "completed",
          contextWindowAuthority: "runtime_observed",
          freshness: "fresh",
          reason: "No provider-authoritative context window is available.",
        },
      },
    }],
  },
  "context-authoritative-session": {
    id: "context-authoritative-session",
    meta: { kilnSessionId: "context-authoritative-session", title: "Inspect authoritative context evidence", startedAt: "2026-07-03T12:00:00.000Z" },
    events: [{
      eventId: "parity-context-authoritative",
      kilnSessionId: "context-authoritative-session",
      sequence: 1,
      timestamp: "2026-07-03T12:00:00.000Z",
      kind: "context_usage_observed",
      turnId: "context-authoritative-session:turn:1",
      payload: {
        contextUsage: {
          state: "authoritative",
          usedTokens: 2_000,
          contextWindowTokens: 8_000,
          remainingTokens: 6_000,
          usedPercentage: 25,
          providerId: "codex",
          modelId: "gpt-5.5",
          turnId: "context-authoritative-session:turn:1",
          observedAt: "2026-07-03T12:00:00.000Z",
          measurement: "provider_reported",
          lifecycle: "completed",
          contextWindowAuthority: "provider_reported",
          freshness: "fresh",
        },
      },
    }],
  },
};

const fakeSessionFactory: CliSessionFactory = () => ({
  async *run(options) {
    const userTurns = options.messages
      ?.filter((message) => message.role === "user")
      .length ?? 1;
    const prompt = options.prompt.trim();
    const chunks = responseChunks(prompt, userTurns);
    const toolCallScopeId = `parity-e2e-tool-scope:${userTurns}`;

    if (prompt.toLowerCase().includes("tool continuity browser check")) {
      await delay(800);
      yield {
        type: "tool_use",
        toolName: "read",
        input: { path: "docs/plan.md" },
        toolCallId: "parity-live-tool-1",
        toolCallScopeId,
      };
      yield {
        type: "tool_use",
        toolName: "read",
        input: { path: "docs/roadmap/02-public-release-ui-debt.md" },
        toolCallId: "parity-live-tool-2",
        toolCallScopeId,
      };
      await delay(2_500);
      yield {
        type: "tool_result",
        toolName: "read",
        output: "Second tool failed",
        outputSummary: "Second tool failed",
        toolCallId: "parity-live-tool-2",
        toolCallScopeId,
        isError: true,
      };
      yield {
        type: "tool_result",
        toolName: "read",
        output: "First tool result",
        outputSummary: "First tool result",
        toolCallId: "parity-live-tool-1",
        toolCallScopeId,
        isError: false,
      };
    }

    if (prompt.toLowerCase().includes("paused work item visual check")) {
      yield {
        type: "tool_use",
        toolName: "work_item.execution.start",
        input: { workItemId: "inspect-composer-activity-ownership" },
        toolCallId: "parity-paused-work-item",
        toolCallScopeId,
      };
      await delay(250);
      yield {
        type: "tool_result",
        toolName: "work_item.execution.start",
        output: JSON.stringify({
          status: "paused",
          reason: "managedInvocationId is required before starting managed-delegation execution.",
          workItemId: "inspect-composer-activity-ownership",
          routeId: "opencode-go-qwen3-7-max-readonly",
          nextTool: "managed_agent.invoke",
          requiredEvidence: ["surface-map", "risk-hypothesis", "tests"],
        }),
        outputSummary: "Work item execution paused",
        toolCallId: "parity-paused-work-item",
        toolCallScopeId,
        isError: false,
      };
    }

    if (prompt.toLowerCase().includes("structured diagnostic visual check")) {
      yield {
        type: "tool_use",
        toolName: "goal.create",
        input: { objective: "Review the GUI" },
        toolCallId: "parity-goal-create-diagnostic",
        toolCallScopeId,
      };
      await delay(250);
      yield {
        type: "tool_result",
        toolName: "goal.create",
        output: JSON.stringify({
          error: {
            code: "invalid_input",
            message: "goal.create cannot combine preferredRouteId and managedAgentProfile.",
            recoverable: true,
            suggestedNextTool: "goal.create",
            requiredInputShape: {
              objective: "string",
              workItemIds: ["existing work item id"],
            },
          },
        }),
        outputSummary: "Goal input is invalid",
        toolCallId: "parity-goal-create-diagnostic",
        toolCallScopeId,
        isError: false,
      };
    }

    if (prompt.toLowerCase().includes("governed tool presentation visual check")) {
      yield {
        type: "tool_use",
        toolName: "work_item.update",
        input: { summary: "Inspect composer activity ownership." },
        toolCallId: "parity-work-item-update",
        toolCallScopeId,
      };
      yield {
        type: "tool_result",
        toolName: "work_item.update",
        output: JSON.stringify({
          item: {
            id: "work-1",
            summary: "Inspect composer activity ownership.",
            status: "pending",
            workflowProfile: "verification-heavy",
            risk: "medium",
            surface: "gui",
            authorityProfile: "foundation-readonly-plan",
            expectedEvidence: ["surface-map", "tests"],
            providedEvidence: ["surface-map"],
            verificationGates: ["browser-render"],
            dependencies: [],
            pauseRequirements: [],
            createdAt: "2026-07-28T09:00:00.000Z",
            updatedAt: "2026-07-28T09:00:00.000Z",
            sequence: 1,
          },
          nextRequiredTools: ["goal.create", "work_item.execution.start"],
        }),
        outputSummary: "Work item updated",
        metadata: {
          kind: "work_item",
          operation: "update",
          item: {
            id: "work-1",
            summary: "Inspect composer activity ownership.",
            status: "pending",
            workflowProfile: "verification-heavy",
            authorityProfile: "foundation-readonly-plan",
            expectedEvidence: ["surface-map", "tests"],
            providedEvidence: ["surface-map"],
            verificationGates: ["browser-render"],
            dependencies: [],
            createdAt: "2026-07-28T09:00:00.000Z",
            updatedAt: "2026-07-28T09:00:00.000Z",
            sequence: 1,
          },
        },
        toolCallId: "parity-work-item-update",
        toolCallScopeId,
        isError: false,
      };
      yield {
        type: "tool_use",
        toolName: "goal.create",
        input: { objective: "Perform evidence-backed UX verification." },
        toolCallId: "parity-goal-create",
        toolCallScopeId,
      };
      yield {
        type: "tool_result",
        toolName: "goal.create",
        output: JSON.stringify({
          goal: {
            id: "goal-1",
            objective: "Perform evidence-backed UX verification.",
            ownerSessionId: "parity-e2e-session",
            source: { kind: "operator", id: "parity-e2e" },
            planId: "interactive-ux-verification",
            status: "active",
            workItemIds: ["work-1"],
            authorityEnvelope: { maximumAuthority: "read_only", escalationPolicy: "deny" },
            routePolicy: { workflowProfile: "verification-heavy" },
            evidenceRequirements: [
              { id: "repo-inspection", description: "Inspect the requested files.", required: true },
            ],
            evidence: [],
            currentPhase: "prepare",
            createdAt: "2026-07-28T09:00:01.000Z",
            updatedAt: "2026-07-28T09:00:01.000Z",
            sequence: 1,
          },
        }),
        outputSummary: "Goal created",
        metadata: {
          kind: "goal",
          operation: "create",
          goal: {
            id: "goal-1",
            objective: "Perform evidence-backed UX verification.",
            ownerSessionId: "parity-e2e-session",
            source: { kind: "operator", id: "parity-e2e" },
            planId: "interactive-ux-verification",
            status: "active",
            workItemIds: ["work-1"],
            authorityEnvelope: { maximumAuthority: "read_only", escalationPolicy: "deny" },
            routePolicy: { workflowProfile: "verification-heavy" },
            evidenceRequirements: [
              { id: "repo-inspection", description: "Inspect the requested files.", required: true },
            ],
            evidence: [],
            currentPhase: "prepare",
            createdAt: "2026-07-28T09:00:01.000Z",
            updatedAt: "2026-07-28T09:00:01.000Z",
            sequence: 1,
          },
        },
        toolCallId: "parity-goal-create",
        toolCallScopeId,
        isError: false,
      };
      yield {
        type: "tool_use",
        toolName: "work_item.execution.start",
        input: { workItemId: "work-1" },
        toolCallId: "parity-work-item-start",
        toolCallScopeId,
      };
      yield {
        type: "tool_result",
        toolName: "work_item.execution.start",
        output: JSON.stringify({
          status: "started",
          item: {
            id: "work-1",
            summary: "Inspect composer activity ownership.",
            status: "in_progress",
            workflowProfile: "verification-heavy",
            expectedEvidence: ["surface-map", "tests"],
            providedEvidence: ["surface-map"],
            verificationGates: ["browser-render"],
            dependencies: [],
            createdAt: "2026-07-28T09:00:00.000Z",
            updatedAt: "2026-07-28T09:00:02.000Z",
            sequence: 2,
          },
        }),
        outputSummary: "Work item execution started",
        metadata: {
          kind: "work_item",
          operation: "execution_started",
          item: {
            id: "work-1",
            summary: "Inspect composer activity ownership.",
            status: "in_progress",
            workflowProfile: "verification-heavy",
            authorityProfile: "foundation-readonly-plan",
            expectedEvidence: ["surface-map", "tests"],
            providedEvidence: ["surface-map"],
            verificationGates: ["browser-render"],
            dependencies: [],
            createdAt: "2026-07-28T09:00:00.000Z",
            updatedAt: "2026-07-28T09:00:02.000Z",
            sequence: 2,
          },
          attempt: {
            id: "work-1:attempt:1",
            workItemId: "work-1",
            goalRunId: "goal-1",
            status: "running",
            executionMode: "direct",
            startedAt: "2026-07-28T09:00:02.000Z",
            providedEvidence: ["surface-map"],
            missingEvidence: ["tests"],
            missingResidualRisk: false,
          },
        },
        toolCallId: "parity-work-item-start",
        toolCallScopeId,
        isError: false,
      };
      yield {
        type: "tool_use",
        toolName: "read",
        input: { path: "C:\\repo\\missing.ts" },
        toolCallId: "parity-read-failed",
        toolCallScopeId,
      };
      yield {
        type: "tool_result",
        toolName: "read",
        output: "ENOENT: no such file or directory, open 'C:\\repo\\missing.ts'",
        outputSummary: "File not found",
        metadata: { kind: "file", operation: "read", filePath: "C:\\repo\\missing.ts", code: "ENOENT" },
        toolCallId: "parity-read-failed",
        toolCallScopeId,
        isError: true,
      };
    }

    for (const chunk of chunks) {
      await delay(70);
      yield { type: "text_delta", content: chunk };
    }

    yield { type: "cost_update", usd: 0.0104, inputTokens: 21, outputTokens: 42 };
    yield { type: "completed", totalUsd: 0.0104, durationMs: 220, outcome: "completed", isPreflightCrash: false };

    sessionSummaries.unshift({
      sessionId: `generated-${Date.now()}`,
      title: summarizePrompt(prompt),
      tags: [],
      routesUsed: [`${activeProvider}-default`],
      lastRoute: {
        routeId: `${activeProvider}-default`,
        provider: activeProvider,
        ...(activeModel ? { model: activeModel } : {}),
      },
      updatedAt: new Date().toISOString(),
      costUsd: 0.0104,
    });
  },
  async dispose() {
    // no-op
  },
});

let activeProvider = "claude";
let activeModel = "";

function createDeterministicOperatorRouting(): {
  readonly executionRouteSelection: OperatorExecutionRouteSelectionPort;
  readonly operatorTurnDispatcher: OperatorTurnDispatchPort<OperatorTurnGuiDispatchPayload, OperatorTurnDispatchResult>;
  readonly operatorTurnExecutionBridge: OperatorSessionExecutionBridge<unknown, OperatorTurnGuiDispatchPayload, OperatorTurnDispatchResult>;
  readonly runExecutionTargetWizard: NonNullable<Parameters<typeof startGuiGateway>[0]["runExecutionTargetWizard"]>;
} {
  const operatorTurnExecutionBridge = new OperatorSessionExecutionBridge<
    unknown,
    OperatorTurnGuiDispatchPayload,
    OperatorTurnDispatchResult
  >();
  const accountId = "parity-codex-oauth-account";
  const accountPolicyId = "parity-codex-oauth-policy";
  let targetEvidence: ExecutionTargetEvidenceSnapshot = defineExecutionTargetEvidenceSnapshot({
    version: 1,
    accounts: [{
      accountId,
      providerId: "codex-oauth",
      economics: {
        capacityIdentity: "parity-codex-capacity",
        subscriptionClass: "subscription",
        quotaClassId: "parity-codex-subscription",
      },
    }],
    targets: [],
  });
  const initialRevision = executionTargetEvidenceRevision(targetEvidence);
  let targetIntent: ExecutionTargetCatalogIntent = {
    evidenceRevision: initialRevision,
    accounts: [{
      id: accountId,
      providerId: "codex-oauth",
      credentialId: "parity-credential-ref",
      maxConcurrency: 2,
      reservedAffinitySlots: 0,
      economics: { creditPosture: "disabled", overagePosture: "disabled" },
    }],
    accountPolicies: [{ id: accountPolicyId, accountIds: [accountId], strategy: "economic-least-pressure" }],
    targets: [],
  };
  let executionCatalog: ExecutionCatalogInput = projectExecutionCatalogFromIntent(
    targetIntent,
    targetEvidence,
    initialRevision,
  );
  let routeCatalog: ExecutionRouteCatalog = {
    observedAt: new Date().toISOString(),
    revision: initialRevision,
    routes: [
      executionRoute("claude-default", "Claude", "claude", "claude-sonnet-4-6"),
      executionRoute("codex-default", "Codex", "codex", "gpt-5.5"),
      executionRoute("codex-sol-medium", "Sol Medium", "codex-oauth", "gpt-5.6-sol"),
      executionRoute("opencode-default", "OpenCode", "opencode", "opencode-default"),
      {
        ...executionRoute("deepseek-flash-unavailable", "DeepSeek Flash", "opencode-go", "deepseek-v3.2-speciale"),
        availability: "unavailable" as const,
        reasonCodes: ["model-unavailable"],
        repairActions: ["refresh-route-catalog" as const],
      },
    ],
  };
  const executionRouteSelection: OperatorExecutionRouteSelectionPort = {
    getCatalog: async () => routeCatalog,
    admit: async (intent) => {
      const route = routeCatalog.routes.find(({ routeId }) => routeId === intent.routeId);
      if (!route) {
        return {
          ok: false,
          reasonCode: "route-not-configured",
          reason: `Execution target '${intent.routeId}' is not configured in the parity fixture.`,
          repairActions: ["refresh-route-catalog"],
        };
      }
      return {
        ok: true,
        admission: {
          routeId: route.routeId,
          providerId: route.providerId,
          providerModelId: route.providerModelId,
        },
      };
    },
  };
  const operatorTurnDispatcher: OperatorTurnDispatchPort<
    OperatorTurnGuiDispatchPayload,
    OperatorTurnDispatchResult
  > = {
    async dispatchTurn(request) {
      const admission = await executionRouteSelection.admit(request.intent);
      if (!admission.ok) {
        throw new Error(admission.reason);
      }
      const accountId = request.intent.accountOverrideId ?? "parity-account";
      const result = await operatorTurnExecutionBridge.dispatchCommittedTurn({
        admission: admission.admission,
        accountId,
        lease: {},
        credential: { kind: "parity" },
        binding: {
          status: "bound",
          routeId: admission.admission.routeId,
          accountId,
          credentialId: "parity-credential",
          credentialRevision: "sha256:parity-revision",
        },
        payload: request.payload,
      } as never);
      return {
        admission: admission.admission,
        accountId,
        leaseId: "parity-lease",
        evidence: {
          routeId: admission.admission.routeId,
          accountId,
          credentialId: "parity-credential",
          credentialRevision: "sha256:parity-revision",
          capacityIdentity: "parity-capacity",
          leaseId: "parity-lease",
          dispatchFenceId: "parity-dispatch",
          status: "completed",
        },
        result,
      };
    },
  };

  const resolveCurrentWizardEvidence = async (
    discoveryEvidence: Parameters<NonNullable<Parameters<typeof startGuiGateway>[0]["runExecutionTargetWizard"]>>[1],
  ) => {
    const discovery = projectGuiProviderModelDiscovery(operatorDiscovery, { observedAt: discoveryEvidence.catalogObservedAt });
    const catalog = projectAvailableModelCatalogForExecutionRoutes({
      discovery,
      executionRouteCatalog: routeCatalog,
    });
    return {
      catalog,
      executionCatalog,
      targetIntent,
      targetEvidence,
      revision: routeCatalog.revision ?? initialRevision,
      discoveryEvidence,
    };
  };

  const runExecutionTargetWizard: NonNullable<Parameters<typeof startGuiGateway>[0]["runExecutionTargetWizard"]> = async (request, evidence) => {
    const result = await createCurrentExecutionRoute({
      request,
      admittedEvidence: evidence,
      projectPath: "synthetic-parity-project",
      approvalSurface: "gui",
      resolveCurrentEvidence: () => resolveCurrentWizardEvidence(evidence),
      commit: async ({ draft, expectedRevision, currentIntent, currentEvidence, operatorApproved }) => {
        if (!operatorApproved || expectedRevision !== routeCatalog.revision) {
          throw new Error("The parity target commit no longer matches current authority.");
        }
        if (currentIntent !== targetIntent || currentEvidence !== targetEvidence) {
          throw new Error("The parity target commit did not revalidate its current evidence snapshot.");
        }

        const nextEvidence = defineExecutionTargetEvidenceSnapshot({
          ...currentEvidence,
          targets: [...currentEvidence.targets, draft.evidence],
        });
        const nextRevision = executionTargetEvidenceRevision(nextEvidence);
        const nextIntent: ExecutionTargetCatalogIntent = {
          ...currentIntent,
          evidenceRevision: nextRevision,
          targets: [...currentIntent.targets, draft.intent],
        };
        const nextExecutionCatalog = projectExecutionCatalogFromIntent(
          nextIntent,
          nextEvidence,
          nextRevision,
        );

        targetEvidence = nextEvidence;
        targetIntent = nextIntent;
        executionCatalog = nextExecutionCatalog;
        routeCatalog = {
          observedAt: new Date().toISOString(),
          revision: nextRevision,
          routes: [
            ...routeCatalog.routes,
            executionRoute(draft.route.id, draft.route.label, draft.route.providerId, draft.route.providerModelId),
          ],
        };
        return { status: "created", revision: nextRevision };
      },
    });

    if (result.status === "previewed") {
      return { status: "previewed", proposal: result.proposal, message: result.message };
    }
    if (result.status === "rejected") {
      return {
        status: "rejected",
        code: result.code,
        action: result.action,
        message: result.message,
        ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
        ...(result.proposal ? { proposal: result.proposal } : {}),
      };
    }
    return {
      status: result.status,
      proposal: result.proposal,
      revision: parseExecutionTargetWizardRevision(result.revision),
    };
  };

  return { executionRouteSelection, operatorTurnDispatcher, operatorTurnExecutionBridge, runExecutionTargetWizard };
}

function executionRoute(
  routeId: string,
  label: string,
  providerId: string,
  providerModelId: string,
) {
  return {
    routeId,
    label,
    providerId,
    providerModelId,
    accountSelection: {
      mode: "automatic" as const,
      eligibleAccountCount: 1,
      allowOperatorOverride: true,
    },
    availability: "available" as const,
    reasonCodes: [],
    repairActions: [],
  };
}
let continuationSessionId: string | null = null;

const contextArtifactCache = new InMemoryContextArtifactCache();
const memoryDbDir = mkdtempSync(join(tmpdir(), "kiln-gui-memory-"));
const memoryRepository = new SqliteMemoryRepository({ dbPath: join(memoryDbDir, "memory.db") });
const setupSnapshot: KilnConfigSetupSnapshot = {
  projectRoot: "C:/workspace/kiln",
  projectContext: {
    path: "C:/workspace/kiln/.kiln/project-context.md",
    status: "valid",
    recommendation: "none",
  },
  repoShims: [
    {
      target: "agents",
      targetId: "agents",
      path: "C:/workspace/kiln/AGENTS.md",
      status: "current",
      recommendation: "none",
    },
    {
      target: "claude",
      targetId: "claude",
      path: "C:/workspace/kiln/CLAUDE.md",
      status: "current",
      recommendation: "none",
    },
  ],
  globalInstructionShims: [],
  nativeProjections: [],
  permissionIntegrity: [],
  recommendedActions: ["none"],
};

const settingsRevision = `sha256:${"a".repeat(64)}` as const;
let domainOverridden = true;
let configuredTheme: OperatorThemeName = "system-follow";
const settingsProposals = new Map<string, KilnSettingsProposalRequest>();

function settingsSnapshot(): KilnSettingsSnapshot {
  const sections: KilnSettingsSnapshot["sections"] = [
    { id: "general", label: "General", description: "Identity, presentation, and project defaults.", entryKeys: ["ui.theme", "domain"] },
    { id: "providers", label: "Providers", description: "Provider connections and routing intent.", entryKeys: [] },
    { id: "models", label: "Models", description: "Model selection and behavior.", entryKeys: [] },
    { id: "permissions", label: "Permissions", description: "Authority, approval, and sandbox policy.", entryKeys: [] },
    { id: "tools", label: "Tools", description: "Interactive tools and admitted boundaries.", entryKeys: [] },
    { id: "usage-and-limits", label: "Usage and Limits", description: "Work limits and governance controls.", entryKeys: [] },
    { id: "agents", label: "Agents", description: "Skills, agents, and instruction profiles.", entryKeys: [] },
    { id: "health", label: "Health", description: "Configuration and projection health.", entryKeys: [] },
    { id: "advanced", label: "Advanced", description: "Descriptor-backed inspection and validation.", entryKeys: [] },
  ];
  return {
    schemaRevision: 1,
    generatedAt: new Date().toISOString(),
    health: "current",
    sections,
    entries: [{
      key: "ui.theme",
      identity: "/ui/theme",
      section: "general",
      label: "Theme",
      description: "Operator interface theme.",
      searchTerms: ["appearance", "color"],
      control: {
        kind: "theme",
        options: OPERATOR_THEME_NAMES.map((value) => ({ value, label: OPERATOR_THEME_LABELS[value] })),
      },
      supportedScopes: ["global"],
      effective: { value: configuredTheme },
      source: "global",
      override: "overridden",
      inherited: false,
      modified: true,
      writeTargets: [{
        scope: "global",
        document: "global-config",
        override: "overridden",
        modified: true,
        current: { value: configuredTheme },
        owners: ["operator-preferences"],
        authorityImpact: "none",
        approvalRequired: false,
        activation: "hot",
      }],
      owners: ["operator-preferences"],
      authorityImpact: "none",
      approvalRequired: false,
      activation: "hot",
      health: "current",
      capabilities: { read: true, set: true, reset: true },
      revisions: { global: settingsRevision },
    }, {
      key: "domain",
      identity: "/domain",
      section: "general",
      label: "Domain",
      description: "Project domain used to select admitted context.",
      searchTerms: ["domain", "project"],
      control: { kind: "text" },
      supportedScopes: ["project"],
      effective: { value: domainOverridden ? "backend" : "default" },
      source: domainOverridden ? "project" : "default",
      override: domainOverridden ? "overridden" : "inherited",
      inherited: !domainOverridden,
      modified: domainOverridden,
      writeTargets: [{
        scope: "project",
        document: "project-config",
        override: domainOverridden ? "overridden" : "inherited",
        modified: domainOverridden,
        ...(domainOverridden ? { current: { value: "backend" } } : {}),
        owners: ["project-configuration"],
        authorityImpact: "none",
        approvalRequired: false,
        activation: "next-session",
      }],
      owners: ["project-configuration"],
      authorityImpact: "none",
      approvalRequired: false,
      activation: "next-session",
      health: "current",
      capabilities: { read: true, set: true, reset: true },
      revisions: { project: settingsRevision },
    }],
    revisions: { project: settingsRevision, global: settingsRevision },
    modifiedCount: domainOverridden ? 2 : 1,
  };
}

seedMemoryRepository(memoryRepository);

async function main(): Promise<void> {
  const port = parseGatewayPort();
  const operatorRouting = createDeterministicOperatorRouting();

  const gateway = await startGuiGateway({
    port,
    workingDirectory: process.cwd(),
    getSnapshot: async () => ({
      providers: [
        { id: "claude", label: "Claude", group: "harness", free: false, models: ["claude-sonnet-4-6", "claude-opus-4-6"], available: true },
        { id: "codex", label: "Codex", group: "harness", free: false, models: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"], available: true },
        { id: "opencode", label: "OpenCode", group: "harness", free: false, models: [], available: true },
      ],
      telemetry: { status: "idle", dominantRegions: [], saturation: 0, entropy: 0 },
      continuationInfoByProvider: continuationSessionId
        ? { [activeProvider]: { strategy: "continue_session", feedbackLabel: continuationSessionId } }
        : {},
    }),
    getProviderAvailability: () => ({ claude: true, codex: true, opencode: true }),
    initialOperatorDiscovery: operatorDiscovery,
    initialOperatorDiscoveryFreshness: "fresh",
    executionRouteSelection: operatorRouting.executionRouteSelection,
    runExecutionTargetWizard: operatorRouting.runExecutionTargetWizard,
    discoverOperatorProviders: async () => operatorDiscovery,
    getSetupSnapshot: async () => setupSnapshot,
    getSettingsSnapshot: async () => settingsSnapshot(),
    proposeSettingsMutation: async (request): Promise<KilnSettingsProposalProjection> => {
      await delay(150);
      const proposalId = `cfg_${request.operation.replace("setting.", "")}_${request.key.replaceAll(".", "_")}`;
      settingsProposals.set(proposalId, request);
      return {
        proposalId,
        createdAt: new Date().toISOString(),
        scope: request.scope,
        operation: request.operation,
        key: request.key,
        status: "valid",
        baseRevision: settingsRevision,
        affectedOwners: request.key === "ui.theme" ? ["operator-preferences"] : ["project-configuration"],
        reconciliation: [],
        authorityImpact: "none",
        approvalRequired: false,
        activation: request.key === "ui.theme" ? "hot" : "next-session",
        diagnostics: [],
        rollback: { restorable: true, summary: "Restore the prior value." },
      };
    },
    applySettingsMutation: async ({ proposalId }): Promise<KilnSettingsMutationResult> => {
      await delay(150);
      const request = settingsProposals.get(proposalId);
      if (request?.operation === "setting.reset" && request.key === "domain") domainOverridden = false;
      if (request?.operation === "setting.set"
        && request.key === "ui.theme"
        && typeof request.value === "string"
        && (OPERATOR_THEME_NAMES as readonly string[]).includes(request.value)) {
        configuredTheme = request.value as OperatorThemeName;
      }
      return {
        proposalId,
        scope: request?.scope ?? "project",
        operation: request?.operation ?? "setting.set",
        outcome: request ? "committed" : "rejected",
        rejectionCode: request ? null : "invalid-request",
        committedRevision: request ? settingsRevision : null,
        activation: request?.key === "ui.theme" ? "hot" : "next-session",
        reconciliation: [],
        diagnostics: [],
        replayed: false,
        readBack: { schemaRevision: 1, verified: Boolean(request) },
      };
    },
    loadOperatorSessionHistory: async () => sessionSummaries,
    getSessionDetail: async (sessionId) => sessionId === restoredSessionDetail.id
      ? restoredSessionDetail
      : contextSessionDetails[sessionId] ?? null,
    builtinToolOptions: {
      memoryResources: {
        repository: memoryRepository,
        authority: { kind: "trusted-internal" },
      },
    },
    operatorTransport: {
      sessionManager: {
        factory: fakeSessionFactory,
        getProvider: () => activeProvider,
        setProvider: (provider) => {
          activeProvider = provider;
        },
        getModel: () => activeModel,
        setModel: (model) => {
          activeModel = model;
        },
      },
      systemPrompt: "You are a deterministic e2e test assistant.",
      onClear: async () => {
        continuationSessionId = null;
      },
      onContinueSession: async (sessionId) => {
        continuationSessionId = sessionId;
      },
      contextArtifactCache,
      executionMode: "execute",
      operatorTurnDispatcher: operatorRouting.operatorTurnDispatcher,
      operatorTurnExecutionBridge: operatorRouting.operatorTurnExecutionBridge,
    },
  });

  process.stdout.write(`READY ${gateway.port} ${gateway.operatorTerminalCapability ?? "none"}\n`);

  const shutdown = () => {
    memoryRepository.close();
    rmSync(memoryDbDir, { recursive: true, force: true });
    gateway.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Gateway runner failed: ${message}\n`);
  process.exit(1);
});

function seedMemoryRepository(repository: SqliteMemoryRepository): void {
  const contract = repository.saveRecord(memoryRecord({
    id: "memory-lattice-contract",
    content: "Memory Lattice contract is exposed through runtime resources for GUI, TUI, CLI, and YAML consumers.",
    topicKey: "Memory Lattice contract",
  }));
  const admission = repository.saveRecord(memoryRecord({
    id: "context-admission-evidence",
    content: "Context admission evidence explains why a memory record entered an agent context window.",
    topicKey: "Context admission evidence",
  }));

  repository.saveRelation({
    id: "memory-lattice-supports-admission",
    sourceRecordId: contract.id,
    target: { kind: "memory_record", id: admission.id },
    type: "supports",
    confidence: 0.9,
    createdAt: "2026-04-30T12:00:00.000Z",
  });
}

function memoryRecord(overrides: {
  readonly id: string;
  readonly content: string;
  readonly topicKey: string;
}): CreateMemoryRecordInput {
  return {
    id: overrides.id,
    layer: "semantic",
    scope: { kind: "project", id: "kiln" },
    content: overrides.content,
    topicKey: overrides.topicKey,
    tags: ["memory-lattice"],
    provenance: memoryProvenance("gui-e2e-fixture"),
    confidence: 0.95,
    createdAt: "2026-04-30T12:00:00.000Z",
  };
}

function memoryProvenance(sourceId: string): MemoryProvenance {
  return {
    sourceType: "operator",
    sourceId,
    actor: "Kiln GUI parity fixture",
    capturedAt: "2026-04-30T12:00:00.000Z",
  };
}
