import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildGuiOperatorDiscoveryResults,
  createRuntimeMediaActionClaimContext,
  CliSubscriptionExecutor,
  defineRuntimeSessionAuthorityFacet,
  OperatorSessionAuthorityAdmissionBridge,
  OperatorSessionExecutionBridge,
  OperatorSessionExecutionRoutingService,
  createOperatorSessionAccountCapacityAuthority,
  projectModelCatalog,
  projectGuiProviderModelDiscovery,
  startGuiGateway,
  type CliSessionFactory,
  type ConfiguredExecutionCredential,
  type OperatorExecutionTargetCatalogEntry,
  type OperatorExecutionTargetSelectionPort,
  type OperatorTurnDispatchPort,
  type OperatorTurnDispatchResult,
  type OperatorTurnGuiDispatchPayload,
  type EffectiveAuthorityAdmissionBundle,
} from "../../../../runtime/src/index.js";
import {
  createCurrentExecutionTarget,
  parseExecutionTargetWizardRevision,
} from "../../../../cli/src/application/current-execution-target-creation.js";
import {
  defineExecutionTargetEvidenceSnapshot,
  executionTargetEvidenceRevision,
  projectExecutionTargetCatalogFromIntent,
  type ExecutionTargetCatalogIntent,
  type ExecutionTargetEvidenceSnapshot,
} from "../../../../cli/src/config/execution-target-evidence-store.js";
import {
  InMemoryContextArtifactCache,
  SqliteMemoryRepository,
  createExecutionAccountRef,
  defineExecutionTargetCatalog,
  trustedInternalMemoryAuthority,
  type ExecutionTargetCatalog,
  type ManagedEconomicAmount,
  type CreateMemoryRecordInput,
  type ExecutionTargetCatalogInput,
  type MemoryProvenance,
} from "@kilnai/core";
import {
  createFixtureModelRoundStore,
  createFixtureToolActionStore,
} from "../../../../runtime/tests/session/runtime-claim-fixture.js";
import { createMediaActionTestContext } from "../../../../runtime/tests/gateway/media-action-test-fixture.js";
import { completedTurnDisposition } from "../../fixtures/terminal-disposition.js";
import type {
  GuiProviderDiscoveryResult,
  GuiSessionDetail,
  OperatorSessionSummary,
  KilnConfigSetupSnapshot,
  KilnSettingsMutationResult,
  KilnSettingsProposalProjection,
  KilnSettingsProposalRequest,
  KilnSettingsSnapshot,
} from "@kilnai/gateway-contracts";
import {
  DEFAULT_OPERATOR_APPEARANCE_PREFERENCE,
  isOperatorAppearancePreference,
  type OperatorAppearancePreference,
} from "@kilnai/operator-appearance";

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
    meta: { kilnSessionId: "context-partial-session", title: "Inspect partial context evidence", task: "Inspect partial context evidence", startedAt: "2026-07-03T12:00:00.000Z" },
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
    meta: { kilnSessionId: "context-authoritative-session", title: "Inspect authoritative context evidence", task: "Inspect authoritative context evidence", startedAt: "2026-07-03T12:00:00.000Z" },
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
    yield {
      type: "completed",
      totalUsd: 0.0104,
      durationMs: 220,
      disposition: completedTurnDisposition(),
      isPreflightCrash: false,
    };

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

const PARITY_ECONOMIC_AMOUNT = {
  atoms: "0",
  scale: 0,
  unit: "request",
  scheme: { kind: "unit" },
} satisfies ManagedEconomicAmount;
const PARITY_DIGEST = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const PARITY_CREDENTIAL_REVISION = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function canonicalExecutionTargetCatalogForTarget(
  target: OperatorExecutionTargetCatalogEntry,
  accountId: string,
  accountPolicyId: string,
): ExecutionTargetCatalog {
  return defineExecutionTargetCatalog({
    accounts: [{
      id: accountId,
      providerId: target.providerId,
      credentialId: `${accountId}-credential`,
      maxConcurrency: 2,
      reservedAffinitySlots: 0,
      economics: {
        capacityIdentity: `${accountId}-capacity`,
        subscriptionClass: "subscription",
        quotaClassId: `${accountId}-quota`,
        creditPosture: "disabled",
        overagePosture: "disabled",
      },
    }],
    accountPolicies: [{ id: accountPolicyId, accountIds: [accountId], strategy: "economic-least-pressure" }],
    targets: [{
      id: target.targetId,
      label: target.label,
      providerId: target.providerId,
      providerModelId: target.providerModelId,
      accountPolicyId,
      dataClassification: "public",
      dataPolicyEvidence: {
        providerId: target.providerId,
        providerModelId: target.providerModelId,
        dataUse: "service-operation",
        trainingPosture: "prohibited",
        retention: { posture: "zero", days: 0 },
        permittedMaximumClassification: "public",
        permittedClassifications: ["public"],
        sourceIdentity: "parity-execution-policy",
        sourceRevision: "parity-R1",
        sourceDigest: PARITY_DIGEST,
        observedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      economics: {
        adapterCapabilityId: "parity-adapter",
        adapterCapabilityVersion: "parity-v1",
        authBillingChannel: "subscription",
        executionMode: "execute",
        serviceTier: "standard",
        rateCardBasis: "parity-rate-card",
        envelopeSemantics: "parity-envelope",
        fallbackPosture: "disabled",
        overagePosture: "disabled",
        contextClass: "parity-context",
        cacheClass: "none",
        priceEvidence: {
          kind: "subscription",
          rateCardId: "parity-rate-card",
          rateCardRevision: "parity-R1",
          evidence: {
            sourceIdentity: "parity-economics",
            sourceRevision: "parity-R1",
            sourceDigest: PARITY_DIGEST,
            observedAt: "2026-01-01T00:00:00.000Z",
            validUntil: "2099-01-01T00:00:00.000Z",
            confidence: "high",
            authority: "configured",
          },
        },
        auxiliaryCharges: [],
        executionEnvelope: { limits: [PARITY_ECONOMIC_AMOUNT] },
      },
    }],
  });
}

function createDeterministicOperatorRouting(): {
  readonly executionTargetSelection: OperatorExecutionTargetSelectionPort;
  readonly operatorTurnDispatcher: OperatorTurnDispatchPort<OperatorTurnGuiDispatchPayload, OperatorTurnDispatchResult>;
  readonly operatorTurnExecutionBridge: OperatorSessionExecutionBridge<ConfiguredExecutionCredential, OperatorTurnGuiDispatchPayload, OperatorTurnDispatchResult>;
  readonly operatorAuthorityAdmissionBridge: NonNullable<Parameters<typeof startGuiGateway>[0]["operatorTransport"]>["operatorAuthorityAdmissionBridge"];
  readonly authorityAdmissionEvidenceStore: NonNullable<Parameters<typeof startGuiGateway>[0]["operatorTransport"]>["authorityAdmissionEvidenceStore"];
  readonly runtimeModelRoundActionClaims: NonNullable<Parameters<typeof startGuiGateway>[0]["operatorTransport"]>["runtimeModelRoundActionClaims"];
  readonly runtimeToolActionClaims: NonNullable<Parameters<typeof startGuiGateway>[0]["operatorTransport"]>["runtimeToolActionClaims"];
  readonly runtimeMediaActionClaims: NonNullable<Parameters<typeof startGuiGateway>[0]["operatorTransport"]>["runtimeMediaActionClaims"];
  readonly runExecutionTargetWizard: NonNullable<Parameters<typeof startGuiGateway>[0]["runExecutionTargetWizard"]>;
  readonly getExecutionTargets: () => readonly OperatorExecutionTargetCatalogEntry[];
} {
  const operatorTurnExecutionBridge = new OperatorSessionExecutionBridge<
    ConfiguredExecutionCredential,
    OperatorTurnGuiDispatchPayload,
    OperatorTurnDispatchResult
  >();
  const operatorAuthorityAdmissionBridge = new OperatorSessionAuthorityAdmissionBridge<OperatorTurnGuiDispatchPayload>();
  const persistedAdmissions = new Map<string, EffectiveAuthorityAdmissionBundle>();
  const persistedSessionFacets = new Map([
    [restoredSessionDetail.id, defineRuntimeSessionAuthorityFacet({
      sessionId: restoredSessionDetail.id,
      sessionRevision: { revisionSetId: "parity-R1", revisions: { execution: "parity-R1" } },
      skillCatalog: { catalogId: "parity", revision: "skills-R1", skillIds: [] },
      authorityCeiling: {
        maximumAuthority: "audited",
        reason: "Synthetic parity session authority.",
        subjectId: restoredSessionDetail.id,
      },
    })],
  ]);
  const authorityAdmissionEvidenceStore = {
    persist: async (bundle: EffectiveAuthorityAdmissionBundle) => {
      persistedAdmissions.set(bundle.admissionId, bundle);
      persistedSessionFacets.set(bundle.sessionId, defineRuntimeSessionAuthorityFacet({
        sessionId: bundle.sessionId,
        sessionRevision: bundle.configuration.sessionRevision,
        ...bundle.session,
      }));
    },
    loadSessionFacet: async (sessionId: string) => persistedSessionFacets.get(sessionId),
    readAdmission: async (input: { readonly admissionId: string; readonly sessionId: string; readonly turnId: string }) => {
      const bundle = persistedAdmissions.get(input.admissionId);
      return bundle?.sessionId === input.sessionId && bundle.turnId === input.turnId ? bundle : undefined;
    },
  };
  const runtimeModelRoundActionClaims = createFixtureModelRoundStore();
  const runtimeToolActionClaims = createFixtureToolActionStore();
  const runtimeMediaActionClaimStore = createMediaActionTestContext().mediaActionClaims.store;
  const runtimeMediaActionClaims = createRuntimeMediaActionClaimContext({
    ownerGeneration: "parity-gui:media:r1",
    store: runtimeMediaActionClaimStore,
    readAdmission: (input) => authorityAdmissionEvidenceStore.readAdmission(input),
  });
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
  let executionCatalog: ExecutionTargetCatalogInput = projectExecutionTargetCatalogFromIntent(
    targetIntent,
    targetEvidence,
    initialRevision,
  );
  let configuredTargetRevision = initialRevision;
  let configuredTargets: readonly OperatorExecutionTargetCatalogEntry[] = [
      executionTarget("claude-default", "Claude", "claude", "claude-sonnet-4-6"),
      executionTarget("codex-default", "Codex", "codex", "gpt-5.5"),
      executionTarget("codex-sol-medium", "Sol Medium", "codex-oauth", "gpt-5.6-sol"),
      executionTarget("opencode-default", "OpenCode", "opencode", "opencode-default"),
      {
        ...executionTarget("deepseek-flash-unavailable", "DeepSeek Flash", "opencode-go", "deepseek-v3.2-speciale"),
        availability: "unavailable" as const,
        reasonCodes: ["model-unavailable"],
        repairActions: ["refresh-model-catalog" as const],
      },
    ];
  const executionTargetSelection: OperatorExecutionTargetSelectionPort = {
    getTargets: async () => configuredTargets,
    admit: async (intent) => {
      const target = configuredTargets.find(({ targetId }) => targetId === intent.targetId);
      if (!target) {
        return {
          ok: false,
          reasonCode: "target-not-configured",
          reason: `Execution target '${intent.targetId}' is not configured in the parity fixture.`,
          repairActions: ["refresh-model-catalog"],
        };
      }
      return {
        ok: true,
        admission: {
          targetId: target.targetId,
          providerId: target.providerId,
          providerModelId: target.providerModelId,
        },
      };
    },
  };
  const accountCapacityAuthority = createOperatorSessionAccountCapacityAuthority({
    path: ":memory:",
    ownerId: "parity-gui-runner",
    recoveryDomain: "parity-gui",
    configurationRevision: "parity-R1",
  });
  // Keep the captured catalog immutable per dispatch; a shared mutable capture
  // could be overwritten by a later concurrent request before admission runs.
  const createRouting = (catalog: ExecutionTargetCatalog) => new OperatorSessionExecutionRoutingService<
    ConfiguredExecutionCredential,
    OperatorTurnGuiDispatchPayload,
    OperatorTurnDispatchResult
  >({
    catalogSource: {
      capture: () => ({
        catalog,
        configurationRevision: { revisionSetId: "parity-R1", revisions: { execution: "parity-R1" } },
      }),
      activate: () => undefined,
    },
    candidates: {
      resolve: async ({ admission, catalog: capturedCatalog }) => {
        const accountId = admission.accountSelection.kind === "operator-override"
          ? admission.accountSelection.accountId
          : admission.accountSelection.eligibleAccountIds[0];
        if (!accountId) throw new Error("Parity execution target has no eligible account.");
        const account = capturedCatalog.accounts.find((candidate) => candidate.id === accountId);
        if (!account) throw new Error(`Parity account '${accountId}' is not configured.`);
        return [{
          candidate: {
            accountId,
            safety: "eligible",
            health: "healthy",
            quota: "available",
            capacity: "available",
            economicCost: PARITY_ECONOMIC_AMOUNT,
            pressure: 0,
          },
          lease: {
            candidate: {
              account: createExecutionAccountRef(`configured:${accountId}`),
              route: {
                providerId: admission.providerId,
                providerModelId: admission.providerModelId,
                scope: "operator-session",
              },
              health: "healthy",
              leaseCapacity: "available",
              pressure: 0,
              reservedForNewWork: false,
            },
            capacityIdentity: account.economics.capacityIdentity,
            credentialRevisionId: PARITY_CREDENTIAL_REVISION,
            usageEvidence: {
              health: "healthy",
              freshness: "fresh",
              availability: "available",
              observedAt: "2026-01-01T00:00:00.000Z",
              validUntil: "2099-01-01T00:00:00.000Z",
              source: "provider-endpoint",
              confidence: "authoritative",
            },
            accountEconomics: account.economics,
            capacity: {
              maxConcurrency: account.maxConcurrency,
              reservedAffinitySlots: account.reservedAffinitySlots,
            },
          },
        }];
      },
    },
    accountCapacityAuthority,
    credentials: {
      resolve: async ({ credentialId, lease }) => ({
        credential: {
          credentialId,
          accessToken: "parity-synthetic-token",
          chatgptAccountId: "parity-synthetic-account",
        },
        credentialId,
        credentialRevisionId: lease.credentialRevisionId,
      }),
    },
    authorityAdmission: operatorAuthorityAdmissionBridge,
    dispatch: {
      dispatchCommittedTurn: (committed) => operatorTurnExecutionBridge.dispatchCommittedTurn(committed),
    },
  });
  const operatorTurnDispatcher: OperatorTurnDispatchPort<
    OperatorTurnGuiDispatchPayload,
    OperatorTurnDispatchResult
  > = {
    async dispatchTurn(request) {
      const target = configuredTargets.find(({ targetId }) => targetId === request.intent.targetId);
      if (!target) throw new Error(`Execution target '${request.intent.targetId}' is not configured in the parity fixture.`);
      const accountId = request.intent.accountOverrideId ?? `parity-${target.providerId}-account`;
      const executionCatalog = canonicalExecutionTargetCatalogForTarget(
        target,
        accountId,
        `parity-${target.providerId}-policy`,
      );
      return createRouting(executionCatalog).execute(request);
    },
  };

  const resolveCurrentWizardEvidence = async (
    discoveryEvidence: Parameters<NonNullable<Parameters<typeof startGuiGateway>[0]["runExecutionTargetWizard"]>>[1],
  ) => {
    const discovery = projectGuiProviderModelDiscovery(operatorDiscovery, { observedAt: discoveryEvidence.catalogObservedAt });
    const catalog = projectModelCatalog({
      discovery,
      configuredTargets,
      revision: configuredTargetRevision,
    });
    return {
      catalog,
      executionCatalog,
      targetIntent,
      targetEvidence,
      revision: configuredTargetRevision,
      discoveryEvidence,
    };
  };

  const runExecutionTargetWizard: NonNullable<Parameters<typeof startGuiGateway>[0]["runExecutionTargetWizard"]> = async (request, evidence) => {
    const result = await createCurrentExecutionTarget({
      request,
      admittedEvidence: evidence,
      projectPath: "synthetic-parity-project",
      approvalSurface: "gui",
      resolveCurrentEvidence: () => resolveCurrentWizardEvidence(evidence),
      commit: async ({ draft, expectedRevision, currentIntent, currentEvidence, operatorApproved }) => {
        if (!operatorApproved || expectedRevision !== configuredTargetRevision) {
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
        const nextExecutionTargetCatalog = projectExecutionTargetCatalogFromIntent(
          nextIntent,
          nextEvidence,
          nextRevision,
        );

        targetEvidence = nextEvidence;
        targetIntent = nextIntent;
        executionCatalog = nextExecutionTargetCatalog;
        configuredTargetRevision = nextRevision;
        configuredTargets = [
            ...configuredTargets,
            executionTarget(draft.target.id, draft.target.label, draft.target.providerId, draft.target.providerModelId),
          ];
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

  return {
    executionTargetSelection,
    operatorTurnDispatcher,
    operatorTurnExecutionBridge,
    operatorAuthorityAdmissionBridge,
    authorityAdmissionEvidenceStore,
    runtimeModelRoundActionClaims,
    runtimeToolActionClaims,
    runtimeMediaActionClaims,
    runExecutionTargetWizard,
    getExecutionTargets: () => configuredTargets,
  };
}

function executionTarget(
  targetId: string,
  label: string,
  providerId: string,
  providerModelId: string,
) : OperatorExecutionTargetCatalogEntry {
  return {
    targetId,
    label,
    providerId,
    providerModelId,
    access: providerId === "codex-oauth" ? "subscription" : "harness",
    availability: "available",
    reasonCodes: ["configured"],
    repairActions: [],
    eligibleAccountCount: 1,
    accountOverrideIds: [],
    cost: { kind: "subscription" },
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
  skillDiagnostics: { state: "current", observedAt: "2026-07-01T00:00:00.000Z" },
  recommendedActions: ["none"],
};

const settingsRevision = `sha256:${"a".repeat(64)}` as const;
let domainOverridden = true;
let configuredAppearance: OperatorAppearancePreference = DEFAULT_OPERATOR_APPEARANCE_PREFERENCE;
const settingsProposals = new Map<string, KilnSettingsProposalRequest>();
let settingsActivationStatus: KilnSettingsSnapshot["activationStatus"] = {
  desiredRevisionSetId: settingsRevision,
  state: "active",
  boundary: "hot",
  activeRevision: settingsRevision,
  entries: [{
    proposalId: "cfg-theme-activation",
    scope: "global",
    path: "config.yaml",
    committedRevision: settingsRevision,
    boundary: "hot",
    state: "active",
    activeRevision: settingsRevision,
    evidence: "read-back",
    reconciliationGenerations: [],
    summary: "The committed revision is active immediately.",
  }],
  summary: "The committed revision is active immediately.",
};

function settingsSnapshot(): KilnSettingsSnapshot {
  const sections: KilnSettingsSnapshot["sections"] = [
    { id: "general", label: "General", description: "Identity and project defaults.", entryKeys: ["domain"] },
    { id: "appearance", label: "Appearance", description: "Color scheme and operator themes.", entryKeys: ["ui.appearance"] },
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
    schemaRevision: 3,
    generatedAt: new Date().toISOString(),
    health: "current",
    activationStatus: settingsActivationStatus,
    sections,
    entries: [{
      key: "ui.appearance",
      identity: "/ui/appearance",
      section: "appearance",
      label: "Operator appearance",
      description: "Color scheme and operator themes.",
      searchTerms: ["appearance", "color"],
      control: { kind: "json" },
      supportedScopes: ["global"],
      effective: { value: configuredAppearance },
      source: "global",
      override: "overridden",
      inherited: false,
      modified: true,
      writeTargets: [{
        scope: "global",
        document: "global-config",
        override: "overridden",
        modified: true,
        current: { value: configuredAppearance },
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
  const guiPort = process.env.GUI_DEV_PORT;
  if (!guiPort || !/^\d+$/.test(guiPort)) {
    throw new Error("GUI_DEV_PORT is required for the exact external GUI origin.");
  }
  const operatorRouting = createDeterministicOperatorRouting();
  const canonicalSessionEvents: unknown[] = [];

  const gateway = await startGuiGateway({
    port,
    guiAssetMode: "external",
    externalGuiOrigin: `http://127.0.0.1:${guiPort}`,
    workingDirectory: process.cwd(),
    getSnapshot: async () => ({
      providers: [
        { id: "claude", label: "Claude", group: "harness", free: false, models: ["claude-sonnet-4-6", "claude-opus-4-6"], available: true },
        { id: "codex", label: "Codex", group: "harness", free: false, models: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"], available: true },
        { id: "opencode", label: "OpenCode", group: "harness", free: false, models: [], available: true },
      ],
      telemetry: { status: "idle", dominantRegions: [], saturation: 0, entropy: 0 },
      modelCatalog: projectModelCatalog({
        discovery: projectGuiProviderModelDiscovery(operatorDiscovery),
        configuredTargets: operatorRouting.getExecutionTargets(),
      }),
      continuationInfoByProvider: continuationSessionId
        ? { [activeProvider]: { strategy: "continue_session", feedbackLabel: continuationSessionId } }
        : {},
    }),
    getProviderAvailability: () => ({ claude: true, codex: true, opencode: true }),
    initialOperatorDiscovery: operatorDiscovery,
    initialOperatorDiscoveryFreshness: "fresh",
    executionTargetSelection: operatorRouting.executionTargetSelection,
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
        affectedOwners: request.key === "ui.appearance" ? ["operator-preferences"] : ["project-configuration"],
        reconciliation: [],
        authorityImpact: "none",
        approvalRequired: false,
        activation: request.key === "ui.appearance" ? "hot" : "next-session",
        diagnostics: [],
        rollback: { restorable: true, summary: "Restore the prior value." },
      };
    },
    applySettingsMutation: async ({ proposalId }): Promise<KilnSettingsMutationResult> => {
      await delay(150);
      const request = settingsProposals.get(proposalId);
      if (request?.operation === "setting.reset" && request.key === "domain") domainOverridden = false;
      if (request?.operation === "setting.set"
        && request.key === "ui.appearance"
        && isOperatorAppearancePreference(request.value)) {
        configuredAppearance = request.value;
      }
      const activation = request?.key === "ui.appearance" ? "hot" as const : "next-session" as const;
      const activationObservation = activation === "hot"
        ? {
            state: "active" as const,
            boundary: activation,
            committedRevision: settingsRevision,
            activeRevision: settingsRevision,
            summary: "The committed revision is active immediately.",
          }
        : {
            state: "scheduled" as const,
            boundary: activation,
            committedRevision: settingsRevision,
            activeRevision: null,
            summary: "The committed revision activates at the next session boundary.",
          };
      if (request) {
        settingsActivationStatus = {
          desiredRevisionSetId: settingsRevision,
          state: activationObservation.state,
          boundary: activation,
          activeRevision: activationObservation.activeRevision,
          entries: [{
            proposalId,
            scope: request.scope,
            path: request.scope === "global" ? "config.yaml" : ".kiln/kiln.yaml",
            committedRevision: settingsRevision,
            boundary: activation,
            state: activationObservation.state,
            activeRevision: activationObservation.activeRevision,
            evidence: activation === "hot" ? "read-back" : "scheduled",
            reconciliationGenerations: [],
            summary: activationObservation.summary,
          }],
          summary: activationObservation.summary,
        };
      }
      return {
        proposalId,
        scope: request?.scope ?? "project",
        operation: request?.operation ?? "setting.set",
        outcome: request ? "committed" : "rejected",
        rejectionCode: request ? null : "invalid-request",
        committedRevision: request ? settingsRevision : null,
        activation,
        activationObservation: request
          ? activationObservation
          : {
              state: "not-started",
              boundary: activation,
              committedRevision: null,
              activeRevision: null,
              summary: "Configuration was not committed.",
            },
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
        authority: trustedInternalMemoryAuthority(),
      },
    },
    operatorTransport: {
      sessionManager: {
        getProvider: () => activeProvider,
        setProvider: (provider) => {
          activeProvider = provider;
        },
        getModel: () => activeModel,
        setModel: (model) => {
          activeModel = model;
        },
      },
      createProvider: ({ admission }) => new CliSubscriptionExecutor(fakeSessionFactory, admission.providerId),
      systemPrompt: "You are a deterministic e2e test assistant.",
      onClear: async () => {
        continuationSessionId = null;
      },
      onContinueSession: async (sessionId) => {
        continuationSessionId = sessionId;
      },
      resumeSessionHydrator: async ({ session }) => {
        session.addUserMessage([{ type: "text", text: "Read the persisted parity plan" }]);
        session.addAssistantMessage([{ type: "text", text: "The persisted parity plan is ready." }]);
        return { rehydrated: true, messageCount: 2, sourceSequence: 1 };
      },
      contextArtifactCache,
      executionMode: "execute",
      operatorTurnDispatcher: operatorRouting.operatorTurnDispatcher,
      operatorTurnExecutionBridge: operatorRouting.operatorTurnExecutionBridge,
      operatorAuthorityAdmissionBridge: operatorRouting.operatorAuthorityAdmissionBridge,
      authorityAdmissionEvidenceStore: operatorRouting.authorityAdmissionEvidenceStore,
      runtimeModelRoundActionClaims: operatorRouting.runtimeModelRoundActionClaims,
      runtimeToolActionClaims: operatorRouting.runtimeToolActionClaims,
      runtimeMediaActionClaims: operatorRouting.runtimeMediaActionClaims,
      persistCanonicalSessionEvents: async (events) => {
        canonicalSessionEvents.push(...events);
      },
    },
  });

  process.stdout.write(`READY ${gateway.port} ${gateway.operatorCapability ?? "none"}\n`);

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
