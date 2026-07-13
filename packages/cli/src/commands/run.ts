import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import readline from "node:readline";
import { SessionManager } from "../wrapper/session-manager.js";
import {
  createDefaultRegistry,
  getRuntimeProviderAvailability,
  isDirectApiProvider,
} from "../wrapper/session-registry.js";
import { cleanupRegistry } from "../wrapper/cleanup-registry.js";
import type {
  ApprovalMemoryStore,
  ProviderId,
  SessionRequirements,
  SessionMode,
  WrapperConfig,
  KilnPermissionPolicy,
} from "../wrapper/index.js";
import type { KilnAppConfig } from "../config.js";
import { defaultBuildSystemPrompt } from "../config.js";
import { withGlobalIdentityContext } from "../config/operator-identity-context.js";
import {
  findAgent,
  loadAgentDefinitions,
  type KilnAgentDefinition,
} from "../application/agent-loader.js";
import {
  resolveAgentSkillContextCandidates,
  withContextCandidates,
} from "../application/agent-skill-context.js";
import { resolveInstructionProfileContextCandidates } from "../application/instruction-profile-context.js";
import { withWorkGovernanceContext } from "../application/work-governance-context.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import { readKilnYaml } from "../kiln-yaml.js";
import type { KilnModelTaskSuitabilityTask, KilnReasoningPolicyConfig } from "../kiln-yaml-types.js";
import {
  computeEvalScore,
  printContextGovernancePreview,
  printReport,
  summarizeContextGovernance,
} from "../application/session-report.js";
import { buildModuleSummaryArtifact, extractTouchedFilePaths } from "../application/repo-summary-cache.js";
import { buildCliCompletionContextArtifacts } from "../application/session-context-artifacts.js";
import { inferResumeStrategyFeedback } from "../application/resume-strategy-feedback.js";
import { resolveContinuationSessionId } from "../application/session-continuation.js";
import { deriveSessionMetadata } from "../application/session-metadata.js";
import { SessionHooks } from "../application/session-hooks.js";
import { runSession } from "../application/run-session.js";
import type { RunSessionAttemptResult, RunSessionRouteCandidate } from "../application/run-session.js";
import {
  buildRunJsonOutputEnvelope,
  createRunOutputController,
  type RunOutputController,
  type RunOutputMode,
} from "../application/run-output.js";
import { ApprovalMemoryStore as ApprovalMemoryStoreImpl } from "../wrapper/index.js";
import {
  TranscriptStore,
} from "../wrapper/session-store.js";
import type { PersistedSessionMeta } from "../wrapper/session-store.js";
import type { ResumeOutcome } from "../wrapper/index.js";
import { resolveEffectiveModel } from "../config/env-config.js";
import { readGlobalConfig, resolveGlobalDefaultModel, type KilnGlobalConfig } from "../config/global-config.js";
import { loadKilnConfig } from "../config/config-merger.js";
import { inferRouteTask, resolveProviderRouteCandidates } from "../config/provider-route-candidates.js";
import { resolveConfiguredReasoningEffort } from "../config/reasoning-policy.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { createKilnConfigTools } from "../application/config-tools.js";
import { createWorkGovernanceTools } from "../application/work-governance-tool.js";
import { discoverManagedAgentProviderModels } from "../config/managed-agent-provider-models.js";
import { resolveManagedInvocationToolOptions } from "../config/managed-agent-routes.js";
import {
  loadConfiguredBuiltinToolSurfaceOptions,
  withProgressiveRuntimeToolProjection,
} from "../config/builtin-tool-surface-config.js";
import { resolveEngineAvailabilityMap } from "../engines/engine-registry.js";
import {
  createCliTranscriptBudgetUsageReader,
  createRuntimeBudgetAdmissionFromGlobalConfig,
  projectGlobalRoutingBudgetPolicy,
} from "../application/runtime-budget-admission.js";
import { createKilnRuntimeManagedInvocationAttachment } from "../application/managed-invocation-attachment.js";
import {
  SkillGenerator,
  AnthropicAdapter,
  GoalRunStore,
  WorkItemStore,
  admitManagedAgentOrchestrationRequest,
  buildManagedAgentFanOutOrchestrationRequest,
  createSessionBuiltinToolOptions,
  type ManagedAgentOrchestrationAdmissionLimits,
  type ReasoningEffort,
  VerificationResult,
  formatProviderModelRouteCooldown,
  mapProviderModelRouteErrorToOutcome,
  scoreComplexity,
} from "@kilnai/core";
import {
  attachManagedInvocationSessionEventSink,
  ProviderModelRouteHealthStore,
  discoverGuiCliOperatorModels,
  discoverGuiDirectProviderModelDiscovery,
  getProjectContextArtifactCache,
  probeCodexCliModelReadiness,
  runManagedAgentFanOutLifecycle,
  withManagedAgentInvocationResourceProvider,
  withManagedInvocationService,
  normalizeContextUsageProjection,
} from "@kilnai/runtime";
import {
  managedInvocationPersistedTranscriptEventDrafts,
  operatorTranscriptSourceForEntry,
  projectOperatorTranscriptEntryToDraft,
} from "../application/operator-transcript-projection.js";
import type { ContextArtifactCache } from "@kilnai/core";
import type {
  ManagedAgentFanOutBudgetAdmissionInput,
  ManagedInvocationToolOptions,
  RuntimeBudgetUsageReader,
} from "@kilnai/runtime";
import type { OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";

export interface RunFlags {
  readonly apiKey?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  readonly agent?: string;
  readonly permissionPolicy?: KilnPermissionPolicy;
  readonly isolate?: boolean;
  readonly continuation?: boolean;
  readonly continuationSessionId?: string;
  readonly plan?: boolean;
  readonly ephemeral?: boolean;
  readonly profile?: string;
  readonly skipGitRepoCheck?: boolean;
  readonly output?: RunOutputMode;
  readonly outputSchema?: string;
  readonly addDir?: string;
  readonly localProvider?: string;
  readonly workers?: number;
}

function resolveMode(flags: RunFlags): SessionMode {
  if (flags.apiKey && flags.provider) return "byok";
  if (flags.apiKey) return "api-key";
  return "cli-wrapper";
}

const DEFAULT_POLICY: KilnPermissionPolicy = { approval: "never", sandbox: "workspace-write" };
export const PLAN_POLICY: KilnPermissionPolicy = {
  approval: "untrusted",
  sandbox: "read-only",
  fileGovernance: {
    denyGlobs: [
      ".git/**",
      "**/.git/**",
      "node_modules/**",
      "**/node_modules/**",
    ],
    allowGlobs: [
      ".",
      "./**",
      "**",
    ],
  },
  tools: [
    {
      tool: "work_governance.*",
      action: "allow",
      reason: "Plan mode must admit governed work assessment without granting general tool authority.",
    },
    {
      tool: "work_profile.list",
      action: "allow",
      reason: "Plan mode may inspect configured work profiles.",
    },
    {
      tool: "goal.*",
      action: "allow",
      reason: "Plan mode may materialize governed planning goals.",
    },
    {
      tool: "work_item.*",
      action: "allow",
      reason: "Plan mode may materialize governed planning work items.",
    },
    {
      tool: "managed_agent.*",
      action: "allow",
      reason: "Plan mode may delegate read-only planning work through governed managed agents.",
    },
    {
      tool: "kiln_config.read",
      action: "allow",
      reason: "Plan mode may inspect effective Kiln configuration.",
    },
    {
      tool: "tool_catalog_search",
      action: "allow",
      reason: "Plan mode may discover available governed tools without granting execution authority.",
    },
    {
      tool: "memory_search",
      action: "allow",
      reason: "Plan mode may search governed read-only memory context.",
    },
    {
      tool: "read",
      action: "allow",
      reason: "Plan mode requires read-only file inspection.",
    },
    {
      tool: "tree",
      action: "allow",
      reason: "Plan mode requires read-only repository surface mapping.",
    },
    {
      tool: "grep",
      action: "allow",
      reason: "Plan mode requires read-only code search.",
    },
    {
      tool: "glob",
      action: "allow",
      reason: "Plan mode requires read-only file discovery.",
    },
    {
      tool: "git",
      action: "allow",
      reason: "Plan and review mode require read-only diff and status inspection.",
    },
    {
      tool: "resource_list",
      action: "allow",
      reason: "Plan mode may discover shared read-only Kiln resources.",
    },
    {
      tool: "resource_template_list",
      action: "allow",
      reason: "Plan mode may discover shared read-only Kiln resource templates.",
    },
    {
      tool: "resource_read",
      action: "allow",
      reason: "Plan mode may read shared Kiln resources.",
    },
  ],
};

export function buildRunSessionRequirements(preferredProvider: ProviderId | undefined): SessionRequirements {
  return {
    preferredProvider,
    requiresMcp: preferredProvider === undefined,
  };
}

interface RunProviderModelDiscovery {
  readonly models: readonly string[];
  readonly status: string;
  readonly reason: string;
  readonly modelReadinessFailures?: Readonly<Record<string, string>>;
}

export type RunProviderModelAdmission =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export function resolveRunProviderModelAdmission(input: {
  readonly provider: ProviderId | undefined;
  readonly model: string | undefined;
  readonly discovery: Readonly<Record<string, RunProviderModelDiscovery | undefined>>;
}): RunProviderModelAdmission {
  if (!modelDiscoveryCanValidateProvider(input.provider)) {
    return { ok: true };
  }

  const model = input.model?.trim() ?? "";
  if (!isDirectApiProvider(input.provider) && model.length === 0) {
    return { ok: true };
  }

  const discovery = input.discovery[input.provider];
  if (!discovery) {
    return {
      ok: false,
      error: `Provider '${input.provider}' is unavailable`,
    };
  }
  if (discovery.status !== "available") {
    return {
      ok: false,
      error: discovery.reason,
    };
  }

  if (model.length === 0) {
    return {
      ok: false,
      error: `Provider '${input.provider}' requires a selected model.`,
    };
  }
  const modelReadinessFailure = discovery.modelReadinessFailures?.[model];
  if (modelReadinessFailure) {
    return {
      ok: false,
      error: modelReadinessFailure,
    };
  }
  if (!discovery.models.includes(model)) {
    return {
      ok: false,
      error: `Provider '${input.provider}' does not advertise model '${model}'`,
    };
  }

  return { ok: true };
}

function modelDiscoveryCanValidateProvider(provider: ProviderId | undefined): provider is ProviderId {
  return provider === "codex" || provider === "opencode" || isDirectApiProvider(provider);
}

function requiresCliWrapperModelDiscovery(candidate: RunSessionRouteCandidate): boolean {
  return (
    (candidate.provider === "codex" || candidate.provider === "opencode")
    && (candidate.model?.trim().length ?? 0) > 0
  );
}

function buildConfig(flags: RunFlags, mode: SessionMode): WrapperConfig {
  return {
    mode,
    apiKey: flags.apiKey,
    provider: flags.provider,
    permissionPolicy: flags.plan ? PLAN_POLICY : (flags.permissionPolicy ?? DEFAULT_POLICY),
  };
}

interface AdmittedRunRouteCandidate extends RunSessionRouteCandidate {
  readonly provider: ProviderId;
}

async function resolveAdmittedRunRouteCandidates(input: {
  readonly candidates: readonly RunSessionRouteCandidate[];
  readonly registry: ReturnType<typeof createDefaultRegistry>["registry"];
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly routeHealthStore: ProviderModelRouteHealthStore;
}): Promise<{
  readonly candidates: readonly AdmittedRunRouteCandidate[];
  readonly rejectedReasons: readonly string[];
  readonly routeCapabilities: ReadonlyMap<string, { readonly supportedReasoningEfforts?: readonly ReasoningEffort[] }>;
}> {
  const rejectedReasons: string[] = [];
  const directCandidates = input.candidates.filter((candidate) => isDirectApiProvider(candidate.provider));
  const directDiscovery = directCandidates.length > 0
    ? await discoverGuiDirectProviderModelDiscovery({
        ...getRuntimeProviderAvailability(input.registry),
        ...Object.fromEntries(directCandidates.map((candidate) => [candidate.provider, true])),
      }, {
        ...process.env,
        ...input.env,
      })
    : {};
  const wrapperCandidates = input.candidates.filter(requiresCliWrapperModelDiscovery);
  const cliDiscovery = wrapperCandidates.length > 0
    ? await discoverGuiCliOperatorModels({
        ...getRuntimeProviderAvailability(input.registry),
        codex: wrapperCandidates.some((candidate) => candidate.provider === "codex"),
        opencode: wrapperCandidates.some((candidate) => candidate.provider === "opencode"),
      })
    : undefined;
  const codexDiscovery = cliDiscovery
    ? await extendCodexDiscoveryWithReadinessProbes({
        discovery: cliDiscovery.codexDiscovery,
        candidates: wrapperCandidates.filter((candidate) => candidate.provider === "codex"),
        cwd: input.cwd,
        env: input.env,
      })
    : undefined;
  const providerDiscovery: Record<string, RunProviderModelDiscovery | undefined> = {
    ...directDiscovery,
    ...(cliDiscovery
      ? {
          codex: codexDiscovery,
          opencode: cliDiscovery.opencodeDiscovery,
        }
      : {}),
  };

  const admitted: AdmittedRunRouteCandidate[] = [];
  const routeCapabilities = new Map<string, { readonly supportedReasoningEfforts?: readonly ReasoningEffort[] }>();
  for (const candidate of input.candidates) {
    const admission = resolveRunProviderModelAdmission({
      provider: candidate.provider,
      model: candidate.model,
      discovery: providerDiscovery,
    });
    if (!admission.ok) {
      rejectedReasons.push(`${formatRouteCandidate(candidate)}: ${admission.error}`);
      continue;
    }

    if (candidate.model) {
      const health = await input.routeHealthStore.evaluateRouteHealth(candidate.provider, candidate.model);
      if (!health.healthy) {
        rejectedReasons.push(`${formatRouteCandidate(candidate)}: ${formatProviderModelRouteCooldown(health)}`);
        continue;
      }
    }

    const supportedReasoningEfforts = candidate.model
      ? directDiscovery[candidate.provider]?.modelCapabilities?.[candidate.model]?.supportedReasoningEfforts
      : undefined;
    if (candidate.model && supportedReasoningEfforts) {
      routeCapabilities.set(routeKey(candidate.provider, candidate.model), { supportedReasoningEfforts });
    }

    admitted.push(candidate as AdmittedRunRouteCandidate);
  }

  return { candidates: admitted, rejectedReasons, routeCapabilities };
}

async function extendCodexDiscoveryWithReadinessProbes(input: {
  readonly discovery: RunProviderModelDiscovery;
  readonly candidates: readonly RunSessionRouteCandidate[];
  readonly cwd: string;
  readonly env: Record<string, string>;
}): Promise<RunProviderModelDiscovery> {
  let discovery = input.discovery;
  for (const candidate of input.candidates) {
    const model = candidate.model?.trim();
    if (!model || discovery.models.includes(model)) {
      continue;
    }
    const readiness = await probeCodexCliModelReadiness({
      model,
      reasoningEffort: candidate.reasoningEffort,
      cwd: input.cwd,
      env: input.env,
    });
    if (!readiness.runnable) {
      discovery = {
        ...discovery,
        modelReadinessFailures: {
          ...(discovery.modelReadinessFailures ?? {}),
          [model]: readiness.reason,
        },
      };
      continue;
    }
    discovery = {
      ...discovery,
      status: "available",
      reason: readiness.reason,
      models: [...discovery.models, model],
    };
  }
  return discovery;
}

function routeKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

function applyReasoningPolicyToRouteCandidates(input: {
  readonly candidates: readonly AdmittedRunRouteCandidate[];
  readonly reasoningPolicy?: KilnReasoningPolicyConfig;
  readonly explicitReasoningEffort?: ReasoningEffort;
  readonly task?: KilnModelTaskSuitabilityTask;
  readonly routeCapabilities: ReadonlyMap<string, { readonly supportedReasoningEfforts?: readonly ReasoningEffort[] }>;
}): readonly AdmittedRunRouteCandidate[] {
  return input.candidates.map((candidate) => {
    const supportedReasoningEfforts = candidate.model
      ? input.routeCapabilities.get(routeKey(candidate.provider, candidate.model))?.supportedReasoningEfforts
      : undefined;
    const reasoningEffort = resolveConfiguredReasoningEffort({
      explicitReasoningEffort: input.explicitReasoningEffort,
      policy: input.reasoningPolicy,
      task: input.task,
      provider: candidate.provider,
      model: candidate.model,
      supportedReasoningEfforts,
    });
    return reasoningEffort ? { ...candidate, reasoningEffort } : candidate;
  });
}

function formatRouteCandidate(candidate: RunSessionRouteCandidate): string {
  return candidate.model ? `${candidate.provider}/${candidate.model}` : candidate.provider;
}

function appendAgentInstructionsToSystemPrompt(
  appConfig: KilnAppConfig,
  agent?: KilnAgentDefinition,
): KilnAppConfig {
  const instructions = renderAgentProfilePromptContext(agent);
  if (!instructions) {
    return appConfig;
  }

  return {
    ...appConfig,
    buildSystemPrompt: (opts) => {
      const basePrompt = (appConfig.buildSystemPrompt ?? defaultBuildSystemPrompt)(opts);
      if (basePrompt.trim().length === 0) {
        return instructions;
      }
      return `${basePrompt}\n\n${instructions}`;
    },
  };
}

function renderAgentProfilePromptContext(agent?: KilnAgentDefinition): string | undefined {
  if (!agent) {
    return undefined;
  }
  return [
    "## Agent Profile",
    `name: ${agent.name}`,
    agent.displayName ? `displayName: ${agent.displayName}` : undefined,
    agent.nicknameCandidates?.length ? `nicknameCandidates: ${agent.nicknameCandidates.join(", ")}` : undefined,
    `role: ${agent.role}`,
    agent.description ? `description: ${agent.description}` : undefined,
    agent.goal ? `goal: ${agent.goal}` : undefined,
    agent.backstory ? `backstory: ${agent.backstory}` : undefined,
    agent.tier ? `tier: ${agent.tier}` : undefined,
    agent.mode ? `mode: ${agent.mode}` : undefined,
    agent.authorityProfile ? `authorityProfile: ${agent.authorityProfile}` : undefined,
    agent.routeId ? `routeId: ${agent.routeId}` : undefined,
    agent.skills?.length ? `skills: ${agent.skills.join(", ")}` : undefined,
    agent.instructionProfiles?.length ? `instructionProfiles: ${agent.instructionProfiles.join(", ")}` : undefined,
    agent.instructions ? "instructions:" : undefined,
    agent.instructions,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function parseSubmittedPlan(line: string): string | undefined {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.kind === "tool_call_started") {
      const payload = typeof parsed.payload === "object" && parsed.payload !== null
        ? parsed.payload as Record<string, unknown>
        : undefined;
      return payload ? extractSubmitPlan(payload) : undefined;
    }
    if (parsed.kind === "plan_submitted") {
      return renderStructuredPlanSummary(parsed.payload);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function extractSubmitPlan(event: Record<string, unknown>): string | undefined {
  if (event.type !== "tool_use") return undefined;

  const toolName = typeof event.name === "string"
    ? event.name
    : (typeof event.toolName === "string" ? event.toolName : undefined);

  if (toolName !== "submit_plan") return undefined;

  const input = typeof event.input === "object" && event.input !== null
    ? event.input as Record<string, unknown>
    : undefined;
  const plan = input?.plan;
  if (typeof plan === "string") {
    return plan;
  }
  return renderStructuredPlanSummary(input);
}

function renderStructuredPlanSummary(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const plan = input as Record<string, unknown>;
  const objective = typeof plan.objective === "string" ? plan.objective.trim() : "";
  if (!objective) {
    return undefined;
  }
  const list = (value: unknown) => Array.isArray(value)
    ? value.flatMap((entry) => typeof entry === "string" ? [entry.trim()] : []).filter((entry) => entry.length > 0)
    : [];
  const recommendation = plan.workGovernanceRecommendation
    && typeof plan.workGovernanceRecommendation === "object"
    && !Array.isArray(plan.workGovernanceRecommendation)
    ? plan.workGovernanceRecommendation as Record<string, unknown>
    : undefined;
  const proposedWorkItems = Array.isArray(plan.proposedWorkItems)
    ? plan.proposedWorkItems.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) as Record<string, unknown>[]
    : [];
  const lines = [
    objective,
    typeof plan.riskClassification === "string" ? `- risk: ${plan.riskClassification}` : undefined,
    typeof recommendation?.posture === "string" ? `- posture: ${recommendation.posture}` : undefined,
    typeof recommendation?.workflowProfile === "string" ? `- workflow: ${recommendation.workflowProfile}` : undefined,
    typeof recommendation?.rationale === "string" ? `- governance rationale: ${recommendation.rationale}` : undefined,
    typeof plan.sourceSpecificationId === "string" ? `- source specification: ${plan.sourceSpecificationId}` : undefined,
    ...list(plan.clarificationRecordIds).map((clarification) => `- clarification: ${clarification}`),
    ...list(plan.affectedSurfaces).map((surface) => `- affected surface: ${surface}`),
    ...list(plan.nonGoals).map((goal) => `- non-goal: ${goal}`),
    ...list(plan.assumptions).map((assumption) => `- assumption: ${assumption}`),
    ...list(plan.operatorDecisionsRequired).map((decision) => `- decision: ${decision}`),
    ...list(plan.expectedEvidence).map((evidence) => `- evidence: ${evidence}`),
    ...list(plan.verificationGates).map((gate) => `- gate: ${gate}`),
    ...list(plan.managedAgentDelegationCandidates).map((candidate) => `- delegation candidate: ${candidate}`),
    ...list(plan.approvalBoundaries).map((boundary) => `- approval boundary: ${boundary}`),
    typeof plan.rollbackNotes === "string" && plan.rollbackNotes.trim().length > 0
      ? `- rollback: ${plan.rollbackNotes.trim()}`
      : undefined,
    ...list(plan.residualRisks).map((risk) => `- residual risk: ${risk}`),
    ...proposedWorkItems.flatMap((item) => {
      const itemId = typeof item.id === "string" ? item.id.trim() : "";
      const itemSummary = typeof item.summary === "string" ? item.summary.trim() : "";
      const itemWorkflow = typeof item.workflowProfile === "string" ? item.workflowProfile.trim() : "";
      const itemRisk = typeof item.risk === "string" ? item.risk.trim() : "";
      const itemEvidence = list(item.expectedEvidence);
      const itemGates = list(item.verificationGates);
      const itemDeps = list(item.dependencies);
      return [
        itemSummary || itemId ? `- work item ${itemId || "item"}: ${itemSummary || "(no summary)"}` : undefined,
        itemWorkflow ? `  workflow: ${itemWorkflow}` : undefined,
        itemRisk ? `  risk: ${itemRisk}` : undefined,
        ...itemEvidence.map((evidence) => `  evidence: ${evidence}`),
        ...itemGates.map((gate) => `  gate: ${gate}`),
        ...itemDeps.map((dependency) => `  depends on: ${dependency}`),
      ];
    }),
  ].filter((line): line is string => typeof line === "string" && line.length > 0);
  return lines.join("\n");
}

export class RunCommandExitError extends Error {
  readonly code: number;

  constructor(code: number, message = `Kiln run exited with code ${code}`) {
    super(message);
    this.name = "RunCommandExitError";
    this.code = code;
  }
}

export interface RunCommandExecutionOptions {
  readonly exitOnFailure?: boolean;
  readonly globalConfig?: KilnGlobalConfig | null;
  readonly budgetUsageReader?: RuntimeBudgetUsageReader;
  readonly parallelWorkerLineage?: RunCommandParallelWorkerLineage;
}

export interface RunCommandParallelWorkerLineage {
  readonly orchestrationId?: string;
  readonly parentSessionId?: string;
  readonly parentTurnId?: string;
}

interface ResolvedParallelWorkerLineage {
  readonly orchestrationId: string;
  readonly parentSessionId: string;
  readonly parentTurnId: string;
}

function exitRunCommand(code: number, options: RunCommandExecutionOptions): never {
  if (options.exitOnFailure === false) {
    throw new RunCommandExitError(code);
  }
  process.exit(code);
}

function resolveParallelWorkerLineage(
  lineage: RunCommandParallelWorkerLineage | undefined,
): ResolvedParallelWorkerLineage {
  const parentSessionId = lineage?.parentSessionId ?? randomUUID();
  const parentTurnId = lineage?.parentTurnId ?? `${parentSessionId}:workers`;
  const orchestrationId = lineage?.orchestrationId ?? `${parentSessionId}:workers`;
  return {
    orchestrationId,
    parentSessionId,
    parentTurnId,
  };
}

async function readSubmittedPlanFromTranscript(projectPath: string, sessionId: string): Promise<string | undefined> {
  try {
    const transcriptPath = join(projectPath, ".kiln", "sessions", sessionId, "transcript.jsonl");
    const content = await readFile(transcriptPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const submittedPlan = parseSubmittedPlan(lines[i]!);
      if (submittedPlan !== undefined) {
        return submittedPlan;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function promptForPlanApproval(): Promise<boolean> {
  process.stdout.write("Approve and execute? [y/N]: ");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    let settled = false;
    rl.once("line", (line) => {
      settled = true;
      resolve(line);
    });
    rl.once("close", () => {
      if (!settled) {
        resolve("");
      }
    });
  });

  rl.close();
  return answer.trim().toLowerCase() === "y";
}

export async function runCommand(
  appConfig: KilnAppConfig,
  task: string,
  flags: RunFlags,
  executionOptions: RunCommandExecutionOptions = {},
): Promise<void> {
  const runOutput = createRunOutputController(flags.output ?? "human");
  const sessionId = randomUUID();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  if (!task.trim()) {
    const errorMessage = `No task provided. Usage: kiln run "your task here"`;
    runOutput.writeErrorLine(`Error: ${errorMessage}`);
    emitRunFailureOutput(runOutput, {
      answer: "",
      sessionId,
      task,
      domain: "unknown",
      provider: flags.provider,
      model: flags.model,
      startedAt,
      startedAtMs,
      lastError: errorMessage,
    });
    exitRunCommand(1, executionOptions);
  }
  if (flags.plan && runOutput.mode !== "human") {
    const errorMessage = "--output answer/json is not supported with interactive plan mode.";
    runOutput.writeErrorLine(`Error: ${errorMessage}`);
    emitRunFailureOutput(runOutput, {
      answer: "",
      sessionId,
      task,
      domain: "unknown",
      provider: flags.provider,
      model: flags.model,
      startedAt,
      startedAtMs,
      lastError: errorMessage,
    });
    exitRunCommand(1, executionOptions);
  }
  if ((flags.workers ?? 1) > 1 && runOutput.mode !== "human") {
    const errorMessage = "--output answer/json is not supported with parallel worker mode.";
    runOutput.writeErrorLine(`Error: ${errorMessage}`);
    emitRunFailureOutput(runOutput, {
      answer: "",
      sessionId,
      task,
      domain: "unknown",
      provider: flags.provider,
      model: flags.model,
      startedAt,
      startedAtMs,
      lastError: errorMessage,
    });
    exitRunCommand(1, executionOptions);
  }

  const mode = resolveMode(flags);
  const cwd = resolveProjectRoot().rootPath;
  let resolvedAgent: KilnAgentDefinition | undefined;
  if (flags.agent) {
    const definitions = await loadAgentDefinitions(cwd);
    resolvedAgent = findAgent(definitions, flags.agent);
    if (!resolvedAgent) {
      const errorMessage = `Agent "${flags.agent}" not found in .kiln/agents/ or ~/.kiln/agents/`;
      runOutput.writeErrorLine(`Error: ${errorMessage}`);
      emitRunFailureOutput(runOutput, {
        answer: "",
        sessionId,
        task,
        domain: "unknown",
        provider: flags.provider,
        model: flags.model,
        startedAt,
        startedAtMs,
        lastError: errorMessage,
      });
      exitRunCommand(1, executionOptions);
    }
  }

  const globalConfig = readGlobalConfig();
  const projectConfig = readKilnYaml(join(cwd, ".kiln"));
  const resolvedKilnConfig = await loadKilnConfig(cwd);
  const resolvedAppConfig: KilnAppConfig = resolvedKilnConfig
    ? { ...appConfig, kilnYaml: resolvedKilnConfig }
    : appConfig;
  const routeTask = inferRouteTask({
    text: task,
    agentTaskAffinity: resolvedAgent?.taskAffinity,
  });
  const agentProviderRouteCandidate: RunSessionRouteCandidate | undefined = resolvedAgent?.providerRoute
    ? {
      provider: resolvedAgent.providerRoute.providerId as ProviderId,
      ...(resolvedAgent.providerRoute.model ? { model: resolvedAgent.providerRoute.model } : {}),
    }
    : undefined;
  const configuredRouteCandidates = [
    ...(agentProviderRouteCandidate && !flags.provider && !flags.model ? [agentProviderRouteCandidate] : []),
    ...resolveProviderRouteCandidates({
    globalConfig,
    flagProvider: flags.provider,
    flagModel: flags.model,
    taskText: task,
    agentTaskAffinity: resolvedAgent?.taskAffinity,
    }),
  ];
  const preferredProvider = configuredRouteCandidates[0]?.provider;
  if (
    flags.requestedAuthority
    && flags.requestedAuthority !== "auto"
    && (!preferredProvider || !isDirectApiProvider(preferredProvider))
  ) {
    const errorMessage = "--authority is only supported for direct API providers in CLI run. Use --plan for harness read-only planning.";
    runOutput.writeErrorLine(errorMessage);
    emitRunFailureOutput(runOutput, {
      answer: "",
      sessionId,
      task,
      domain: "unknown",
      provider: preferredProvider,
      model: configuredRouteCandidates[0]?.model ?? flags.model,
      startedAt,
      startedAtMs,
      lastError: errorMessage,
    });
    exitRunCommand(1, executionOptions);
  }
  const effectiveModel = configuredRouteCandidates[0]?.model
    ?? resolveEffectiveModel(flags.model, resolveGlobalDefaultModel(globalConfig));
  const config = buildConfig({ ...flags, provider: preferredProvider }, mode);
  let identityAppConfig = withWorkGovernanceContext(
    withGlobalIdentityContext(resolvedAppConfig, globalConfig),
    resolvedKilnConfig?.workGovernance,
  );
  identityAppConfig = withContextCandidates(
    identityAppConfig,
    resolveInstructionProfileContextCandidates({
      projectPath: cwd,
      globalConfig,
      projectConfig,
      agent: resolvedAgent,
    }),
  );
  try {
    identityAppConfig = withContextCandidates(
      identityAppConfig,
      resolveAgentSkillContextCandidates(resolvedAgent, cwd, undefined, resolvedKilnConfig?.skills, {
        task: routeTask,
        provider: preferredProvider,
        model: effectiveModel,
        modelTaskSuitability: resolvedKilnConfig?.modelTaskSuitability,
      }),
    );
  } catch (error) {
    const errorMessage = errorToMessage(error);
    runOutput.writeErrorLine(`Error: ${errorMessage}`);
    emitRunFailureOutput(runOutput, {
      answer: "",
      sessionId,
      task,
      domain: "unknown",
      provider: preferredProvider,
      model: effectiveModel,
      startedAt,
      startedAtMs,
      lastError: errorMessage,
    });
    exitRunCommand(1, executionOptions);
  }
  const runtimeAppConfig = appendAgentInstructionsToSystemPrompt(identityAppConfig, resolvedAgent);
  const { registry, worktreeManager } = createDefaultRegistry();
  const contextArtifactCache: ContextArtifactCache = await getProjectContextArtifactCache(cwd);
  const manager = new SessionManager(config, runtimeAppConfig, contextArtifactCache, worktreeManager);
  let continuationSessionId: string | undefined;
  try {
    continuationSessionId = await resolveContinuationSessionId(cwd, {
      continuation: flags.continuation,
      explicitSessionId: flags.continuationSessionId,
    });
  } catch (error) {
    const errorMessage = errorToMessage(error);
    runOutput.writeErrorLine(`Error: ${errorMessage}`);
    emitRunFailureOutput(runOutput, {
      answer: "",
      sessionId,
      task,
      domain: "unknown",
      provider: preferredProvider,
      model: effectiveModel,
      startedAt,
      startedAtMs,
      lastError: errorMessage,
    });
    exitRunCommand(1, executionOptions);
  }
  const transcriptStore = new TranscriptStore(cwd);
  const continuedMeta = continuationSessionId
    ? await transcriptStore.readMeta(continuationSessionId)
    : null;
  const budgetUsageReader = executionOptions.budgetUsageReader ?? createCliTranscriptBudgetUsageReader(transcriptStore);
  const runtimeBudgetAdmission = createRuntimeBudgetAdmissionFromGlobalConfig(globalConfig, budgetUsageReader);
  const resumeStrategyFeedback = continuationSessionId
    ? await inferResumeStrategyFeedback(transcriptStore, preferredProvider)
    : undefined;

  let context;
  try {
    context = await manager.prepare(
      task,
      cwd,
      undefined,
      flags.isolate,
      continuationSessionId,
      continuedMeta ?? undefined,
      preferredProvider,
      resumeStrategyFeedback,
    );
  } catch (err) {
    const errorMessage = `Failed to prepare session. ${errorToMessage(err)}`;
    runOutput.writeErrorLine(`Error: ${errorMessage}`);
    emitRunFailureOutput(runOutput, {
      answer: "",
      sessionId,
      task,
      domain: "unknown",
      provider: preferredProvider,
      model: effectiveModel,
      startedAt,
      startedAtMs,
      lastError: errorMessage,
    });
    exitRunCommand(1, executionOptions);
  }
  const approvalMemorySessionId = continuationSessionId ?? sessionId;
  const previewContextGovernance = summarizeContextGovernance(context.projectedContext);
  let worktreeCleaned = false;
  const cleanupWorktreeOnce = async (): Promise<void> => {
    if (worktreeCleaned) return;
    await manager.cleanupWorktree(context);
    worktreeCleaned = true;
  };
  const cleanupWorktreeForExit = async (): Promise<string | undefined> => {
    try {
      await cleanupWorktreeOnce();
      return undefined;
    } catch (error) {
      const errorMessage = `Failed to cleanup worktree. ${errorToMessage(error)}`;
      runOutput.writeErrorLine(`Error: ${errorMessage}`);
      return errorMessage;
    }
  };
  if (runtimeAppConfig.kilnYaml?.contextGovernance?.previewBeforeApply) {
    printContextGovernancePreview(previewContextGovernance, runOutput.writeTelemetryLine);
  }

  runOutput.writeTelemetryLine(`Domain:  ${context.domain.displayName}`);
  runOutput.writeTelemetryLine(`Mode:    ${mode}`);
  runOutput.writeTelemetryLine("Kiln session starting...");
  runOutput.writeTelemetryLine("");

  const env: Record<string, string> = {};
  if (config.mode === "api-key" && config.apiKey) {
    env.ANTHROPIC_API_KEY = config.apiKey;
  }
  if (config.mode === "byok" && config.provider && config.apiKey) {
    env[`${config.provider.toUpperCase()}_API_KEY`] = config.apiKey;
  }

  const directRouteHealthStore = configuredRouteCandidates.some((candidate) => isDirectApiProvider(candidate.provider))
    ? new ProviderModelRouteHealthStore()
    : undefined;
  const admittedRoutes = configuredRouteCandidates.length > 0
    ? await resolveAdmittedRunRouteCandidates({
        candidates: configuredRouteCandidates,
        registry,
        cwd,
        env,
        routeHealthStore: directRouteHealthStore ?? new ProviderModelRouteHealthStore(),
      })
    : { candidates: [], rejectedReasons: [], routeCapabilities: new Map() };
  if (configuredRouteCandidates.length > 0 && admittedRoutes.candidates.length === 0) {
    const errorMessage = "No configured provider routes are currently available.";
    runOutput.writeErrorLine(`Error: ${errorMessage}`);
    for (const reason of admittedRoutes.rejectedReasons) {
      runOutput.writeErrorLine(`- ${reason}`);
    }
    const cleanupErrorMessage = await cleanupWorktreeForExit();
    emitRunFailureOutput(runOutput, {
      answer: "",
      sessionId,
      task,
      domain: context.domain.displayName,
      provider: preferredProvider,
      model: effectiveModel,
      startedAt,
      startedAtMs,
      contextGovernance: previewContextGovernance,
      lastError: appendCleanupFailure(errorMessage, cleanupErrorMessage),
      exactArtifacts: context.projectedContext.blocks
        .filter((block) => block.kind === "artifact")
        .map((block) => block.content),
    });
    exitRunCommand(1, executionOptions);
  }
  const admittedRouteCandidates = applyReasoningPolicyToRouteCandidates({
    candidates: admittedRoutes.candidates,
    reasoningPolicy: resolvedKilnConfig?.reasoningPolicy,
    explicitReasoningEffort: flags.reasoningEffort,
    task: routeTask,
    routeCapabilities: admittedRoutes.routeCapabilities,
  });

  const requirements = buildRunSessionRequirements(preferredProvider);

  const configuredBuiltinToolOptions = await loadConfiguredBuiltinToolSurfaceOptions(runtimeAppConfig, cwd, {
      memoryAuthority: {
        modelFacingSession: true,
        permissionPolicy: config.permissionPolicy,
        permissionAgent: resolvedAgent?.name,
        caller: { kind: "operator_surface", id: "run" },
      },
    });
  const workItemStore = new WorkItemStore();
  const goalRunStore = new GoalRunStore();
  let builtinToolOptions = createSessionBuiltinToolOptions(withProgressiveRuntimeToolProjection({
    ...configuredBuiltinToolOptions,
    workItemStore,
    goalRunStore,
    additionalTools: [
      ...(configuredBuiltinToolOptions.additionalTools ?? []),
      ...createKilnConfigTools(cwd),
      ...createWorkGovernanceTools(resolvedKilnConfig?.workGovernance, {
        workItemStore,
        goalRunStore,
        ownerSessionId: approvalMemorySessionId,
      }),
    ],
  }, "execute"));
  const engineAvailability = resolveEngineAvailabilityMap(globalConfig);
  const managedAgentProviderModels = await discoverManagedAgentProviderModels();
  const managedInvocationResolution = await resolveManagedInvocationToolOptions(globalConfig, {
    cwd,
    registry,
    surface: "run",
    isProviderAvailable: (providerId) => engineAvailability.get(providerId),
    providerModelEligibility: managedAgentProviderModels,
    directAdapterFactory: createManagedDirectProviderAdapterFactory({
      builtinToolOptions: () => builtinToolOptions,
      runtimeEnv: env,
    }),
    builtinToolOptions: () => builtinToolOptions,
    artifactStore: builtinToolOptions.artifactResources?.store,
  });
  const managedInvocation = runtimeAppConfig.managedInvocation ?? managedInvocationResolution.managedInvocation;
  const managedInvocationWithService = managedInvocation
    ? withManagedInvocationService(managedInvocation)
    : undefined;
  const managedInvocationAttachment = managedInvocationWithService
    ? createKilnRuntimeManagedInvocationAttachment("run", managedInvocationWithService)
    : undefined;
  const managedInvocationWithTranscriptSink = attachManagedInvocationSessionEventSink(managedInvocationAttachment, {
    publish: async (events) => {
      await transcriptStore.appendManyNext(sessionId, managedInvocationPersistedTranscriptEventDrafts(events));
    },
  });
  builtinToolOptions = withManagedAgentInvocationResourceProvider(
    builtinToolOptions,
    managedInvocationWithService ? { service: managedInvocationWithService.invocationService } : undefined,
  );

  const initialMetadata = deriveSessionMetadata({
    task,
    provider: preferredProvider,
    model: effectiveModel,
  });
  const workerCount = flags.workers ?? 1;
  if (workerCount > 1) {
    let workerExitCode: number | undefined;
    let workerError: string | undefined;
    let workerSignalHandlersRegistered = false;
    let workerShutdownStarted = false;
    let workerFinalization: Promise<void> | undefined;
    let workerTranscriptInit: Promise<void> | undefined;
    let workerTranscriptInitialized = false;
    const finalizeParallelWorkerTranscript = async (): Promise<void> => {
      await workerTranscriptInit?.catch(() => undefined);
      if (!workerTranscriptInitialized) return;
      await transcriptStore.finalize(sessionId, {
        completedAt: new Date().toISOString(),
        lastTurnOutcome: workerExitCode === undefined && workerError === undefined ? "completed" : "failed",
        title: initialMetadata.title,
        summary: initialMetadata.summary,
        tags: initialMetadata.tags,
        costUsd: 0,
        toolCount: workerCount,
        turnDepth: 1,
        resumeStrategy: context.resumeStrategy,
        resumeFeedback: context.resumeFeedback,
        sessionLedger: {
          currentPhase: workerExitCode === undefined && workerError === undefined ? "completed" : "failed",
          resumedFrom: continuationSessionId,
          workingDirectory: context.workingDirectory,
          worktreePath: context.worktreePath,
          lastError: workerError,
          lastProvider: flags.provider ?? preferredProvider,
          toolCallCount: workerCount,
          turnDepth: 1,
        },
      });
    };
    const finalizeAndCleanupParallelWorkerRun = (): Promise<void> => {
      if (!workerFinalization) {
        workerFinalization = (async () => {
          const cleanupErrors: unknown[] = [];
          try {
            await finalizeParallelWorkerTranscript();
          } catch (error) {
            cleanupErrors.push(error);
          }
          try {
            await cleanupRegistry.runAll();
          } catch (error) {
            cleanupErrors.push(error);
          }
          try {
            await cleanupWorktreeOnce();
          } catch (error) {
            cleanupErrors.push(error);
          } finally {
            unregisterWorkerSignalHandlers();
          }
          if (cleanupErrors.length > 0) {
            runOutput.writeErrorLine(`Error: Parallel worker cleanup failed: ${cleanupErrors
              .map((error) => error instanceof Error ? error.message : String(error))
              .join("; ")}`);
          }
        })();
      }
      return workerFinalization;
    };
    const workerShutdown = (signal: NodeJS.Signals): void => {
      if (workerShutdownStarted) return;
      workerShutdownStarted = true;
      workerError = `Parallel worker run interrupted by ${signal}.`;
      void finalizeAndCleanupParallelWorkerRun()
        .catch((error) => {
          runOutput.writeErrorLine(`Error: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          process.exit(130);
        });
    };
    const workerSigintShutdown = (): void => workerShutdown("SIGINT");
    const workerSigtermShutdown = (): void => workerShutdown("SIGTERM");
    const unregisterWorkerSignalHandlers = (): void => {
      if (!workerSignalHandlersRegistered) return;
      process.off("SIGINT", workerSigintShutdown);
      process.off("SIGTERM", workerSigtermShutdown);
      workerSignalHandlersRegistered = false;
    };
    process.on("SIGINT", workerSigintShutdown);
    process.on("SIGTERM", workerSigtermShutdown);
    workerSignalHandlersRegistered = true;
    try {
      workerTranscriptInit = transcriptStore.init(sessionId, {
        kilnSessionId: sessionId,
        provider: preferredProvider ?? flags.provider ?? "managed-fan-out",
        title: initialMetadata.title,
        summary: initialMetadata.summary,
        tags: initialMetadata.tags,
        task,
        startedAt,
        resumeStrategy: context.resumeStrategy,
        resumeFeedback: context.resumeFeedback,
        sessionLedger: {
          currentPhase: "parallel-workers",
          resumedFrom: continuationSessionId,
          workingDirectory: context.workingDirectory,
          worktreePath: context.worktreePath,
        },
        exactArtifacts: context.projectedContext.blocks
          .filter((block) => block.kind === "artifact")
          .map((block) => block.content),
      }).then(() => {
        workerTranscriptInitialized = true;
      });
      await workerTranscriptInit;
      await runParallelWorkers(appConfig, task, flags, workerCount, managedInvocationWithService, {
        ...executionOptions,
        exitOnFailure: false,
        globalConfig,
        budgetUsageReader,
        parallelWorkerLineage: resolveParallelWorkerLineage({
          parentSessionId: sessionId,
          parentTurnId: `${sessionId}:workers`,
          orchestrationId: `${sessionId}:workers`,
          ...(executionOptions.parallelWorkerLineage ?? {}),
        }),
      });
    } catch (error) {
      if (!(error instanceof RunCommandExitError)) {
        workerError = error instanceof Error ? error.message : String(error);
        throw error;
      }
      workerExitCode = error.code;
      workerError = `Parallel workers exited with code ${error.code}.`;
    } finally {
      await finalizeAndCleanupParallelWorkerRun();
    }
    if (workerExitCode !== undefined) {
      exitRunCommand(workerExitCode, executionOptions);
    }
    return;
  }

  await transcriptStore.init(sessionId, {
    kilnSessionId: sessionId,
    provider: preferredProvider ?? "unknown",
    title: initialMetadata.title,
    summary: initialMetadata.summary,
    tags: initialMetadata.tags,
    task,
    startedAt,
    resumeStrategy: context.resumeStrategy,
    resumeFeedback: context.resumeFeedback,
    sessionLedger: {
      currentPhase: "prepare",
      resumedFrom: continuationSessionId,
      workingDirectory: context.workingDirectory,
      worktreePath: context.worktreePath,
    },
    exactArtifacts: context.projectedContext.blocks
      .filter((block) => block.kind === "artifact")
      .map((block) => block.content),
  });

  const sessionConfig = {
    task,
    systemPrompt: context.systemPrompt,
    mcpServerEntryPath: context.mcpServerEntryPath,
    cwd: context.workingDirectory,
    env,
    permissionPolicy: config.permissionPolicy,
    continuationSessionId: context.continuationSessionId,
    ephemeral: flags.ephemeral,
    profile: flags.profile,
    skipGitRepoCheck: flags.skipGitRepoCheck,
    outputSchema: flags.outputSchema,
    addDir: flags.addDir,
    localProvider: flags.localProvider,
    builtinToolOptions,
    managedInvocation: managedInvocationWithTranscriptSink,
    ...(runtimeBudgetAdmission ? { budgetAdmission: runtimeBudgetAdmission } : {}),
    model: effectiveModel,
    reasoningEffort: flags.reasoningEffort,
    requestedAuthority: flags.requestedAuthority,
  };

  const sessionHooks = new SessionHooks(appConfig.kilnYaml?.hooks, {
    sessionId,
    workingDirectory: context.workingDirectory,
  });
  const approvalMemoryStore: ApprovalMemoryStore = new ApprovalMemoryStoreImpl(cwd);
  const runAbortController = new AbortController();

  let signalHandlersRegistered = false;
  let shutdownStarted = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    runAbortController.abort(`Parent run interrupted by ${signal}.`);
    unregisterSignalHandlers();
    void cleanupRegistry.runAll()
      .then(cleanupWorktreeOnce)
      .finally(() => {
        process.exit(130);
      });
  };
  const sigintShutdown = (): void => shutdown("SIGINT");
  const sigtermShutdown = (): void => shutdown("SIGTERM");
  const unregisterSignalHandlers = (): void => {
    if (!signalHandlersRegistered) return;
    process.off("SIGINT", sigintShutdown);
    process.off("SIGTERM", sigtermShutdown);
    signalHandlersRegistered = false;
  };
  process.on("SIGINT", sigintShutdown);
  process.on("SIGTERM", sigtermShutdown);
  signalHandlersRegistered = true;

  sessionHooks.sessionStart();
  let runResult: Awaited<ReturnType<typeof runSession>>;
  try {
    runResult = await runSession({
      registry,
      cleanupRegistry,
      manager,
      context,
      requirements,
      routeCandidates: admittedRouteCandidates.length > 0 ? admittedRouteCandidates : undefined,
      sessionConfig,
      permissionPolicy: config.permissionPolicy,
      permissionAgent: resolvedAgent?.name,
      sessionId: approvalMemorySessionId,
      approvalMemoryStore,
      env,
      sessionHooks,
      abortSignal: runAbortController.signal,
      output: runOutput,
    });
  } catch (error) {
    const errorMessage = errorToMessage(error);
    runOutput.writeErrorLine(`Error: ${errorMessage}`);
    const cleanupErrorMessage = await cleanupWorktreeForExit();
    emitRunFailureOutput(runOutput, {
      answer: runOutput.capturedAnswer,
      sessionId,
      task,
      domain: context.domain.displayName,
      provider: preferredProvider,
      model: effectiveModel,
      startedAt,
      startedAtMs: manager.sessionStartTimeMs ?? startedAtMs,
      contextGovernance: previewContextGovernance,
      lastError: appendCleanupFailure(errorMessage, cleanupErrorMessage),
      exactArtifacts: context.projectedContext.blocks
        .filter((block) => block.kind === "artifact")
        .map((block) => block.content),
    });
    exitRunCommand(1, executionOptions);
  } finally {
    sessionHooks.sessionEnd();
    unregisterSignalHandlers();
  }

  const {
    finalCostUsd,
    sessionSucceeded,
    lastError,
    accumulatedText,
    inputTokens = 0,
    outputTokens = 0,
    toolCallCount,
    turnDepth,
    successfulProviderId,
    successfulModelId,
    attempts,
    transcript,
    providersUsed,
    providerTokenUsage = [],
    exactArtifacts,
    submittedPlan: submittedPlanFromSession,
  } = runResult;

  // Harness sessions do not expose a compatible model-window contract. Keep
  // this single runtime-normalized projection explicit instead of deriving a
  // percentage from transcript or billing totals.
  const contextUsage = normalizeContextUsageProjection({
    providerId: successfulProviderId ?? preferredProvider ?? "unknown",
    modelId: successfulModelId ?? effectiveModel ?? "unknown",
    turnId: sessionId,
    observedAt: new Date().toISOString(),
    measurement: "runtime_estimate",
    lifecycle: "completed",
  });

  if (directRouteHealthStore) {
    for (const attempt of attempts) {
      if (!isDirectApiProvider(attempt.providerId) || !attempt.model) {
        continue;
      }
      const errorMessage = attempt.error ?? lastError ?? "Provider ended with unknown error";
      try {
        await directRouteHealthStore.recordOutcome({
          providerId: attempt.providerId,
          modelId: attempt.model,
          outcome: attempt.succeeded
            ? { type: "ok" }
            : mapProviderModelRouteErrorToOutcome(errorMessage),
          ...(attempt.succeeded ? {} : { errorMessage }),
        });
      } catch (error) {
        runOutput.writeErrorLine(`[kiln] Route health update failed: ${errorToMessage(error)}`);
      }
    }
  }

  try {
    for (const entry of transcript) {
      const timestamp = "ts" in entry && typeof entry.ts === "string"
        ? entry.ts
        : new Date().toISOString();
      const eventId = randomUUID();
      await transcriptStore.appendNext(
        sessionId,
        projectOperatorTranscriptEntryToDraft({
          eventId,
          kilnSessionId: sessionId,
          timestamp,
          event: entry.event,
          source: operatorTranscriptSourceForEntry(entry.event, "cli", "run-command"),
        }),
      );
    }
  } catch {
    // fail-open
  }

  if (flags.plan && submittedPlanFromSession !== undefined) {
    try {
      await transcriptStore.appendNext(sessionId, {
        eventId: randomUUID(),
        kilnSessionId: sessionId,
        timestamp: new Date().toISOString(),
        kind: "tool_call_started",
        source: { actor: "tool", surface: "cli", component: "run-command" },
        payload: {
          type: "tool_use",
          name: "submit_plan",
          input: { plan: submittedPlanFromSession },
        },
      });
    } catch {
      // fail-open
    }
  }

  const submittedPlan = flags.plan
    ? await readSubmittedPlanFromTranscript(cwd, sessionId)
    : undefined;

  if (sessionSucceeded) {
    const completedAt = new Date().toISOString();
    const meta: PersistedSessionMeta = {
      kilnSessionId: sessionId,
      provider: successfulProviderId ?? "unknown",
      title: initialMetadata.title,
      summary: initialMetadata.summary,
      tags: deriveSessionMetadata({
        task,
        provider: successfulProviderId ?? preferredProvider,
        model: successfulModelId ?? effectiveModel,
        providersUsed,
        hasFileChanges: exactArtifacts.some((artifact) => /\b(created|modified|deleted|file)\b/i.test(artifact)),
      }).tags,
      providersUsed,
      task,
      startedAt,
      completedAt,
      lastTurnOutcome: "completed",
      costUsd: finalCostUsd,
      inputTokens,
      outputTokens,
      providerTokenUsage,
      toolCount: toolCallCount,
      turnDepth,
      resumeStrategy: context.resumeStrategy,
      resumeFeedback: context.resumeFeedback,
      sessionLedger: {
        currentPhase: "completed",
        resumedFrom: continuationSessionId,
        workingDirectory: context.workingDirectory,
        worktreePath: context.worktreePath,
        lastProvider: successfulProviderId,
        toolCallCount,
        turnDepth,
      },
      exactArtifacts: exactArtifacts.slice(0, 20),
    };

    try {
      await transcriptStore.finalize(sessionId, meta);
      const artifacts = buildCliCompletionContextArtifacts({
        sessionId,
        projectPath: cwd,
        domainDisplayName: context.domain.displayName,
        task,
        successfulProviderId,
        toolCallCount,
        turnDepth,
        exactArtifacts,
      });
      contextArtifactCache.set(artifacts.sessionArtifact);
      contextArtifactCache.set(artifacts.projectArtifact);
      contextArtifactCache.set(artifacts.planArtifact);
      const touchedFiles = extractTouchedFilePaths(exactArtifacts);
      for (const filePath of touchedFiles.slice(0, 5)) {
        const moduleArtifact = await buildModuleSummaryArtifact(cwd, filePath);
        if (moduleArtifact) {
          contextArtifactCache.set(moduleArtifact);
        }
      }
    } catch {
      // fail-open
    }

    const sg = appConfig.kilnYaml?.skillGeneration;
    const threshold = sg?.complexityThreshold ?? 0.6;
    const shouldAttemptSkillGeneration = sg?.enabled !== false
      && scoreComplexity({ messageText: task, toolCount: toolCallCount, turnDepth }).score >= threshold;

    if (shouldAttemptSkillGeneration && config.apiKey) {
      try {
        const skillsDir = join(cwd, ".kiln", "skills");
        const generator = new SkillGenerator({
          provider: new AnthropicAdapter({ apiKey: config.apiKey }),
          registry: new (await import("@kilnai/core")).SkillRegistry(),
          skillsDir,
          complexityThreshold: sg?.complexityThreshold,
        });
        void generator.maybeGenerate(task, accumulatedText, toolCallCount, turnDepth, transcript);
      } catch {
        // fail-open
      }
    } else if (
      shouldAttemptSkillGeneration
      && config.mode === "cli-wrapper"
      && !config.apiKey
    ) {
      runOutput.writeTelemetryLine('[kiln] Tip: run "kiln skill capture --last" after configuring ANTHROPIC_API_KEY to capture this session as a skill.');
    }
  }

  try {
    await transcriptStore.appendNext(sessionId, {
      eventId: randomUUID(),
      kilnSessionId: sessionId,
      timestamp: contextUsage.observedAt,
      kind: "context_usage_observed",
      source: { actor: "runtime", surface: "cli", component: "run-command" },
      payload: { contextUsage },
    });
  } catch {
    // Transcript persistence is best-effort and must not change the run outcome.
  }
  if (!sessionSucceeded) {
    await transcriptStore.finalize(sessionId, {
      completedAt: new Date().toISOString(),
      lastTurnOutcome: "failed",
      title: initialMetadata.title,
      summary: initialMetadata.summary,
      tags: deriveSessionMetadata({
        task,
        provider: successfulProviderId ?? preferredProvider,
        model: successfulModelId ?? effectiveModel,
        providersUsed,
        hasError: true,
      }).tags,
      providersUsed,
      costUsd: finalCostUsd,
      inputTokens,
      outputTokens,
      providerTokenUsage,
      toolCount: toolCallCount,
      turnDepth,
      resumeStrategy: context.resumeStrategy,
      resumeFeedback: context.resumeFeedback,
      sessionLedger: {
        currentPhase: "failed",
        resumedFrom: continuationSessionId,
        workingDirectory: context.workingDirectory,
        worktreePath: context.worktreePath,
        lastError: lastError ?? undefined,
        toolCallCount,
        turnDepth,
      },
      exactArtifacts: exactArtifacts.slice(0, 20),
    });
  }

  if (!sessionSucceeded && lastError) {
    const completedAt = new Date().toISOString();
    runOutput.writeErrorLine(`[kiln] All providers failed. Last error: ${lastError}`);
    const cleanupErrorMessage = await cleanupWorktreeForExit();
    emitRunOutput(runOutput, {
      answer: accumulatedText,
      sessionId,
      task,
      domain: context.domain.displayName,
      sessionSucceeded,
      provider: successfulProviderId,
      model: successfulModelId,
      costUsd: finalCostUsd,
      inputTokens,
      outputTokens,
      toolCallCount,
      turnDepth,
      startedAt,
      completedAt,
      durationMs: Date.now() - (manager.sessionStartTimeMs ?? Date.now()),
      contextGovernance: previewContextGovernance,
      contextUsage,
      lastError: appendCleanupFailure(lastError, cleanupErrorMessage),
      attempts,
      exactArtifacts,
    });
    exitRunCommand(1, executionOptions);
  }

  let verificationResult: VerificationResult | undefined;
  const gates = appConfig.kilnYaml?.qualityGates;
  if (gates?.length) {
    const mappedGates = gates.map((g) => ({
      name: g.name,
      command: g.command,
      description: g.name,
      required: g.required ?? true,
    }));
    try {
      verificationResult = await manager.runVerification(mappedGates, context.workingDirectory);
    } catch (error) {
      const errorMessage = `Failed to run verification gates. ${errorToMessage(error)}`;
      runOutput.writeErrorLine(`Error: ${errorMessage}`);
      const cleanupErrorMessage = await cleanupWorktreeForExit();
      emitRunFailureOutput(runOutput, {
        answer: accumulatedText,
        sessionId,
        task,
        domain: context.domain.displayName,
        provider: successfulProviderId,
        model: successfulModelId,
        costUsd: finalCostUsd,
        inputTokens,
        outputTokens,
        toolCallCount,
        turnDepth,
        startedAt,
        startedAtMs: manager.sessionStartTimeMs ?? startedAtMs,
        contextGovernance: previewContextGovernance,
        lastError: appendCleanupFailure(errorMessage, cleanupErrorMessage),
        attempts,
        exactArtifacts,
      });
      exitRunCommand(1, executionOptions);
    }
  }

  const evalScore = (() => {
    try {
      return computeEvalScore({
        succeeded: sessionSucceeded,
        durationMs: Date.now() - (manager.sessionStartTimeMs ?? Date.now()),
        costUsd: finalCostUsd,
        verificationPassed: verificationResult?.passed,
        toolCallCount,
      });
    } catch {
      return undefined;
    }
  })();

  const resumeOutcome: ResumeOutcome = {
    succeeded: sessionSucceeded,
    finalProvider: successfulProviderId,
    costUsd: finalCostUsd,
    toolCallCount: toolCallCount,
    durationMs: Date.now() - (manager.sessionStartTimeMs ?? Date.now()),
    verificationPassed: verificationResult?.passed,
  };

  try {
    await transcriptStore.finalize(sessionId, {
      resumeOutcome,
    });
  } catch {
    // fail-open
  }

  try {
    const report = manager.cleanup(sessionId, finalCostUsd, verificationResult, evalScore);
    const reportWithResumeStrategy = {
      ...report,
      resumeStrategy: context.resumeStrategy,
      resumeFeedback: context.resumeFeedback,
      resumeOutcome,
      contextGovernance: previewContextGovernance,
      contextUsage,
    };
    const finalReport = continuationSessionId
      ? { ...reportWithResumeStrategy, resumedFrom: continuationSessionId }
      : reportWithResumeStrategy;
    printReport(finalReport, "kiln", runOutput.writeTelemetryLine);
  } catch (error) {
    const errorMessage = `Failed to build session report. ${errorToMessage(error)}`;
    runOutput.writeErrorLine(`Error: ${errorMessage}`);
    const cleanupErrorMessage = await cleanupWorktreeForExit();
    emitRunFailureOutput(runOutput, {
      answer: accumulatedText,
      sessionId,
      task,
      domain: context.domain.displayName,
      provider: successfulProviderId,
      model: successfulModelId,
      costUsd: finalCostUsd,
      inputTokens,
      outputTokens,
      toolCallCount,
      turnDepth,
      startedAt,
      startedAtMs: manager.sessionStartTimeMs ?? startedAtMs,
      contextGovernance: previewContextGovernance,
      lastError: appendCleanupFailure(errorMessage, cleanupErrorMessage),
      attempts,
      verificationResult,
      evalScore,
      exactArtifacts,
    });
    exitRunCommand(1, executionOptions);
  }

  const completedAt = new Date().toISOString();
  const finalRunOutput = {
    answer: accumulatedText,
    sessionId,
    task,
    domain: context.domain.displayName,
    sessionSucceeded,
    provider: successfulProviderId,
    model: successfulModelId,
    costUsd: finalCostUsd,
    inputTokens,
    outputTokens,
    toolCallCount,
    turnDepth,
    startedAt,
    completedAt,
    durationMs: Date.now() - (manager.sessionStartTimeMs ?? Date.now()),
    verificationPassed: verificationResult?.passed,
    contextGovernance: previewContextGovernance,
    contextUsage,
    lastError,
    attempts,
    verificationResult,
    evalScore,
    exactArtifacts,
  };

  if (verificationResult && !verificationResult.passed) {
    const cleanupErrorMessage = await cleanupWorktreeForExit();
    emitRunFailureOutput(runOutput, {
      ...finalRunOutput,
      lastError: appendCleanupFailure("Verification gates failed.", cleanupErrorMessage),
    });
    exitRunCommand(1, executionOptions);
  }

  const cleanupErrorMessage = await cleanupWorktreeForExit();
  if (cleanupErrorMessage) {
    emitRunFailureOutput(runOutput, {
      ...finalRunOutput,
      lastError: cleanupErrorMessage,
    });
    exitRunCommand(1, executionOptions);
  }

  emitRunOutput(runOutput, finalRunOutput);

  if (flags.plan && submittedPlan !== undefined) {
    runOutput.writeTelemetryLine("═══════════════════════════════");
    runOutput.writeTelemetryLine(" PROPOSED PLAN");
    runOutput.writeTelemetryLine("═══════════════════════════════");
    process.stdout.write(submittedPlan.endsWith("\n") ? submittedPlan : `${submittedPlan}\n`);
    runOutput.writeTelemetryLine("═══════════════════════════════");

    const approved = await promptForPlanApproval();
    if (approved) {
      await runCommand(appConfig, task, { ...flags, plan: false }, executionOptions);
    }
    return;
  }
}

interface WorkerResult {
  workerIndex: number;
  childId: string;
  success: boolean;
  error?: string;
}

interface RunOutputEmissionInput {
  readonly answer: string;
  readonly sessionId: string;
  readonly task: string;
  readonly domain: string;
  readonly sessionSucceeded: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly toolCallCount: number;
  readonly turnDepth: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly verificationPassed?: boolean;
  readonly contextGovernance?: ReturnType<typeof summarizeContextGovernance>;
  readonly contextUsage?: import("@kilnai/gateway-contracts").ContextUsageProjection;
  readonly lastError: string | null;
  readonly attempts: readonly RunSessionAttemptResult[];
  readonly verificationResult?: VerificationResult;
  readonly evalScore?: ReturnType<typeof computeEvalScore>;
  readonly exactArtifacts: readonly string[];
}

interface RunFailureOutputInput {
  readonly answer: string;
  readonly sessionId: string;
  readonly task: string;
  readonly domain: string;
  readonly provider?: string;
  readonly model?: string;
  readonly costUsd?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly toolCallCount?: number;
  readonly turnDepth?: number;
  readonly startedAt: string;
  readonly startedAtMs?: number;
  readonly verificationPassed?: boolean;
  readonly contextGovernance?: ReturnType<typeof summarizeContextGovernance>;
  readonly contextUsage?: import("@kilnai/gateway-contracts").ContextUsageProjection;
  readonly lastError: string;
  readonly attempts?: readonly RunSessionAttemptResult[];
  readonly verificationResult?: VerificationResult;
  readonly evalScore?: ReturnType<typeof computeEvalScore>;
  readonly exactArtifacts?: readonly string[];
}

function emitRunFailureOutput(runOutput: RunOutputController, input: RunFailureOutputInput): void {
  const completedAt = new Date().toISOString();
  const startedAtMs = input.startedAtMs ?? Date.parse(input.startedAt);
  emitRunOutput(runOutput, {
    answer: input.answer,
    sessionId: input.sessionId,
    task: input.task,
    domain: input.domain,
    sessionSucceeded: false,
    provider: input.provider,
    model: input.model,
    costUsd: input.costUsd ?? 0,
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    toolCallCount: input.toolCallCount ?? 0,
    turnDepth: input.turnDepth ?? 0,
    startedAt: input.startedAt,
    completedAt,
    durationMs: Date.now() - (Number.isFinite(startedAtMs) ? startedAtMs : Date.now()),
    verificationPassed: input.verificationPassed,
    contextGovernance: input.contextGovernance,
    contextUsage: input.contextUsage,
    lastError: input.lastError,
    attempts: input.attempts ?? [],
    verificationResult: input.verificationResult,
    evalScore: input.evalScore,
    exactArtifacts: input.exactArtifacts ?? [],
  });
}

function emitRunOutput(runOutput: RunOutputController, input: RunOutputEmissionInput): void {
  if (runOutput.mode === "answer") {
    runOutput.emitAnswer(input.answer);
    return;
  }
  if (runOutput.mode === "json") {
    runOutput.emitJson(buildRunJsonOutputEnvelope(input));
  }
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendCleanupFailure(primaryError: string, cleanupError: string | undefined): string {
  return cleanupError ? `${primaryError}; ${cleanupError}` : primaryError;
}

function resolveParallelWorkerAdmissionLimits(
  appConfig: KilnAppConfig,
  managedInvocation: ManagedInvocationToolOptions,
  flags: RunFlags,
  task: string,
  workerCount: number,
): ManagedAgentOrchestrationAdmissionLimits {
  const lifecycleRoutes = managedInvocation.routes.filter((route) => {
    if (flags.provider && route.providerId !== flags.provider) return false;
    if (flags.model && route.model !== flags.model) return false;
    const profile = route.profiles["foundation-apply-approved-writes"];
    return profile !== undefined
      && profile.workingDirectory.mode === "isolated-worktree"
      && profile.workingDirectoryLease !== undefined
      && route.adapter.descriptor.lifecycle.exposesStart
      && route.adapter.descriptor.lifecycle.exposesTerminal;
  });
  const hasSingleLifecycleRoute = lifecycleRoutes.length === 1;
  const complexity = scoreComplexity({ messageText: task, toolCount: 0, turnDepth: 1 }).class;
  return {
    maxChildren: appConfig.kilnYaml?.parallelWorkers ?? workerCount,
    routeHealth: hasSingleLifecycleRoute ? "available" : "unavailable",
    budget: "available",
    workspace: hasSingleLifecycleRoute ? "available" : "unavailable",
    taskRisk: complexity === "complex" || complexity === "expert"
      ? "high"
      : complexity === "moderate"
        ? "medium"
        : "low",
  };
}

function projectParallelWorkerBudgetAdmission(
  globalConfig: KilnGlobalConfig | null | undefined,
  executionOptions: RunCommandExecutionOptions,
): ManagedAgentFanOutBudgetAdmissionInput | undefined {
  if (globalConfig?.routing?.budgetAware !== true) {
    return undefined;
  }
  return {
    policy: projectGlobalRoutingBudgetPolicy(globalConfig),
    ...(executionOptions.budgetUsageReader ? { usageReader: executionOptions.budgetUsageReader } : {}),
  };
}

export async function runParallelWorkers(
  appConfig: KilnAppConfig,
  task: string,
  flags: RunFlags,
  workerCount: number,
  managedInvocation: ManagedInvocationToolOptions | undefined,
  executionOptions: RunCommandExecutionOptions = {},
): Promise<void> {
  if (!managedInvocation) {
    console.error("Error: Managed lifecycle fan-out requires configured managed agent routes.");
    exitRunCommand(1, executionOptions);
  }
  const managedInvocationWithService = withManagedInvocationService(managedInvocation);

  const lineage = resolveParallelWorkerLineage(executionOptions.parallelWorkerLineage);
  const orchestrationRequest = buildManagedAgentFanOutOrchestrationRequest({
    orchestrationId: lineage.orchestrationId,
    parentSessionId: lineage.parentSessionId,
    parentTurnId: lineage.parentTurnId,
    requestedBy: "operator",
    requestSource: "cli:run-workers",
    task,
    childCount: workerCount,
    maxConcurrentChildren: workerCount,
  });
  const admissionLimits = resolveParallelWorkerAdmissionLimits(
    appConfig,
    managedInvocationWithService,
    flags,
    task,
    workerCount,
  );
  const admission = admitManagedAgentOrchestrationRequest(orchestrationRequest, admissionLimits);
  if (admission.status === "denied") {
    console.error(`Error: ${admission.reason}.`);
    for (const missingCapability of admission.missingCapabilities) {
      console.error(`- ${missingCapability}`);
    }
    exitRunCommand(1, executionOptions);
  }

  let lifecycleResult: Awaited<ReturnType<typeof runManagedAgentFanOutLifecycle>>;
  try {
    const budgetAdmission = projectParallelWorkerBudgetAdmission(executionOptions.globalConfig, executionOptions);
    lifecycleResult = await runManagedAgentFanOutLifecycle({
      orchestrationRequest: admission.request,
      managedInvocation: managedInvocationWithService,
      routeSelector: {
        ...(flags.provider ? { providerId: flags.provider } : {}),
        ...(flags.model ? { model: flags.model } : {}),
      },
      requestedAuthority: flags.requestedAuthority ?? "audited",
      ...(budgetAdmission ? { budgetAdmission } : {}),
    });
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    exitRunCommand(1, executionOptions);
  }

  const workerResults: WorkerResult[] = lifecycleResult.childRecords.map((child) => {
    if (child.record?.lifecycleState === "completed" || child.record?.lifecycleState === "recovered") {
      return {
        workerIndex: child.ordinal,
        childId: child.childId,
        success: true,
      };
    }
    return {
      workerIndex: child.ordinal,
      childId: child.childId,
      success: false,
      error: child.error ?? `lifecycle state ${child.record?.lifecycleState ?? "failed"}`,
    };
  });
  const orchestrationResult = lifecycleResult.orchestrationResult;

  console.log("");
  console.log("═══════════════════════════════════════");
  console.log(" PARALLEL WORKERS COMPLETE");
  console.log("═══════════════════════════════════════");
  console.log(` Orchestration: ${orchestrationResult.orchestrationId} (${orchestrationResult.mode})`);
  console.log(` Status: ${orchestrationResult.status}`);

  for (const wr of workerResults) {
    if (wr.success) {
      console.log(` Worker ${wr.workerIndex}: ✓ succeeded`);
    } else {
      console.log(` Worker ${wr.workerIndex}: ✗ failed — ${wr.error ?? "unknown error"}`);
    }
  }

  console.log("═══════════════════════════════════════");

  const succeededCount = workerResults.filter((wr) => wr.success).length;
  console.log(`${succeededCount}/${workerCount} workers succeeded`);

  if (succeededCount === 0) {
    exitRunCommand(1, executionOptions);
  }
}
