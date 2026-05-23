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
import { resolveResumeSessionId } from "../application/session-resume.js";
import { deriveSessionMetadata } from "../application/session-metadata.js";
import { SessionHooks } from "../application/session-hooks.js";
import { runSession } from "../application/run-session.js";
import type { RunSessionRouteCandidate } from "../application/run-session.js";
import { ApprovalMemoryStore as ApprovalMemoryStoreImpl } from "../wrapper/index.js";
import { TranscriptStore, type PersistedSessionMeta } from "../wrapper/session-store.js";
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
import { loadConfiguredBuiltinToolSurfaceOptions } from "../config/builtin-tool-surface-config.js";
import { getEngineBudgetStatus, resolveEngineAvailabilityMap } from "../engines/engine-registry.js";
import {
  SkillGenerator,
  AnthropicAdapter,
  GoalRunStore,
  WorkItemStore,
  admitManagedAgentOrchestrationRequest,
  buildManagedAgentFanOutOrchestrationRequest,
  createSessionBuiltinToolOptions,
  type CanonicalSessionEventKind,
  type ManagedAgentOrchestrationAdmissionLimits,
  type ReasoningEffort,
  type SessionEventSource,
  VerificationResult,
  formatProviderModelRouteCooldown,
  mapProviderModelRouteErrorToOutcome,
  scoreComplexity,
} from "@kilnai/core";
import {
  ProviderModelRouteHealthStore,
  createManagedAgentInvocationResourceProvider,
  discoverGuiDirectProviderModelDiscovery,
  getProjectContextArtifactCache,
  runManagedAgentFanOutLifecycle,
} from "@kilnai/runtime";
import type { ContextArtifactCache } from "@kilnai/core";
import type { ManagedInvocationToolOptions } from "@kilnai/runtime";
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
  readonly resume?: boolean;
  readonly plan?: boolean;
  readonly ephemeral?: boolean;
  readonly profile?: string;
  readonly skipGitRepoCheck?: boolean;
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
const PLAN_POLICY: KilnPermissionPolicy = { approval: "untrusted", sandbox: "read-only" };

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
}

export type RunProviderModelAdmission =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export function resolveRunProviderModelAdmission(input: {
  readonly provider: ProviderId | undefined;
  readonly model: string | undefined;
  readonly discovery: Readonly<Record<string, RunProviderModelDiscovery | undefined>>;
}): RunProviderModelAdmission {
  if (!isDirectApiProvider(input.provider)) {
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

  const model = input.model?.trim() ?? "";
  if (model.length === 0) {
    return {
      ok: false,
      error: `Provider '${input.provider}' requires a selected model.`,
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

  const admitted: AdmittedRunRouteCandidate[] = [];
  const routeCapabilities = new Map<string, { readonly supportedReasoningEfforts?: readonly ReasoningEffort[] }>();
  for (const candidate of input.candidates) {
    if (!isDirectApiProvider(candidate.provider)) {
      admitted.push(candidate as AdmittedRunRouteCandidate);
      continue;
    }

    const admission = resolveRunProviderModelAdmission({
      provider: candidate.provider,
      model: candidate.model,
      discovery: directDiscovery,
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
  readonly getDailyTokensUsed?: (engineId: string) => number;
}

function exitRunCommand(code: number, options: RunCommandExecutionOptions): never {
  if (options.exitOnFailure === false) {
    throw new RunCommandExitError(code);
  }
  process.exit(code);
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
  if (!task.trim()) {
    console.error(`Error: No task provided. Usage: kiln run "your task here"`);
    exitRunCommand(1, executionOptions);
  }

  const mode = resolveMode(flags);
  const cwd = process.cwd();
  let resolvedAgent: KilnAgentDefinition | undefined;
  if (flags.agent) {
    const definitions = await loadAgentDefinitions(cwd);
    resolvedAgent = findAgent(definitions, flags.agent);
    if (!resolvedAgent) {
      console.error(`Error: Agent "${flags.agent}" not found in .kiln/agents/ or ~/.kiln/agents/`);
      exitRunCommand(1, executionOptions);
    }
  }

  const globalConfig = readGlobalConfig();
  const projectConfig = readKilnYaml(join(cwd, ".kiln"));
  const resolvedKilnConfig = await loadKilnConfig(cwd);
  const routeTask = inferRouteTask({
    text: task,
    agentTaskAffinity: resolvedAgent?.taskAffinity,
  });
  const configuredRouteCandidates = resolveProviderRouteCandidates({
    globalConfig,
    flagProvider: flags.provider,
    flagModel: flags.model,
    taskText: task,
    agentTaskAffinity: resolvedAgent?.taskAffinity,
  }).map((candidate) => (
    candidate.model || !resolvedAgent?.model
      ? candidate
      : { ...candidate, model: resolvedAgent.model }
  ));
  const preferredProvider = configuredRouteCandidates[0]?.provider;
  if (
    flags.requestedAuthority
    && flags.requestedAuthority !== "auto"
    && (!preferredProvider || !isDirectApiProvider(preferredProvider))
  ) {
    console.error("--authority is only supported for direct API providers in CLI run. Use --plan for harness read-only planning.");
    exitRunCommand(1, executionOptions);
  }
  const effectiveModel = configuredRouteCandidates[0]?.model
    ?? resolveEffectiveModel(flags.model, resolveGlobalDefaultModel(globalConfig))
    ?? resolvedAgent?.model;
  const config = buildConfig({ ...flags, provider: preferredProvider }, mode);
  let identityAppConfig = withWorkGovernanceContext(
    withGlobalIdentityContext(appConfig, globalConfig),
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
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    exitRunCommand(1, executionOptions);
  }
  const runtimeAppConfig = appendAgentInstructionsToSystemPrompt(identityAppConfig, resolvedAgent);
  const sessionId = randomUUID();
  const { registry, worktreeManager } = createDefaultRegistry();
  const contextArtifactCache: ContextArtifactCache = await getProjectContextArtifactCache(cwd);
  const manager = new SessionManager(config, runtimeAppConfig, contextArtifactCache, worktreeManager);
  const resumeSessionId = await resolveResumeSessionId(
    cwd,
    flags.resume,
    preferredProvider,
  );
  const transcriptStore = new TranscriptStore(cwd);
  const resumedMeta = resumeSessionId
    ? await transcriptStore.readMeta(resumeSessionId)
    : null;
  const resumeStrategyFeedback = resumeSessionId
    ? await inferResumeStrategyFeedback(transcriptStore, preferredProvider)
    : undefined;

  let context;
  try {
    context = await manager.prepare(
      task,
      cwd,
      undefined,
      flags.isolate,
      resumeSessionId,
      resumedMeta ?? undefined,
      preferredProvider,
      resumeStrategyFeedback,
    );
  } catch (err) {
    console.error("Error: Failed to prepare session.", err instanceof Error ? err.message : err);
    exitRunCommand(1, executionOptions);
  }
  const approvalMemorySessionId = resumeSessionId ?? sessionId;
  const previewContextGovernance = summarizeContextGovernance(context.projectedContext);
  let worktreeCleaned = false;
  const cleanupWorktreeOnce = async (): Promise<void> => {
    if (worktreeCleaned) return;
    await manager.cleanupWorktree(context);
    worktreeCleaned = true;
  };
  if (appConfig.kilnYaml?.contextGovernance?.previewBeforeApply) {
    printContextGovernancePreview(previewContextGovernance);
  }

  console.log(`Domain:  ${context.domain.displayName}`);
  console.log(`Mode:    ${mode}`);
  console.log("Kiln session starting...");
  console.log("");

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
        env,
        routeHealthStore: directRouteHealthStore ?? new ProviderModelRouteHealthStore(),
      })
    : { candidates: [], rejectedReasons: [], routeCapabilities: new Map() };
  if (configuredRouteCandidates.length > 0 && admittedRoutes.candidates.length === 0) {
    console.error("Error: No configured provider routes are currently available.");
    for (const reason of admittedRoutes.rejectedReasons) {
      console.error(`- ${reason}`);
    }
    await cleanupWorktreeOnce();
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

  const configuredBuiltinToolOptions = await loadConfiguredBuiltinToolSurfaceOptions(appConfig, cwd, {
      memoryAuthority: {
        modelFacingSession: true,
        permissionPolicy: config.permissionPolicy,
        permissionAgent: resolvedAgent?.name,
        caller: { kind: "operator_surface", id: "run" },
      },
    });
  const workItemStore = new WorkItemStore();
  const goalRunStore = new GoalRunStore();
  let builtinToolOptions = createSessionBuiltinToolOptions({
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
  });
  const engineAvailability = resolveEngineAvailabilityMap(globalConfig);
  const managedAgentProviderModels = await discoverManagedAgentProviderModels();
  const managedInvocationResolution = await resolveManagedInvocationToolOptions(globalConfig, {
    cwd,
    registry,
    surface: "run",
    isProviderAvailable: (providerId) => engineAvailability.get(providerId),
    providerModels: managedAgentProviderModels,
    directAdapterFactory: createManagedDirectProviderAdapterFactory({ builtinToolOptions, runtimeEnv: env }),
    artifactStore: builtinToolOptions.artifactResources?.store,
  });
  const managedInvocation = appConfig.managedInvocation ?? managedInvocationResolution.managedInvocation;
  if (managedInvocation?.invocationService) {
    builtinToolOptions = createSessionBuiltinToolOptions({
      ...builtinToolOptions,
      resourceProviders: [
        ...(builtinToolOptions.resourceProviders ?? []),
        createManagedAgentInvocationResourceProvider({
          service: managedInvocation.invocationService,
        }),
      ],
    });
  }

  const startedAt = new Date().toISOString();
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
          resumedFrom: resumeSessionId,
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
            console.error(`Error: Parallel worker cleanup failed: ${cleanupErrors
              .map((error) => error instanceof Error ? error.message : String(error))
              .join("; ")}`);
          }
        })();
      }
      return workerFinalization;
    };
    const unregisterWorkerSignalHandlers = (): void => {
      if (!workerSignalHandlersRegistered) return;
      process.off("SIGINT", workerShutdown);
      process.off("SIGTERM", workerShutdown);
      workerSignalHandlersRegistered = false;
    };
    const workerShutdown = (signal: NodeJS.Signals): void => {
      if (workerShutdownStarted) return;
      workerShutdownStarted = true;
      workerError = `Parallel worker run interrupted by ${signal}.`;
      void finalizeAndCleanupParallelWorkerRun()
        .catch((error) => {
          console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          process.exit(130);
        });
    };
    process.on("SIGINT", workerShutdown);
    process.on("SIGTERM", workerShutdown);
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
          resumedFrom: resumeSessionId,
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
      await runParallelWorkers(appConfig, task, flags, workerCount, managedInvocation, {
        ...executionOptions,
        exitOnFailure: false,
        globalConfig,
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
      resumedFrom: resumeSessionId,
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
    resumeSessionId: context.resumeSessionId,
    ephemeral: flags.ephemeral,
    profile: flags.profile,
    skipGitRepoCheck: flags.skipGitRepoCheck,
    outputSchema: flags.outputSchema,
    addDir: flags.addDir,
    localProvider: flags.localProvider,
    builtinToolOptions,
    managedInvocation,
    model: effectiveModel,
    reasoningEffort: flags.reasoningEffort,
    requestedAuthority: flags.requestedAuthority,
  };

  const sessionHooks = new SessionHooks(appConfig.kilnYaml?.hooks, {
    sessionId,
    workingDirectory: context.workingDirectory,
  });
  const approvalMemoryStore: ApprovalMemoryStore = new ApprovalMemoryStoreImpl(cwd);

  let signalHandlersRegistered = false;
  let shutdownStarted = false;
  const unregisterSignalHandlers = (): void => {
    if (!signalHandlersRegistered) return;
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    signalHandlersRegistered = false;
  };
  const shutdown = (): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    unregisterSignalHandlers();
    void cleanupRegistry.runAll()
      .then(cleanupWorktreeOnce)
      .finally(() => {
        process.exit(130);
      });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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
    });
  } catch (error) {
    await cleanupWorktreeOnce();
    throw error;
  } finally {
    sessionHooks.sessionEnd();
    unregisterSignalHandlers();
  }

  const {
    finalCostUsd,
    sessionSucceeded,
    lastError,
    accumulatedText,
    toolCallCount,
    turnDepth,
    successfulProviderId,
    successfulModelId,
    attempts,
    transcript,
    exactArtifacts,
    submittedPlan: submittedPlanFromSession,
  } = runResult;

  if (directRouteHealthStore) {
    for (const attempt of attempts) {
      if (!isDirectApiProvider(attempt.providerId) || !attempt.model) {
        continue;
      }
      const errorMessage = attempt.error ?? lastError ?? "Provider ended with unknown error";
      await directRouteHealthStore.recordOutcome({
        providerId: attempt.providerId,
        modelId: attempt.model,
        outcome: attempt.succeeded
          ? { type: "ok" }
          : mapProviderModelRouteErrorToOutcome(errorMessage),
        ...(attempt.succeeded ? {} : { errorMessage }),
      });
    }
  }

  try {
    for (const [seq, entry] of transcript.entries()) {
      const timestamp = "ts" in entry && typeof entry.ts === "string"
        ? entry.ts
        : new Date().toISOString();
      const legacyType = typeof entry.event.type === "string" ? entry.event.type : "assistant_message";
      await transcriptStore.append(sessionId, {
        eventId: randomUUID(),
        kilnSessionId: sessionId,
        sequence: seq + 1,
        timestamp,
        kind: mapTranscriptTypeToKind(legacyType),
        source: mapTranscriptTypeToSource(legacyType),
        payload: entry.event as Record<string, unknown>,
      });
    }
  } catch {
    // fail-open
  }

  if (flags.plan && submittedPlanFromSession !== undefined) {
    try {
      await transcriptStore.append(sessionId, {
        eventId: randomUUID(),
        kilnSessionId: sessionId,
        sequence: transcript.length + 1,
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
        hasFileChanges: exactArtifacts.some((artifact) => /\b(created|modified|deleted|file)\b/i.test(artifact)),
      }).tags,
      task,
      startedAt,
      completedAt,
      lastTurnOutcome: "completed",
      costUsd: finalCostUsd,
      toolCount: toolCallCount,
      turnDepth,
      resumeStrategy: context.resumeStrategy,
      resumeFeedback: context.resumeFeedback,
      sessionLedger: {
        currentPhase: "completed",
        resumedFrom: resumeSessionId,
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
      console.log('[kiln] Tip: run "kiln skill capture --last" after configuring ANTHROPIC_API_KEY to capture this session as a skill.');
    }
  }
  if (!sessionSucceeded) {
    await transcriptStore.finalize(sessionId, {
      completedAt: new Date().toISOString(),
      lastTurnOutcome: "failed",
      title: initialMetadata.title,
      summary: initialMetadata.summary,
      tags: initialMetadata.tags,
      costUsd: finalCostUsd,
      toolCount: toolCallCount,
      turnDepth,
      resumeStrategy: context.resumeStrategy,
      resumeFeedback: context.resumeFeedback,
      sessionLedger: {
        currentPhase: "failed",
        resumedFrom: resumeSessionId,
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
    console.error(`[kiln] All providers failed. Last error: ${lastError}`);
    await cleanupWorktreeOnce();
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
    verificationResult = await manager.runVerification(mappedGates, context.workingDirectory);
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

  const report = manager.cleanup(sessionId, finalCostUsd, verificationResult, evalScore);
  const reportWithResumeStrategy = {
    ...report,
    resumeStrategy: context.resumeStrategy,
    resumeFeedback: context.resumeFeedback,
    resumeOutcome,
    contextGovernance: previewContextGovernance,
  };
  const finalReport = resumeSessionId
    ? { ...reportWithResumeStrategy, resumedFrom: resumeSessionId }
    : reportWithResumeStrategy;
  printReport(finalReport, "kiln");

  if (verificationResult && !verificationResult.passed) {
    await cleanupWorktreeOnce();
    exitRunCommand(1, executionOptions);
  }

  await cleanupWorktreeOnce();

  if (flags.plan && submittedPlan !== undefined) {
    console.log("═══════════════════════════════");
    console.log(" PROPOSED PLAN");
    console.log("═══════════════════════════════");
    process.stdout.write(submittedPlan.endsWith("\n") ? submittedPlan : `${submittedPlan}\n`);
    console.log("═══════════════════════════════");

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

function mapTranscriptTypeToKind(type: string): CanonicalSessionEventKind {
  switch (type) {
    case "user":
      return "user_message";
    case "text_delta":
      return "assistant_delta";
    case "tool_use":
      return "tool_call_started";
    case "tool_result":
      return "tool_call_completed";
    case "error":
      return "error_recorded";
    default:
      return "assistant_message";
  }
}

function mapTranscriptTypeToSource(type: string): SessionEventSource {
  switch (type) {
    case "user":
      return { actor: "user", surface: "cli", component: "run-command" };
    case "text_delta":
      return { actor: "assistant", surface: "cli", component: "run-command" };
    case "tool_use":
    case "tool_result":
      return { actor: "tool", surface: "cli", component: "run-command" };
    case "error":
      return { actor: "runtime", surface: "cli", component: "run-command" };
    default:
      return { actor: "system", surface: "cli", component: "run-command" };
  }
}

function resolveParallelWorkerAdmissionLimits(
  appConfig: KilnAppConfig,
  managedInvocation: ManagedInvocationToolOptions,
  flags: RunFlags,
  task: string,
  workerCount: number,
  executionOptions: RunCommandExecutionOptions,
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
    budget: resolveParallelWorkerBudgetAvailability(executionOptions.globalConfig, lifecycleRoutes, executionOptions),
    workspace: hasSingleLifecycleRoute ? "available" : "unavailable",
    taskRisk: complexity === "complex" || complexity === "expert"
      ? "high"
      : complexity === "moderate"
        ? "medium"
        : "low",
  };
}

function resolveParallelWorkerBudgetAvailability(
  globalConfig: KilnGlobalConfig | null | undefined,
  lifecycleRoutes: readonly ManagedInvocationToolOptions["routes"][number][],
  executionOptions: RunCommandExecutionOptions,
): ManagedAgentOrchestrationAdmissionLimits["budget"] {
  if (globalConfig?.routing?.budgetAware !== true) {
    return "available";
  }
  if (!executionOptions.getDailyTokensUsed) {
    return "unavailable";
  }
  if (lifecycleRoutes.length === 0) {
    return "unavailable";
  }
  return lifecycleRoutes.some((route) =>
    getEngineBudgetStatus(globalConfig, route.providerId, {
      getDailyTokensUsed: executionOptions.getDailyTokensUsed,
    }).withinBudget
  )
    ? "available"
    : "unavailable";
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

  const orchestrationRequest = buildManagedAgentFanOutOrchestrationRequest({
    orchestrationId: "cli-run-workers",
    parentSessionId: "cli-run",
    parentTurnId: "cli-run-workers",
    requestedBy: "operator",
    requestSource: "cli:run-workers",
    task,
    childCount: workerCount,
    maxConcurrentChildren: workerCount,
  });
  const admission = admitManagedAgentOrchestrationRequest(orchestrationRequest, {
    ...resolveParallelWorkerAdmissionLimits(appConfig, managedInvocation, flags, task, workerCount, executionOptions),
  });
  if (admission.status === "denied") {
    console.error(`Error: ${admission.reason}.`);
    for (const missingCapability of admission.missingCapabilities) {
      console.error(`- ${missingCapability}`);
    }
    exitRunCommand(1, executionOptions);
  }

  let lifecycleResult: Awaited<ReturnType<typeof runManagedAgentFanOutLifecycle>>;
  try {
    lifecycleResult = await runManagedAgentFanOutLifecycle({
      orchestrationRequest: admission.request,
      managedInvocation,
      routeSelector: {
        ...(flags.provider ? { providerId: flags.provider } : {}),
        ...(flags.model ? { model: flags.model } : {}),
      },
      requestedAuthority: flags.requestedAuthority ?? "audited",
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
