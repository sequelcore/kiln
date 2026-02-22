// Engine loader: AppLoader -- parses App YAML into typed composites
// Validates dependency graph: team refs in router must exist in teams

import { parse } from "yaml";
import { KilnError } from "../errors.js";
import type { App, MemoryConfig } from "../composites/app.js";
import { validateApp } from "../composites/app.js";
import type { Team, QualityGate, TeamMode } from "../composites/team.js";
import type { Router, PatternRule } from "../composites/router.js";
import type { Agent, AgentTier } from "../domain/agent.js";
import type { Modality } from "../domain/modality.js";
import { VALID_MODALITIES } from "../domain/modality.js";
import type { VoiceConfig, SttProviderConfig, TtsProviderConfig } from "../domain/speech-config.js";
import { validateVoiceConfig } from "../domain/speech-config.js";
import type { Capability } from "../domain/capability.js";
import type { Workflow, Gate } from "../domain/workflow.js";
import type { MemoryScope } from "../domain/memory.js";
import type { Trigger, TriggerType } from "../domain/trigger.js";
import type { KnowledgeConfig, KnowledgeEmbeddingConfig, KnowledgeStoreConfig, KnowledgeChunkingConfig, KnowledgeSourceConfig } from "../domain/knowledge-config.js";
import { validateKnowledgeConfig } from "../domain/knowledge-config.js";
import type { EvalConfig, EvalScorerConfig, EvalDatasetConfig, EvalExperimentConfig } from "../domain/eval-config.js";
import { validateEvalConfig } from "../domain/eval-config.js";
import type { McpConfig, McpServerConfig, McpTransport } from "../domain/mcp-config.js";
import { validateMcpConfig } from "../domain/mcp-config.js";
import type { ToolSelectionConfig, ToolSelectionStrategy } from "../domain/tool-selection-config.js";
import { validateToolSelectionConfig } from "../domain/tool-selection-config.js";
import type { SafetyConfig, PiiType, PiiAction, ContentAction, RailConfig } from "../domain/safety-config.js";
import { validateSafetyConfig } from "../domain/safety-config.js";

/** Error class for YAML loader failures, aggregating all validation errors */
export class AppLoaderError extends KilnError {
  readonly errors: readonly { field: string; message: string }[];

  constructor(errors: readonly { field: string; message: string }[]) {
    const msg = errors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
    super("APP_YAML_INVALID", `Invalid app YAML:\n${msg}`, {
      context: { errors },
      retryable: false,
    });
    this.name = "AppLoaderError";
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// Internal YAML shape types (unvalidated raw structure from parse())
// ---------------------------------------------------------------------------

interface RawAgent {
  name?: unknown;        // Persona name (e.g., "Aria") -- REQUIRED
  tier?: unknown;
  tools?: unknown;
  role?: unknown;        // Expertise / function -- REQUIRED
  goal?: unknown;        // What agent is trying to achieve -- REQUIRED
  backstory?: unknown;   // Personality, perspective -- optional
  instructions?: unknown; // Operating rules and constraints -- optional
  structured?: unknown;
  count?: unknown;
  sandbox?: unknown;
  modalities?: unknown;  // Content modalities -- optional (defaults to ["text"])
  // systemPrompt REMOVED -- replaced by auto-assembled prompt
}

interface RawGate {
  requires?: unknown;
}

interface RawWorkflow {
  phases?: unknown;
  gates?: unknown;
  maxIterations?: unknown;
}

interface RawCapability {
  name?: unknown;
  description?: unknown;
  schema?: unknown;
  tags?: unknown;
  annotations?: unknown;
  type?: unknown;
  targetApp?: unknown;
  task?: unknown;
  timeout?: unknown;
  guardrail?: unknown;
  guardrailRetries?: unknown;
  outputSchema?: unknown;
}

interface RawQualityGate {
  name?: unknown;
  command?: unknown;
  description?: unknown;
  required?: unknown;
}

interface RawTeam {
  agents?: unknown;
  workflow?: unknown;
  capabilities?: unknown;
  qualityGates?: unknown;
  quality?: unknown;
  mode?: unknown;
  manager?: unknown;
}

interface RawRule {
  match?: unknown;
  team?: unknown;
}

interface RawRouter {
  rules?: unknown;
  classifier?: unknown;
  fallback?: unknown;
}

interface RawMemory {
  scopes?: unknown;
  backend?: unknown;
  sync?: unknown;
}

interface RawTrigger {
  name?: unknown;
  type?: unknown;
  team?: unknown;
  task?: unknown;
  enabled?: unknown;
  path?: unknown;
  method?: unknown;
  secretEnv?: unknown;
  event?: unknown;
  filter?: unknown;
  cron?: unknown;
  timezone?: unknown;
}

interface RawKnowledgeEmbedding {
  provider?: unknown;
  model?: unknown;
  apiKeyEnv?: unknown;
  baseUrl?: unknown;
}

interface RawKnowledgeStore {
  backend?: unknown;
  connectionString?: unknown;
}

interface RawKnowledgeChunking {
  strategy?: unknown;
  chunkSize?: unknown;
  chunkOverlap?: unknown;
}

interface RawKnowledgeSource {
  name?: unknown;
  path?: unknown;
  watch?: unknown;
  chunking?: unknown;
}

interface RawKnowledge {
  embedding?: unknown;
  store?: unknown;
  chunking?: unknown;
  sources?: unknown;
  allowedAgents?: unknown;
}

interface RawEvalScorer {
  name?: unknown;
  type?: unknown;
  scorers?: unknown;
  schema?: unknown;
  prompt?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  maxLatencyMs?: unknown;
  maxCostUsd?: unknown;
  substrings?: unknown;
}

interface RawEvalDataset {
  name?: unknown;
  path?: unknown;
}

interface RawEvalExperiment {
  name?: unknown;
  dataset?: unknown;
  team?: unknown;
  scorers?: unknown;
  overrides?: unknown;
  compare?: unknown;
}

interface RawEval {
  datasets?: unknown;
  scorers?: unknown;
  experiments?: unknown;
}

interface RawMcpServer {
  name?: unknown;
  transport?: unknown;
  url?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  reconnect?: unknown;
}

interface RawMcp {
  servers?: unknown;
}

interface RawToolSelection {
  strategy?: unknown;
  maxTools?: unknown;
  threshold?: unknown;
}

interface RawVoice {
  stt?: unknown;
  tts?: unknown;
}

interface RawSttProvider {
  provider?: unknown;
  model?: unknown;
  apiKeyEnv?: unknown;
  language?: unknown;
}

interface RawTtsProvider {
  provider?: unknown;
  model?: unknown;
  apiKeyEnv?: unknown;
  voice?: unknown;
}

interface RawPiiConfig {
  detect?: unknown;
  action?: unknown;
  deepScan?: unknown;
  allowlist?: unknown;
}

interface RawContentCategoryConfig {
  threshold?: unknown;
  action?: unknown;
}

interface RawContentConfig {
  enabled?: unknown;
  categories?: unknown;
  deepScan?: unknown;
}

interface RawRailConfig {
  type?: unknown;
  block?: unknown;
  escalate?: unknown;
  competitors?: unknown;
  response?: unknown;
  triggers?: unknown;
  required?: unknown;
  forbid?: unknown;
}

interface RawSafetyConfig {
  pii?: unknown;
  content?: unknown;
  rails?: unknown;
}

interface RawApp {
  name?: unknown;
  channels?: unknown;
  memory?: unknown;
  router?: unknown;
  teams?: unknown;
  triggers?: unknown;
  knowledge?: unknown;
  eval?: unknown;
  mcp?: unknown;
  toolSelection?: unknown;
  voice?: unknown;
  safety?: unknown;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

const VALID_TIERS: AgentTier[] = ["reasoning", "coding", "fast"];

function mapAgent(identifier: string, raw: RawAgent, path: string): { agent: Agent; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  // name: persona name from YAML (required) -- falls back to identifier for safety
  const name = typeof raw.name === "string" && raw.name.trim() !== ""
    ? raw.name.trim()
    : identifier;
  if (!raw.name || typeof raw.name !== "string" || raw.name.trim() === "") {
    errors.push({ field: `${path}.name`, message: "must be a non-empty string (persona name)" });
  }

  // role: expertise / function (required)
  const role = typeof raw.role === "string" ? raw.role.trim() : "";
  if (!raw.role || typeof raw.role !== "string" || raw.role.trim() === "") {
    errors.push({ field: `${path}.role`, message: "must be a non-empty string (expertise/function)" });
  }

  // goal: what agent is trying to achieve (required)
  const goal = typeof raw.goal === "string" ? raw.goal.trim() : "";
  if (!raw.goal || typeof raw.goal !== "string" || raw.goal.trim() === "") {
    errors.push({ field: `${path}.goal`, message: "must be a non-empty string (what agent achieves)" });
  }

  // tier: model class (required)
  const tier = raw.tier;
  if (!tier || !VALID_TIERS.includes(tier as AgentTier)) {
    errors.push({ field: `${path}.tier`, message: `must be one of: ${VALID_TIERS.join(", ")}` });
  }

  // tools: capability references (can be [])
  const tools: string[] = [];
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools)) {
      errors.push({ field: `${path}.tools`, message: "must be an array" });
    } else {
      for (const t of raw.tools) {
        if (typeof t !== "string") {
          errors.push({ field: `${path}.tools`, message: "all entries must be strings" });
          break;
        }
        tools.push(t);
      }
    }
  }

  // modalities: optional content type declarations
  let modalities: Modality[] | undefined;
  if (raw.modalities !== undefined) {
    if (!Array.isArray(raw.modalities)) {
      errors.push({ field: `${path}.modalities`, message: "must be an array" });
    } else {
      modalities = [];
      for (const m of raw.modalities) {
        if (typeof m !== "string") {
          errors.push({ field: `${path}.modalities`, message: "all entries must be strings" });
          break;
        }
        if (!VALID_MODALITIES.includes(m as Modality)) {
          errors.push({ field: `${path}.modalities`, message: `unknown modality "${m}", must be one of: ${VALID_MODALITIES.join(", ")}` });
        } else {
          modalities.push(m as Modality);
        }
      }
    }
  }

  const agent: Agent = {
    name,
    role,
    goal,
    tier: (tier as AgentTier) ?? "coding",
    tools,
    ...(typeof raw.backstory === "string" ? { backstory: raw.backstory.trim() } : {}),
    ...(typeof raw.instructions === "string" ? { instructions: raw.instructions.trim() } : {}),
    ...(typeof raw.structured === "boolean" ? { structured: raw.structured } : {}),
    ...(typeof raw.count === "number" ? { count: raw.count } : {}),
    ...(typeof raw.sandbox === "boolean" ? { sandbox: raw.sandbox } : {}),
    ...(modalities && modalities.length > 0 ? { modalities } : {}),
  };

  return { agent, errors };
}

function mapWorkflow(raw: RawWorkflow, path: string): { workflow: Workflow; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  const phases: string[] = [];
  if (!raw.phases || !Array.isArray(raw.phases)) {
    errors.push({ field: `${path}.phases`, message: "must be a non-empty array" });
  } else {
    for (const p of raw.phases) {
      if (typeof p !== "string") {
        errors.push({ field: `${path}.phases`, message: "all entries must be strings" });
        break;
      }
      phases.push(p);
    }
  }

  const gates: Record<string, Gate> = {};
  if (raw.gates !== undefined) {
    if (typeof raw.gates !== "object" || raw.gates === null || Array.isArray(raw.gates)) {
      errors.push({ field: `${path}.gates`, message: "must be an object" });
    } else {
      for (const [phaseName, gateRaw] of Object.entries(raw.gates as Record<string, RawGate>)) {
        const requires: string[] = [];
        if (Array.isArray(gateRaw?.requires)) {
          for (const r of gateRaw.requires) {
            if (typeof r === "string") requires.push(r);
          }
        }
        gates[phaseName] = { requires };
      }
    }
  }

  const workflow: Workflow = {
    phases,
    gates,
    ...(typeof raw.maxIterations === "number" ? { maxIterations: raw.maxIterations } : {}),
  };

  return { workflow, errors };
}

function mapCapability(raw: RawCapability, path: string): { capability: Capability; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  if (!raw.name || typeof raw.name !== "string") {
    errors.push({ field: `${path}.name`, message: "must be a non-empty string" });
  }
  if (!raw.description || typeof raw.description !== "string") {
    errors.push({ field: `${path}.description`, message: "must be a non-empty string" });
  }

  const tags: string[] = [];
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags)) {
      errors.push({ field: `${path}.tags`, message: "must be an array" });
    } else {
      for (const t of raw.tags) {
        if (typeof t === "string") tags.push(t);
      }
    }
  }

  // Validate guardrailRetries
  if (raw.guardrailRetries !== undefined) {
    if (typeof raw.guardrailRetries !== "number" || !Number.isInteger(raw.guardrailRetries) || raw.guardrailRetries < 1) {
      errors.push({ field: `${path}.guardrailRetries`, message: "must be a positive integer" });
    }
  }

  // Validate outputSchema
  if (raw.outputSchema !== undefined) {
    if (typeof raw.outputSchema !== "object" || raw.outputSchema === null || Array.isArray(raw.outputSchema)) {
      errors.push({ field: `${path}.outputSchema`, message: "must be a valid object" });
    }
  }

  const capability: Capability = {
    name: typeof raw.name === "string" ? raw.name : "",
    description: typeof raw.description === "string" ? raw.description : "",
    schema: typeof raw.schema === "object" && raw.schema !== null && !Array.isArray(raw.schema)
      ? (raw.schema as Record<string, unknown>)
      : {},
    tags,
    ...(raw.annotations ? { annotations: raw.annotations as Capability["annotations"] } : {}),
    ...(typeof raw.type === "string" ? { type: raw.type } : {}),
    ...(typeof raw.targetApp === "string" ? { targetApp: raw.targetApp } : {}),
    ...(typeof raw.task === "string" ? { task: raw.task } : {}),
    ...(typeof raw.timeout === "number" && raw.timeout > 0 ? { timeout: raw.timeout } : {}),
    ...(typeof raw.guardrail === "string" ? { guardrail: raw.guardrail } : {}),
    ...(typeof raw.guardrailRetries === "number" && Number.isInteger(raw.guardrailRetries) && raw.guardrailRetries >= 1
      ? { guardrailRetries: raw.guardrailRetries }
      : {}),
    ...(typeof raw.outputSchema === "object" && raw.outputSchema !== null && !Array.isArray(raw.outputSchema)
      ? { outputSchema: raw.outputSchema as Record<string, unknown> }
      : {}),
  };

  if (raw.type === "delegation") {
    if (typeof raw.targetApp !== "string" || raw.targetApp === "") {
      errors.push({ field: `${path}.targetApp`, message: "required when type is 'delegation'" });
    }
    if (typeof raw.task !== "string" || raw.task === "") {
      errors.push({ field: `${path}.task`, message: "required when type is 'delegation'" });
    }
  }

  if (raw.type === "a2a") {
    if (typeof raw.targetApp !== "string" || raw.targetApp === "") {
      errors.push({ field: `${path}.targetApp`, message: "required when type is 'a2a' (must be agent URL)" });
    }
  }

  return { capability, errors };
}

function mapQualityGate(raw: RawQualityGate, path: string): { gate: QualityGate; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  if (!raw.name || typeof raw.name !== "string") {
    errors.push({ field: `${path}.name`, message: "must be a non-empty string" });
  }
  if (!raw.command || typeof raw.command !== "string") {
    errors.push({ field: `${path}.command`, message: "must be a non-empty string" });
  }
  if (!raw.description || typeof raw.description !== "string") {
    errors.push({ field: `${path}.description`, message: "must be a non-empty string" });
  }

  const gate: QualityGate = {
    name: typeof raw.name === "string" ? raw.name : "",
    command: typeof raw.command === "string" ? raw.command : "",
    description: typeof raw.description === "string" ? raw.description : "",
    required: typeof raw.required === "boolean" ? raw.required : true,
  };

  return { gate, errors };
}

function mapTeam(name: string, raw: RawTeam, path: string): { team: Team; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];
  const agents: Record<string, Agent> = {};

  // Agents
  if (!raw.agents || typeof raw.agents !== "object" || Array.isArray(raw.agents)) {
    errors.push({ field: `${path}.agents`, message: "must be an object" });
  } else {
    for (const [agentName, agentRaw] of Object.entries(raw.agents as Record<string, RawAgent>)) {
      const { agent, errors: agentErrors } = mapAgent(agentName, agentRaw ?? {}, `${path}.agents.${agentName}`);
      agents[agentName] = agent;
      errors.push(...agentErrors);
    }
  }

  // Workflow
  let workflow: Workflow = { phases: [], gates: {} };
  if (!raw.workflow || typeof raw.workflow !== "object" || Array.isArray(raw.workflow)) {
    errors.push({ field: `${path}.workflow`, message: "must be an object" });
  } else {
    const { workflow: wf, errors: wfErrors } = mapWorkflow(raw.workflow as RawWorkflow, `${path}.workflow`);
    workflow = wf;
    errors.push(...wfErrors);
  }

  // Capabilities
  const capabilities: Capability[] = [];
  if (raw.capabilities !== undefined) {
    if (!Array.isArray(raw.capabilities)) {
      errors.push({ field: `${path}.capabilities`, message: "must be an array" });
    } else {
      for (let i = 0; i < raw.capabilities.length; i++) {
        const { capability, errors: capErrors } = mapCapability(
          raw.capabilities[i] as RawCapability,
          `${path}.capabilities[${i}]`,
        );
        capabilities.push(capability);
        errors.push(...capErrors);
      }
    }
  }

  // Quality gates -- support both `qualityGates` and `quality` keys
  const qualityGates: QualityGate[] = [];
  const rawGates = raw.qualityGates ?? raw.quality;
  if (rawGates !== undefined) {
    if (!Array.isArray(rawGates)) {
      errors.push({ field: `${path}.qualityGates`, message: "must be an array" });
    } else {
      for (let i = 0; i < rawGates.length; i++) {
        const { gate, errors: gateErrors } = mapQualityGate(
          rawGates[i] as RawQualityGate,
          `${path}.qualityGates[${i}]`,
        );
        qualityGates.push(gate);
        errors.push(...gateErrors);
      }
    }
  }

  // Mode
  const validModes: TeamMode[] = ["sequential", "supervisor", "swarm"];
  let mode: TeamMode | undefined;
  if (raw.mode !== undefined) {
    if (typeof raw.mode !== "string" || !validModes.includes(raw.mode as TeamMode)) {
      errors.push({ field: `${path}.mode`, message: `must be one of: ${validModes.join(", ")}` });
    } else {
      mode = raw.mode as TeamMode;
    }
  }

  // Manager
  let manager: string | undefined;
  if (raw.manager !== undefined) {
    if (typeof raw.manager !== "string" || raw.manager === "") {
      errors.push({ field: `${path}.manager`, message: "must be a non-empty string" });
    } else {
      manager = raw.manager;
    }
  }

  const team: Team = {
    name,
    agents,
    workflow,
    capabilities,
    qualityGates,
    ...(mode ? { mode } : {}),
    ...(manager ? { manager } : {}),
  };
  return { team, errors };
}

function mapRouter(raw: RawRouter, path: string): { router: Router; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  const rules: PatternRule[] = [];
  if (raw.rules !== undefined) {
    if (!Array.isArray(raw.rules)) {
      errors.push({ field: `${path}.rules`, message: "must be an array" });
    } else {
      for (let i = 0; i < raw.rules.length; i++) {
        const ruleRaw = raw.rules[i] as RawRule;
        if (!ruleRaw.match || typeof ruleRaw.match !== "string") {
          errors.push({ field: `${path}.rules[${i}].match`, message: "must be a non-empty string" });
        }
        if (!ruleRaw.team || typeof ruleRaw.team !== "string") {
          errors.push({ field: `${path}.rules[${i}].team`, message: "must be a non-empty string" });
        }
        rules.push({
          match: typeof ruleRaw.match === "string" ? ruleRaw.match : "",
          team: typeof ruleRaw.team === "string" ? ruleRaw.team : "",
        });
      }
    }
  }

  if (!raw.fallback || typeof raw.fallback !== "string") {
    errors.push({ field: `${path}.fallback`, message: "must be a non-empty string" });
  }

  let classifier: Agent | undefined;
  if (raw.classifier !== undefined) {
    const classifierRaw = raw.classifier as RawAgent;
    const { agent, errors: classifierErrors } = mapAgent(
      "classifier",
      { ...classifierRaw, tier: classifierRaw.tier ?? "fast" },
      `${path}.classifier`,
    );
    classifier = agent;
    errors.push(...classifierErrors);
  }

  const router: Router = {
    rules,
    fallback: typeof raw.fallback === "string" ? raw.fallback : "",
    ...(classifier ? { classifier } : {}),
  };

  return { router, errors };
}

function mapMemory(raw: RawMemory, path: string): { memory: MemoryConfig; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  const scopes: MemoryScope[] = [];
  if (!raw.scopes || !Array.isArray(raw.scopes)) {
    errors.push({ field: `${path}.scopes`, message: "must be a non-empty array" });
  } else {
    for (const s of raw.scopes) {
      if (typeof s === "string") scopes.push(s as MemoryScope);
    }
  }

  if (!raw.backend || typeof raw.backend !== "string") {
    errors.push({ field: `${path}.backend`, message: "must be a non-empty string" });
  }

  const memory: MemoryConfig = {
    scopes,
    backend: typeof raw.backend === "string" ? raw.backend : "",
    ...(typeof raw.sync === "string" ? { sync: raw.sync } : {}),
  };

  return { memory, errors };
}

const VALID_TRIGGER_TYPES: TriggerType[] = ["webhook", "event", "schedule"];

function mapTrigger(raw: RawTrigger, path: string): { trigger: Trigger; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  if (!raw.name || typeof raw.name !== "string") {
    errors.push({ field: `${path}.name`, message: "must be a non-empty string" });
  }

  if (!raw.type || typeof raw.type !== "string" || !VALID_TRIGGER_TYPES.includes(raw.type as TriggerType)) {
    errors.push({ field: `${path}.type`, message: `must be one of: ${VALID_TRIGGER_TYPES.join(", ")}` });
  }

  if (!raw.team || typeof raw.team !== "string") {
    errors.push({ field: `${path}.team`, message: "must be a non-empty string" });
  }

  const base = {
    name: typeof raw.name === "string" ? raw.name : "",
    team: typeof raw.team === "string" ? raw.team : "",
    ...(typeof raw.task === "string" ? { task: raw.task } : {}),
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
  };

  const type = typeof raw.type === "string" ? raw.type : "";

  switch (type) {
    case "webhook": {
      if (!raw.path || typeof raw.path !== "string") {
        errors.push({ field: `${path}.path`, message: "must be a non-empty string" });
      }
      const trigger: Trigger = {
        ...base,
        type: "webhook",
        path: typeof raw.path === "string" ? raw.path : "",
        ...(typeof raw.method === "string" ? { method: raw.method as "POST" | "PUT" } : {}),
        ...(typeof raw.secretEnv === "string" ? { secretEnv: raw.secretEnv } : {}),
      };
      return { trigger, errors };
    }
    case "event": {
      if (!raw.event || typeof raw.event !== "string") {
        errors.push({ field: `${path}.event`, message: "must be a non-empty string" });
      }
      const trigger: Trigger = {
        ...base,
        type: "event",
        event: typeof raw.event === "string" ? raw.event : "",
        ...(raw.filter && typeof raw.filter === "object" && !Array.isArray(raw.filter)
          ? { filter: raw.filter as Record<string, unknown> }
          : {}),
      };
      return { trigger, errors };
    }
    case "schedule": {
      if (!raw.cron || typeof raw.cron !== "string") {
        errors.push({ field: `${path}.cron`, message: "must be a non-empty string" });
      }
      const trigger: Trigger = {
        ...base,
        type: "schedule",
        cron: typeof raw.cron === "string" ? raw.cron : "",
        ...(typeof raw.timezone === "string" ? { timezone: raw.timezone } : {}),
      };
      return { trigger, errors };
    }
    default: {
      // Return a webhook trigger as placeholder to satisfy the type system; the type error was already recorded
      const trigger: Trigger = {
        ...base,
        type: "webhook",
        path: "",
      };
      return { trigger, errors };
    }
  }
}

function mapKnowledge(raw: RawKnowledge): { knowledge: KnowledgeConfig | undefined; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  if (!raw || typeof raw !== "object") {
    return { knowledge: undefined, errors: [] };
  }

  const rawEmbedding = raw.embedding as RawKnowledgeEmbedding | undefined;
  const rawStore = raw.store as RawKnowledgeStore | undefined;
  const rawChunking = raw.chunking as RawKnowledgeChunking | undefined;

  const embedding: KnowledgeEmbeddingConfig = {
    provider: (typeof rawEmbedding?.provider === "string" ? rawEmbedding.provider : "") as KnowledgeEmbeddingConfig["provider"],
    model: typeof rawEmbedding?.model === "string" ? rawEmbedding.model : undefined,
    apiKeyEnv: typeof rawEmbedding?.apiKeyEnv === "string" ? rawEmbedding.apiKeyEnv : undefined,
    baseUrl: typeof rawEmbedding?.baseUrl === "string" ? rawEmbedding.baseUrl : undefined,
  };

  const store: KnowledgeStoreConfig = {
    backend: (typeof rawStore?.backend === "string" ? rawStore.backend : "") as KnowledgeStoreConfig["backend"],
    connectionString: typeof rawStore?.connectionString === "string" ? rawStore.connectionString : undefined,
  };

  const chunking: KnowledgeChunkingConfig = {
    strategy: (typeof rawChunking?.strategy === "string" ? rawChunking.strategy : "") as KnowledgeChunkingConfig["strategy"],
    chunkSize: typeof rawChunking?.chunkSize === "number" ? rawChunking.chunkSize : undefined,
    chunkOverlap: typeof rawChunking?.chunkOverlap === "number" ? rawChunking.chunkOverlap : undefined,
  };

  const sources: KnowledgeSourceConfig[] = [];
  if (Array.isArray(raw.sources)) {
    for (let i = 0; i < raw.sources.length; i++) {
      const source = raw.sources[i] as RawKnowledgeSource | undefined;
      if (!source) continue;
      
      const rawSourceChunking = source.chunking as RawKnowledgeChunking | undefined;
      const sourceChunking: KnowledgeChunkingConfig | undefined = rawSourceChunking ? {
        strategy: (typeof rawSourceChunking.strategy === "string" ? rawSourceChunking.strategy : "") as KnowledgeChunkingConfig["strategy"],
        chunkSize: typeof rawSourceChunking.chunkSize === "number" ? rawSourceChunking.chunkSize : undefined,
        chunkOverlap: typeof rawSourceChunking.chunkOverlap === "number" ? rawSourceChunking.chunkOverlap : undefined,
      } : undefined;

      sources.push({
        name: typeof source.name === "string" ? source.name : "",
        path: typeof source.path === "string" ? source.path : "",
        watch: typeof source.watch === "boolean" ? source.watch : undefined,
        chunking: sourceChunking,
      });
    }
  }

  const allowedAgents: string[] | undefined = Array.isArray(raw.allowedAgents)
    ? raw.allowedAgents.filter((a): a is string => typeof a === "string")
    : undefined;

  const knowledge: KnowledgeConfig = {
    embedding,
    store,
    chunking,
    sources,
    ...(allowedAgents && allowedAgents.length > 0 ? { allowedAgents } : {}),
  };

  const validationErrors = validateKnowledgeConfig(knowledge);
  for (const ve of validationErrors) {
    errors.push(ve);
  }

  return { knowledge: validationErrors.length > 0 ? undefined : knowledge, errors };
}

const VALID_SCORER_TYPES = [
  "exact-match", "contains", "json-validity", "length", "latency", "cost",
  "faithfulness", "relevance", "coherence", "hallucination", "toxicity",
  "custom-prompt", "composite",
] as const;

function mapEvalScorer(raw: RawEvalScorer): { scorer: EvalScorerConfig; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  const subScorers: EvalScorerConfig[] = [];
  if (raw.scorers !== undefined && Array.isArray(raw.scorers)) {
    for (let i = 0; i < raw.scorers.length; i++) {
      const { scorer, errors: subErrors } = mapEvalScorer(raw.scorers[i] as RawEvalScorer);
      subScorers.push(scorer);
      errors.push(...subErrors);
    }
  }

  let scorerType: EvalScorerConfig["type"] = "exact-match";
  if (typeof raw.type === "string" && VALID_SCORER_TYPES.includes(raw.type as typeof VALID_SCORER_TYPES[number])) {
    scorerType = raw.type as EvalScorerConfig["type"];
  } else if (typeof raw.type === "string") {
    errors.push({ field: "type", message: `unknown scorer type "${raw.type}", must be one of: ${VALID_SCORER_TYPES.join(", ")}` });
  }

  const scorer: EvalScorerConfig = {
    name: typeof raw.name === "string" ? raw.name : "",
    type: scorerType,
    ...(subScorers.length > 0 ? { scorers: subScorers } : {}),
    ...(typeof raw.schema === "object" && raw.schema !== null && !Array.isArray(raw.schema) ? { schema: raw.schema as Record<string, unknown> } : {}),
    ...(typeof raw.prompt === "string" ? { prompt: raw.prompt } : {}),
    ...(typeof raw.minLength === "number" ? { minLength: raw.minLength } : {}),
    ...(typeof raw.maxLength === "number" ? { maxLength: raw.maxLength } : {}),
    ...(typeof raw.maxLatencyMs === "number" ? { maxLatencyMs: raw.maxLatencyMs } : {}),
    ...(typeof raw.maxCostUsd === "number" ? { maxCostUsd: raw.maxCostUsd } : {}),
    ...(Array.isArray(raw.substrings) ? { substrings: raw.substrings.filter((s): s is string => typeof s === "string") } : {}),
  };

  return { scorer, errors };
}

function mapEval(raw: RawEval): { eval: EvalConfig | undefined; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  if (!raw || typeof raw !== "object") {
    return { eval: undefined, errors: [] };
  }

  const datasets: EvalDatasetConfig[] = [];
  if (Array.isArray(raw.datasets)) {
    for (const ds of raw.datasets) {
      const rawDs = ds as RawEvalDataset | undefined;
      if (!rawDs) continue;
      datasets.push({
        name: typeof rawDs.name === "string" ? rawDs.name : "",
        path: typeof rawDs.path === "string" ? rawDs.path : "",
      });
    }
  }

  const scorers: EvalScorerConfig[] = [];
  if (Array.isArray(raw.scorers)) {
    for (const s of raw.scorers) {
      const { scorer, errors: scorerErrors } = mapEvalScorer(s as RawEvalScorer);
      scorers.push(scorer);
      errors.push(...scorerErrors);
    }
  }

  const experiments: EvalExperimentConfig[] = [];
  if (Array.isArray(raw.experiments)) {
    for (const exp of raw.experiments) {
      const rawExp = exp as RawEvalExperiment | undefined;
      if (!rawExp) continue;
      const expScorers: string[] = [];
      if (Array.isArray(rawExp.scorers)) {
        for (const s of rawExp.scorers) {
          if (typeof s === "string") expScorers.push(s);
        }
      }
      experiments.push({
        name: typeof rawExp.name === "string" ? rawExp.name : "",
        dataset: typeof rawExp.dataset === "string" ? rawExp.dataset : "",
        team: typeof rawExp.team === "string" ? rawExp.team : "",
        scorers: expScorers,
        ...(typeof rawExp.overrides === "object" && rawExp.overrides !== null && !Array.isArray(rawExp.overrides) ? { overrides: rawExp.overrides as Record<string, unknown> } : {}),
        ...(typeof rawExp.compare === "string" ? { compare: rawExp.compare } : {}),
      });
    }
  }

  const evalConfig: EvalConfig = {
    datasets,
    scorers,
    experiments,
  };

  const validationErrors = validateEvalConfig(evalConfig);
  for (const ve of validationErrors) {
    errors.push({ field: `eval.${ve.field}`, message: ve.message });
  }

  return { eval: validationErrors.length > 0 ? undefined : evalConfig, errors };
}

function mapMcp(raw: RawMcp): { mcp: McpConfig | undefined; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  if (!raw || typeof raw !== "object") {
    return { mcp: undefined, errors: [] };
  }

  const servers: McpServerConfig[] = [];
  if (Array.isArray(raw.servers)) {
    for (let i = 0; i < raw.servers.length; i++) {
      const server = raw.servers[i] as RawMcpServer | undefined;
      if (!server) continue;

      const transport = typeof server.transport === "string" ? server.transport as McpTransport : undefined;
      const args: string[] | undefined = Array.isArray(server.args)
        ? server.args.filter((a): a is string => typeof a === "string")
        : undefined;

      let env: Record<string, string> | undefined;
      if (server.env && typeof server.env === "object" && !Array.isArray(server.env)) {
        const envObj: Record<string, string> = {};
        for (const [key, value] of Object.entries(server.env as Record<string, unknown>)) {
          if (typeof value === "string") {
            envObj[key] = value;
          }
        }
        if (Object.keys(envObj).length > 0) {
          env = envObj;
        }
      }

      servers.push({
        name: typeof server.name === "string" ? server.name : "",
        transport: transport ?? "sse",
        ...(typeof server.url === "string" ? { url: server.url } : {}),
        ...(typeof server.command === "string" ? { command: server.command } : {}),
        ...(args && args.length > 0 ? { args } : {}),
        ...(env && Object.keys(env).length > 0 ? { env } : {}),
        ...(typeof server.reconnect === "boolean" ? { reconnect: server.reconnect } : {}),
      });
    }
  }

  const mcpConfig: McpConfig = { servers };

  const validationErrors = validateMcpConfig(mcpConfig);
  for (const ve of validationErrors) {
    errors.push({ field: `mcp.${ve.field}`, message: ve.message });
  }

  return { mcp: validationErrors.length > 0 ? undefined : mcpConfig, errors };
}

function mapToolSelection(raw: RawToolSelection): { toolSelection: ToolSelectionConfig | undefined; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  if (!raw || typeof raw !== "object") {
    return { toolSelection: undefined, errors: [] };
  }

  const strategy = typeof raw.strategy === "string" ? raw.strategy as ToolSelectionStrategy : undefined;

  const config: ToolSelectionConfig = {
    strategy: strategy ?? "all",
    ...(typeof raw.maxTools === "number" ? { maxTools: raw.maxTools } : {}),
    ...(typeof raw.threshold === "number" ? { threshold: raw.threshold } : {}),
  };

  const validationErrors = validateToolSelectionConfig(config);
  for (const ve of validationErrors) {
    errors.push({ field: `toolSelection.${ve.field}`, message: ve.message });
  }

  return { toolSelection: validationErrors.length > 0 ? undefined : config, errors };
}

function mapVoiceConfig(raw: RawVoice): { voice: VoiceConfig | undefined; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  if (!raw || typeof raw !== "object") {
    return { voice: undefined, errors: [] };
  }

  const rawStt = raw.stt as RawSttProvider | undefined;
  const rawTts = raw.tts as RawTtsProvider | undefined;

  if (!rawStt || typeof rawStt !== "object") {
    errors.push({ field: "voice.stt", message: "must be an object" });
  }
  if (!rawTts || typeof rawTts !== "object") {
    errors.push({ field: "voice.tts", message: "must be an object" });
  }

  if (errors.length > 0) return { voice: undefined, errors };

  const stt: SttProviderConfig = {
    provider: (typeof rawStt!.provider === "string" ? rawStt!.provider : "") as SttProviderConfig["provider"],
    ...(typeof rawStt!.model === "string" ? { model: rawStt!.model } : {}),
    ...(typeof rawStt!.apiKeyEnv === "string" ? { apiKeyEnv: rawStt!.apiKeyEnv } : {}),
    ...(typeof rawStt!.language === "string" ? { language: rawStt!.language } : {}),
  };

  const tts: TtsProviderConfig = {
    provider: (typeof rawTts!.provider === "string" ? rawTts!.provider : "") as TtsProviderConfig["provider"],
    ...(typeof rawTts!.model === "string" ? { model: rawTts!.model } : {}),
    ...(typeof rawTts!.apiKeyEnv === "string" ? { apiKeyEnv: rawTts!.apiKeyEnv } : {}),
    ...(typeof rawTts!.voice === "string" ? { voice: rawTts!.voice } : {}),
  };

  const voice: VoiceConfig = { stt, tts };

  const validationErrors = validateVoiceConfig(voice);
  for (const ve of validationErrors) {
    errors.push(ve);
  }

  return { voice: validationErrors.length > 0 ? undefined : voice, errors };
}

function mapSafety(raw: RawSafetyConfig): { safety: SafetyConfig | undefined; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  if (!raw || typeof raw !== "object") {
    return { safety: undefined, errors: [] };
  }

  let pii: SafetyConfig["pii"];
  if (raw.pii !== undefined) {
    const rawPii = raw.pii as RawPiiConfig;

    const detect: PiiType[] = [];
    if (Array.isArray(rawPii.detect)) {
      for (const d of rawPii.detect) {
        if (typeof d === "string") detect.push(d as PiiType);
      }
    }

    const allowlist: string[] = [];
    if (Array.isArray(rawPii.allowlist)) {
      for (const a of rawPii.allowlist) {
        if (typeof a === "string") allowlist.push(a);
      }
    }

    pii = {
      detect,
      action: (typeof rawPii.action === "string" ? rawPii.action : "detect") as PiiAction,
      ...(typeof rawPii.deepScan === "boolean" ? { deepScan: rawPii.deepScan } : {}),
      ...(allowlist.length > 0 ? { allowlist } : {}),
    };
  }

  let content: SafetyConfig["content"];
  if (raw.content !== undefined) {
    const rawContent = raw.content as RawContentConfig;

    const categories: Record<string, { threshold: number; action: ContentAction }> = {};
    if (rawContent.categories && typeof rawContent.categories === "object" && !Array.isArray(rawContent.categories)) {
      for (const [cat, catConfig] of Object.entries(rawContent.categories as Record<string, RawContentCategoryConfig>)) {
        if (!catConfig) continue;
        categories[cat] = {
          threshold: typeof catConfig.threshold === "number" ? catConfig.threshold : 0.5,
          action: (typeof catConfig.action === "string" ? catConfig.action : "block") as ContentAction,
        };
      }
    }

    content = {
      enabled: typeof rawContent.enabled === "boolean" ? rawContent.enabled : true,
      categories,
      ...(typeof rawContent.deepScan === "boolean" ? { deepScan: rawContent.deepScan } : {}),
    };
  }

  const rails: RailConfig[] = [];
  if (raw.rails !== undefined) {
    if (!Array.isArray(raw.rails)) {
      errors.push({ field: "safety.rails", message: "must be an array" });
    } else {
      for (let i = 0; i < raw.rails.length; i++) {
        const rawRail = raw.rails[i] as RawRailConfig;
        if (!rawRail) continue;

        const railType = typeof rawRail.type === "string" ? rawRail.type : "";

        switch (railType) {
          case "topic": {
            const block: string[] = Array.isArray(rawRail.block) ? rawRail.block.filter((b): b is string => typeof b === "string") : [];
            const escalate: string[] = Array.isArray(rawRail.escalate) ? rawRail.escalate.filter((e): e is string => typeof e === "string") : [];
            rails.push({ type: "topic", ...(block.length > 0 ? { block } : {}), ...(escalate.length > 0 ? { escalate } : {}) });
            break;
          }
          case "competitor": {
            const competitors: string[] = Array.isArray(rawRail.competitors) ? rawRail.competitors.filter((c): c is string => typeof c === "string") : [];
            rails.push({
              type: "competitor",
              competitors,
              response: typeof rawRail.response === "string" ? rawRail.response : "",
            });
            break;
          }
          case "escalation": {
            const triggers: string[] = Array.isArray(rawRail.triggers) ? rawRail.triggers.filter((t): t is string => typeof t === "string") : [];
            rails.push({ type: "escalation", triggers });
            break;
          }
          case "compliance": {
            const required: string[] = Array.isArray(rawRail.required) ? rawRail.required.filter((r): r is string => typeof r === "string") : [];
            const forbid: string[] = Array.isArray(rawRail.forbid) ? rawRail.forbid.filter((f): f is string => typeof f === "string") : [];
            rails.push({
              type: "compliance",
              ...(required.length > 0 ? { required } : {}),
              ...(forbid.length > 0 ? { forbid } : {}),
            });
            break;
          }
          default:
            errors.push({ field: `safety.rails[${i}].type`, message: `unknown rail type "${railType}"` });
        }
      }
    }
  }

  const safety: SafetyConfig = {
    ...(pii ? { pii } : {}),
    ...(content ? { content } : {}),
    ...(rails.length > 0 ? { rails } : {}),
  };

  const validationErrors = validateSafetyConfig(safety);
  for (const ve of validationErrors) {
    errors.push({ field: `safety.${ve.field}`, message: ve.message });
  }

  return { safety: validationErrors.length > 0 ? undefined : safety, errors };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Parse a YAML string into a typed App composite. Throws AppLoaderError if invalid. */
export function parseAppYaml(content: string): App {
  let data: unknown;
  try {
    data = parse(content);
  } catch (err) {
    throw new AppLoaderError([{ field: "yaml", message: String(err) }]);
  }

  const errors: { field: string; message: string }[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new AppLoaderError([{ field: "root", message: "must be a YAML object" }]);
  }

  const raw = data as RawApp;

  // name
  if (!raw.name || typeof raw.name !== "string") {
    errors.push({ field: "name", message: "must be a non-empty string" });
  }

  // channels
  const channels: string[] = [];
  if (raw.channels !== undefined) {
    if (!Array.isArray(raw.channels)) {
      errors.push({ field: "channels", message: "must be an array" });
    } else {
      for (const c of raw.channels) {
        if (typeof c === "string") channels.push(c);
      }
    }
  }

  // memory
  let memory: MemoryConfig = { scopes: [], backend: "" };
  if (!raw.memory || typeof raw.memory !== "object" || Array.isArray(raw.memory)) {
    errors.push({ field: "memory", message: "must be an object" });
  } else {
    const { memory: mem, errors: memErrors } = mapMemory(raw.memory as RawMemory, "memory");
    memory = mem;
    errors.push(...memErrors);
  }

  // teams
  const teams: Record<string, Team> = {};
  if (!raw.teams || typeof raw.teams !== "object" || Array.isArray(raw.teams)) {
    errors.push({ field: "teams", message: "must be an object" });
  } else {
    for (const [teamName, teamRaw] of Object.entries(raw.teams as Record<string, RawTeam>)) {
      const { team, errors: teamErrors } = mapTeam(teamName, teamRaw ?? {}, `teams.${teamName}`);
      teams[teamName] = team;
      errors.push(...teamErrors);
    }
  }

  // router
  let router: Router = { rules: [], fallback: "" };
  if (!raw.router || typeof raw.router !== "object" || Array.isArray(raw.router)) {
    errors.push({ field: "router", message: "must be an object" });
  } else {
    const { router: rt, errors: routerErrors } = mapRouter(raw.router as RawRouter, "router");
    router = rt;
    errors.push(...routerErrors);
  }

  // triggers (optional)
  const triggers: Trigger[] = [];
  if (raw.triggers !== undefined) {
    if (!Array.isArray(raw.triggers)) {
      errors.push({ field: "triggers", message: "must be an array" });
    } else {
      for (let i = 0; i < raw.triggers.length; i++) {
        const { trigger, errors: triggerErrors } = mapTrigger(
          raw.triggers[i] as RawTrigger,
          `triggers[${i}]`,
        );
        triggers.push(trigger);
        errors.push(...triggerErrors);
      }
    }
  }

  // knowledge (optional)
  let knowledge: KnowledgeConfig | undefined;
  if (raw.knowledge !== undefined) {
    const { knowledge: knowledgeConfig, errors: knowledgeErrors } = mapKnowledge(raw.knowledge as RawKnowledge);
    knowledge = knowledgeConfig;
    errors.push(...knowledgeErrors);
  }

  // eval (optional)
  let evalConfig: EvalConfig | undefined;
  if (raw.eval !== undefined) {
    const { eval: parsedEval, errors: evalErrors } = mapEval(raw.eval as RawEval);
    evalConfig = parsedEval;
    errors.push(...evalErrors);
  }

  // mcp (optional)
  let mcpConfig: McpConfig | undefined;
  if (raw.mcp !== undefined) {
    const { mcp, errors: mcpErrors } = mapMcp(raw.mcp as RawMcp);
    mcpConfig = mcp;
    errors.push(...mcpErrors);
  }

  // toolSelection (optional)
  let toolSelectionConfig: ToolSelectionConfig | undefined;
  if (raw.toolSelection !== undefined) {
    const { toolSelection, errors: tsErrors } = mapToolSelection(raw.toolSelection as RawToolSelection);
    toolSelectionConfig = toolSelection;
    errors.push(...tsErrors);
  }

  // voice (optional)
  let voiceConfig: VoiceConfig | undefined;
  if (raw.voice !== undefined) {
    const { voice, errors: voiceErrors } = mapVoiceConfig(raw.voice as RawVoice);
    voiceConfig = voice;
    errors.push(...voiceErrors);
  }

  // safety (optional)
  let safetyConfig: SafetyConfig | undefined;
  if (raw.safety !== undefined) {
    const { safety, errors: safetyErrors } = mapSafety(raw.safety as RawSafetyConfig);
    safetyConfig = safety;
    errors.push(...safetyErrors);
  }

  if (errors.length > 0) throw new AppLoaderError(errors);

  return {
    name: raw.name as string,
    teams,
    router,
    memory,
    channels,
    ...(triggers.length > 0 ? { triggers } : {}),
    ...(knowledge ? { knowledge } : {}),
    ...(evalConfig ? { eval: evalConfig } : {}),
    ...(mcpConfig ? { mcp: mcpConfig } : {}),
    ...(toolSelectionConfig ? { toolSelection: toolSelectionConfig } : {}),
    ...(voiceConfig ? { voice: voiceConfig } : {}),
    ...(safetyConfig ? { safety: safetyConfig } : {}),
  };
}

/** Validate the dependency graph of an App. Returns null if valid, AppLoaderError if not. */
export function validateAppGraph(app: App): AppLoaderError | null {
  const appErrors = validateApp(app);
  if (appErrors.length === 0) return null;
  return new AppLoaderError(appErrors);
}
