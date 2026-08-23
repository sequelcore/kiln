// Engine loader: AppLoader -- parses App YAML into typed composites
// Validates dependency graph: the fallback router team must exist in teams

import { parse } from "yaml";
import { KilnError } from "../errors.js";
import type { App } from "../composites/app.js";
import { validateApp } from "../composites/app.js";
import type { Team, TeamMode } from "../composites/team.js";
import type { Router } from "../composites/router.js";
import type { Agent, AgentTier } from "../domain/agent.js";
import { normalizeActionEffectEnvelope } from "../domain/action-effect.js";
import type {
  VoiceConfig,
  SttProviderConfig,
  TtsProviderConfig,
  VoicePolicyConfig,
  VoiceSurfacePolicy,
  VoiceInputPolicy,
  VoiceOutputPolicy,
  VoiceTtsProfileConfig,
  VoiceTtsIntentConfig,
  VoiceTtsIntentId,
} from "../domain/speech-config.js";
import { validateVoiceConfig } from "../domain/speech-config.js";
import type { Capability } from "../domain/capability.js";
import type { RetryConfig, RetryStrategy } from "../domain/tool-execution.js";
import type { Trigger, TriggerType } from "../domain/trigger.js";
import type { McpConfig } from "../domain/mcp-config.js";
import { validateMcpConfig } from "../domain/mcp-config.js";
import type { SafetyConfig, PiiType, PiiAction, ContentAction, RailConfig } from "../domain/safety-config.js";
import { validateSafetyConfig } from "../domain/safety-config.js";
import {
  describeRunningAppConfigSchema,
  parseAppConfigStructure,
  type AppConfigDocument,
  type RawAgent,
  type RawCapability,
  type RawContentCategoryConfig,
  type RawContentConfig,
  type RawMcp,
  type RawPiiConfig,
  type RawRailConfig,
  type RawRouter,
  type RawSafetyConfig,
  type RawSttProvider,
  type RawTeam,
  type RawTrigger,
  type RawTtsIntent,
  type RawTtsProfile,
  type RawTtsProvider,
  type RawVoice,
  type RawVoiceArtifacts,
  type RawVoiceDefaults,
  type RawVoiceInputPolicy,
  type RawVoiceOutputPolicy,
  type RawVoicePolicy,
  type RawVoiceSurfacePolicy,
} from "./app-config-schema.js";
import { mapRuntimeModeConfig } from "../gateway/runtime-mode-config.js";

/** Error class for YAML loader failures, aggregating all validation errors */
export class AppLoaderError extends KilnError {
  readonly errors: readonly { field: string; message: string }[];
  readonly sourcePath: string;

  constructor(
    errors: readonly { field: string; message: string }[],
    sourcePath = "app.yaml",
    options?: { readonly includeBuildIdentity?: boolean },
  ) {
    const msg = errors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
    const buildIdentity = options?.includeBuildIdentity === true
      ? `\nValidated by ${describeRunningAppConfigSchema()}; if this field exists at HEAD, the running build predates it.`
      : "";
    super("APP_YAML_INVALID", `Invalid app YAML from ${sourcePath}:\n${msg}${buildIdentity}`, {
      context: { errors, sourcePath },
      retryable: false,
    });
    this.name = "AppLoaderError";
    this.errors = errors;
    this.sourcePath = sourcePath;
  }
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

  if (raw.voiceProfile !== undefined && (typeof raw.voiceProfile !== "string" || raw.voiceProfile.trim() === "")) {
    errors.push({ field: `${path}.voiceProfile`, message: "must be a non-empty string" });
  }

  const agent: Agent = {
    name,
    role,
    goal,
    tier: (tier as AgentTier) ?? "coding",
    tools,
    ...(typeof raw.backstory === "string" ? { backstory: raw.backstory.trim() } : {}),
    ...(typeof raw.instructions === "string" ? { instructions: raw.instructions.trim() } : {}),
    ...(typeof raw.voiceProfile === "string" && raw.voiceProfile.trim() !== "" ? { voiceProfile: raw.voiceProfile.trim() } : {}),
  };

  return { agent, errors };
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

  const effectEnvelope = raw.effectEnvelope === undefined
    ? undefined
    : normalizeActionEffectEnvelope(raw.effectEnvelope);
  if (raw.effectEnvelope !== undefined && !effectEnvelope) {
    errors.push({ field: `${path}.effectEnvelope`, message: "must be a valid action effect envelope" });
  }

  // Validate retry config
  let retryConfig: RetryConfig | undefined;
  if (raw.retry !== undefined) {
    if (typeof raw.retry !== "object" || raw.retry === null || Array.isArray(raw.retry)) {
      errors.push({ field: `${path}.retry`, message: "must be an object" });
    } else {
      const r = raw.retry as Record<string, unknown>;
      const validStrategies: RetryStrategy[] = ["exponential", "mutate_params"];

      if (r.onValidationError !== undefined && (typeof r.onValidationError !== "string" || !validStrategies.includes(r.onValidationError as RetryStrategy))) {
        errors.push({ field: `${path}.retry.onValidationError`, message: 'must be "exponential" or "mutate_params"' });
      }
      if (r.onTransientError !== undefined && (typeof r.onTransientError !== "string" || !validStrategies.includes(r.onTransientError as RetryStrategy))) {
        errors.push({ field: `${path}.retry.onTransientError`, message: 'must be "exponential" or "mutate_params"' });
      }
      if (r.maxAttempts !== undefined && (typeof r.maxAttempts !== "number" || !Number.isInteger(r.maxAttempts) || r.maxAttempts < 1)) {
        errors.push({ field: `${path}.retry.maxAttempts`, message: "must be a positive integer" });
      }
      if (r.timeout !== undefined && (typeof r.timeout !== "number" || r.timeout <= 0)) {
        errors.push({ field: `${path}.retry.timeout`, message: "must be a positive number (seconds)" });
      }
      if (r.fallback !== undefined && typeof r.fallback !== "string") {
        errors.push({ field: `${path}.retry.fallback`, message: "must be a string (capability name)" });
      }

      retryConfig = {
        ...(typeof r.onValidationError === "string" ? { onValidationError: r.onValidationError as RetryStrategy } : {}),
        ...(typeof r.onTransientError === "string" ? { onTransientError: r.onTransientError as RetryStrategy } : {}),
        ...(typeof r.maxAttempts === "number" && Number.isInteger(r.maxAttempts) && r.maxAttempts >= 1 ? { maxAttempts: r.maxAttempts } : {}),
        ...(typeof r.timeout === "number" && r.timeout > 0 ? { timeout: r.timeout } : {}),
        ...(typeof r.fallback === "string" ? { fallback: r.fallback } : {}),
      };
    }
  }

  const capability: Capability = {
    name: typeof raw.name === "string" ? raw.name : "",
    description: typeof raw.description === "string" ? raw.description : "",
    schema: typeof raw.schema === "object" && raw.schema !== null && !Array.isArray(raw.schema)
      ? (raw.schema as Record<string, unknown>)
      : {},
    tags,
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
    ...(effectEnvelope ? { effectEnvelope } : {}),
    ...(retryConfig ? { retry: retryConfig } : {}),
  };

  if (raw.type === "delegation") {
    if (typeof raw.targetApp !== "string" || raw.targetApp === "") {
      errors.push({ field: `${path}.targetApp`, message: "required when type is 'delegation'" });
    }
    if (typeof raw.task !== "string" || raw.task === "") {
      errors.push({ field: `${path}.task`, message: "required when type is 'delegation'" });
    }
  }

  return { capability, errors };
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

  // Validate retry fallback references
  const capNames = new Set(capabilities.map((c) => c.name));
  for (const cap of capabilities) {
    if (cap.retry?.fallback && !capNames.has(cap.retry.fallback)) {
      errors.push({ field: `${path}.capabilities.${cap.name}.retry.fallback`, message: `references unknown capability "${cap.retry.fallback}"` });
    }
  }

  // Mode
  const validModes: TeamMode[] = ["sequential", "supervisor"];
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
    capabilities,
    ...(mode ? { mode } : {}),
    ...(manager ? { manager } : {}),
  };
  return { team, errors };
}

function mapRouter(raw: RawRouter, path: string): { router: Router; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  if (!raw.fallback || typeof raw.fallback !== "string") {
    errors.push({ field: `${path}.fallback`, message: "must be a non-empty string" });
  }

  const router: Router = {
    fallback: typeof raw.fallback === "string" ? raw.fallback : "",
  };

  return { router, errors };
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

function mapMcp(raw: RawMcp): { mcp: McpConfig | undefined; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  if (!raw || typeof raw !== "object") {
    return { mcp: undefined, errors: [] };
  }

  const servers: string[] = [];
  if (Array.isArray(raw.servers)) {
    for (let i = 0; i < raw.servers.length; i++) {
      servers.push(typeof raw.servers[i] === "string" ? raw.servers[i] as string : "");
    }
  }

  const mcpConfig: McpConfig = { servers };

  const validationErrors = validateMcpConfig(mcpConfig);
  for (const ve of validationErrors) {
    errors.push({ field: `mcp.${ve.field}`, message: ve.message });
  }

  return { mcp: validationErrors.length > 0 ? undefined : mcpConfig, errors };
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

  const sttArgs = mapOptionalStringArray(rawStt!.args, "voice.stt.args", errors);
  const ttsArgs = mapOptionalStringArray(rawTts!.args, "voice.tts.args", errors);

  const stt: SttProviderConfig = {
    provider: (typeof rawStt!.provider === "string" ? rawStt!.provider : "") as SttProviderConfig["provider"],
    ...(typeof rawStt!.model === "string" ? { model: rawStt!.model } : {}),
    ...(typeof rawStt!.apiKeyEnv === "string" ? { apiKeyEnv: rawStt!.apiKeyEnv } : {}),
    ...(typeof rawStt!.language === "string" ? { language: rawStt!.language } : {}),
    ...(typeof rawStt!.command === "string" ? { command: rawStt!.command } : {}),
    ...(typeof rawStt!.commandEnv === "string" ? { commandEnv: rawStt!.commandEnv } : {}),
    ...(sttArgs ? { args: sttArgs } : {}),
    ...(typeof rawStt!.modelPath === "string" ? { modelPath: rawStt!.modelPath } : {}),
    ...(typeof rawStt!.modelPathEnv === "string" ? { modelPathEnv: rawStt!.modelPathEnv } : {}),
    ...(typeof rawStt!.device === "string" ? { device: rawStt!.device } : {}),
    ...(typeof rawStt!.timeoutMs === "number" ? { timeoutMs: rawStt!.timeoutMs } : {}),
  };

  const tts: TtsProviderConfig = {
    provider: (typeof rawTts!.provider === "string" ? rawTts!.provider : "") as TtsProviderConfig["provider"],
    ...(typeof rawTts!.model === "string" ? { model: rawTts!.model } : {}),
    ...(typeof rawTts!.apiKeyEnv === "string" ? { apiKeyEnv: rawTts!.apiKeyEnv } : {}),
    ...(typeof rawTts!.voice === "string" ? { voice: rawTts!.voice } : {}),
    ...(typeof rawTts!.command === "string" ? { command: rawTts!.command } : {}),
    ...(typeof rawTts!.commandEnv === "string" ? { commandEnv: rawTts!.commandEnv } : {}),
    ...(ttsArgs ? { args: ttsArgs } : {}),
    ...(typeof rawTts!.modelPath === "string" ? { modelPath: rawTts!.modelPath } : {}),
    ...(typeof rawTts!.modelPathEnv === "string" ? { modelPathEnv: rawTts!.modelPathEnv } : {}),
    ...(typeof rawTts!.device === "string" ? { device: rawTts!.device } : {}),
    ...(typeof rawTts!.timeoutMs === "number" ? { timeoutMs: rawTts!.timeoutMs } : {}),
    ...(typeof rawTts!.format === "string" ? { format: rawTts!.format } : {}),
  };

  const { policy, errors: policyErrors } = mapVoicePolicy(raw.policy);
  errors.push(...policyErrors);

  const { defaults, errors: defaultsErrors } = mapVoiceDefaults(raw.defaults);
  errors.push(...defaultsErrors);

  const { ttsProfiles, errors: ttsProfileErrors } = mapVoiceTtsProfiles(raw.ttsProfiles);
  errors.push(...ttsProfileErrors);

  const voice: VoiceConfig = {
    stt,
    tts,
    ...(defaults ? { defaults } : {}),
    ...(ttsProfiles ? { ttsProfiles } : {}),
    ...(policy ? { policy } : {}),
  };

  const validationErrors = validateVoiceConfig(voice);
  for (const ve of validationErrors) {
    errors.push(ve);
  }

  return { voice: errors.length > 0 ? undefined : voice, errors };
}

function mapVoiceDefaults(raw: unknown): {
  defaults: VoiceConfig["defaults"] | undefined;
  errors: { field: string; message: string }[];
} {
  const errors: { field: string; message: string }[] = [];
  if (raw === undefined) {
    return { defaults: undefined, errors };
  }
  if (!isRecord(raw)) {
    return { defaults: undefined, errors: [{ field: "voice.defaults", message: "must be an object" }] };
  }

  const rawDefaults = raw as RawVoiceDefaults;
  if (rawDefaults.ttsProfile !== undefined && typeof rawDefaults.ttsProfile !== "string") {
    errors.push({ field: "voice.defaults.ttsProfile", message: "must be a non-empty string" });
  }
  const defaults: VoiceConfig["defaults"] = {
    ...(typeof rawDefaults.ttsProfile === "string" ? { ttsProfile: rawDefaults.ttsProfile.trim() } : {}),
  };

  return { defaults, errors };
}

function mapVoiceTtsProfiles(raw: unknown): {
  ttsProfiles: Readonly<Record<string, VoiceTtsProfileConfig>> | undefined;
  errors: { field: string; message: string }[];
} {
  const errors: { field: string; message: string }[] = [];
  if (raw === undefined) {
    return { ttsProfiles: undefined, errors };
  }
  if (!isRecord(raw)) {
    return { ttsProfiles: undefined, errors: [{ field: "voice.ttsProfiles", message: "must be an object" }] };
  }

  const profiles: Record<string, VoiceTtsProfileConfig> = {};
  for (const [profileName, profileRaw] of Object.entries(raw)) {
    if (!isRecord(profileRaw)) {
      errors.push({ field: `voice.ttsProfiles.${profileName}`, message: "must be an object" });
      continue;
    }
    profiles[profileName] = mapVoiceTtsProfile(profileRaw as RawTtsProfile, `voice.ttsProfiles.${profileName}`, errors);
  }

  return { ttsProfiles: profiles, errors };
}

function mapVoiceTtsProfile(
  raw: RawTtsProfile,
  path: string,
  errors: { field: string; message: string }[],
): VoiceTtsProfileConfig {
  const speedRange = mapOptionalNumberTuple(raw.speedRange, `${path}.speedRange`, errors);
  const intents = mapVoiceTtsIntents(raw.intents, `${path}.intents`, errors);

  return {
    style: typeof raw.style === "string" ? raw.style.trim() : "",
    ...(typeof raw.voice === "string" ? { voice: raw.voice.trim() } : {}),
    ...(typeof raw.language === "string" ? { language: raw.language.trim() } : {}),
    ...(typeof raw.speed === "number" ? { speed: raw.speed } : {}),
    ...(speedRange ? { speedRange } : {}),
    ...(typeof raw.format === "string" ? { format: raw.format.trim() } : {}),
    ...(intents ? { intents } : {}),
  };
}

function mapVoiceTtsIntents(
  raw: unknown,
  path: string,
  errors: { field: string; message: string }[],
): VoiceTtsProfileConfig["intents"] | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    errors.push({ field: path, message: "must be an object" });
    return undefined;
  }

  const intents: Partial<Record<VoiceTtsIntentId, VoiceTtsIntentConfig>> = {};
  for (const [intentName, intentRaw] of Object.entries(raw)) {
    if (!isRecord(intentRaw)) {
      errors.push({ field: `${path}.${intentName}`, message: "must be an object" });
      continue;
    }
    const intent = intentRaw as RawTtsIntent;
    const appliesWhen = mapOptionalStringArray(intent.appliesWhen, `${path}.${intentName}.appliesWhen`, errors);
    intents[intentName as VoiceTtsIntentId] = {
      delivery: typeof intent.delivery === "string" ? intent.delivery.trim() : "",
      appliesWhen: appliesWhen ?? [],
      ...(typeof intent.voice === "string" ? { voice: intent.voice.trim() } : {}),
      ...(typeof intent.language === "string" ? { language: intent.language.trim() } : {}),
      ...(typeof intent.speed === "number" ? { speed: intent.speed } : {}),
      ...(typeof intent.format === "string" ? { format: intent.format.trim() } : {}),
    };
  }

  return intents;
}

function mapVoicePolicy(raw: unknown): { policy: VoicePolicyConfig | undefined; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];

  if (raw === undefined) {
    return { policy: undefined, errors };
  }

  if (!isRecord(raw)) {
    return { policy: undefined, errors: [{ field: "voice.policy", message: "must be an object" }] };
  }

  const rawPolicy = raw as RawVoicePolicy;
  let artifacts: VoicePolicyConfig["artifacts"];
  if (rawPolicy.artifacts !== undefined) {
    if (!isRecord(rawPolicy.artifacts)) {
      errors.push({ field: "voice.policy.artifacts", message: "must be an object" });
    } else {
      const rawArtifacts = rawPolicy.artifacts as RawVoiceArtifacts;
      artifacts = {
        ...(typeof rawArtifacts.storeSourceAudio === "boolean" ? { storeSourceAudio: rawArtifacts.storeSourceAudio } : {}),
        ...(typeof rawArtifacts.storeTranscripts === "boolean" ? { storeTranscripts: rawArtifacts.storeTranscripts } : {}),
        ...(typeof rawArtifacts.storeSynthesizedAudio === "boolean" ? { storeSynthesizedAudio: rawArtifacts.storeSynthesizedAudio } : {}),
        ...(typeof rawArtifacts.retentionMaxArtifacts === "number" ? { retentionMaxArtifacts: rawArtifacts.retentionMaxArtifacts } : {}),
      };
    }
  }

  let surfaces: VoicePolicyConfig["surfaces"];
  if (rawPolicy.surfaces !== undefined) {
    if (!isRecord(rawPolicy.surfaces)) {
      errors.push({ field: "voice.policy.surfaces", message: "must be an object" });
    } else {
      const mappedSurfaces: Record<string, VoiceSurfacePolicy> = {};
      for (const [surfaceName, surfaceRaw] of Object.entries(rawPolicy.surfaces)) {
        if (!isRecord(surfaceRaw)) {
          errors.push({ field: `voice.policy.surfaces.${surfaceName}`, message: "must be an object" });
          continue;
        }
        mappedSurfaces[surfaceName] = mapVoiceSurfacePolicy(surfaceRaw as RawVoiceSurfacePolicy);
      }
      surfaces = mappedSurfaces as VoicePolicyConfig["surfaces"];
    }
  }

  const policy: VoicePolicyConfig = {
    ...(typeof rawPolicy.defaultInputFailureMode === "string"
      ? { defaultInputFailureMode: rawPolicy.defaultInputFailureMode as VoicePolicyConfig["defaultInputFailureMode"] }
      : {}),
    ...(typeof rawPolicy.defaultOutputFailureMode === "string"
      ? { defaultOutputFailureMode: rawPolicy.defaultOutputFailureMode as VoicePolicyConfig["defaultOutputFailureMode"] }
      : {}),
    ...(artifacts ? { artifacts } : {}),
    ...(surfaces ? { surfaces } : {}),
  };

  return { policy, errors };
}

function mapVoiceSurfacePolicy(raw: RawVoiceSurfacePolicy): VoiceSurfacePolicy {
  return {
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
    ...(isRecord(raw.input) ? { input: mapVoiceInputPolicy(raw.input as RawVoiceInputPolicy) } : {}),
    ...(isRecord(raw.output) ? { output: mapVoiceOutputPolicy(raw.output as RawVoiceOutputPolicy) } : {}),
  };
}

function mapVoiceInputPolicy(raw: RawVoiceInputPolicy): VoiceInputPolicy {
  return {
    ...(Array.isArray(raw.modes) ? { modes: raw.modes as VoiceInputPolicy["modes"] } : {}),
    ...(typeof raw.failureMode === "string" ? { failureMode: raw.failureMode as VoiceInputPolicy["failureMode"] } : {}),
  };
}

function mapVoiceOutputPolicy(raw: RawVoiceOutputPolicy): VoiceOutputPolicy {
  return {
    ...(Array.isArray(raw.modes) ? { modes: raw.modes as VoiceOutputPolicy["modes"] } : {}),
    ...(typeof raw.failureMode === "string" ? { failureMode: raw.failureMode as VoiceOutputPolicy["failureMode"] } : {}),
  };
}

function mapOptionalNumberTuple(
  value: unknown,
  field: string,
  errors: { field: string; message: string }[],
): readonly [number, number] | undefined {
  if (value === undefined) return undefined;

  if (!Array.isArray(value) || value.length !== 2) {
    errors.push({ field, message: "must be a two-number array" });
    return undefined;
  }

  const [min, max] = value;
  if (typeof min !== "number" || typeof max !== "number") {
    errors.push({ field, message: "must be a two-number array" });
    return undefined;
  }

  return [min, max];
}

function mapOptionalStringArray(
  value: unknown,
  field: string,
  errors: { field: string; message: string }[],
): readonly string[] | undefined {
  if (value === undefined) return undefined;

  if (!Array.isArray(value)) {
    errors.push({ field, message: "must be an array" });
    return undefined;
  }

  const entries: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (typeof entry !== "string") {
      errors.push({ field: `${field}[${i}]`, message: "must be a string" });
      continue;
    }
    entries.push(entry);
  }

  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
export function parseAppYaml(content: string, sourcePath = "app.yaml"): App {
  let data: unknown;
  try {
    data = parse(content);
  } catch (err) {
    throw new AppLoaderError([{ field: "yaml", message: String(err) }], sourcePath);
  }

  const errors: { field: string; message: string }[] = [];

  const structural = parseAppConfigStructure(data);
  if (!structural.ok) {
    throw new AppLoaderError(
      structural.errors.map(({ field, message }) => ({ field, message })),
      sourcePath,
      { includeBuildIdentity: structural.errors.some((error) => error.unknownField) },
    );
  }

  const raw: AppConfigDocument = structural.value;

  // name
  if (!raw.name || typeof raw.name !== "string") {
    errors.push({ field: "name", message: "must be a non-empty string" });
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
  let router: Router = { fallback: "" };
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

  // mcp (optional)
  let mcpConfig: McpConfig | undefined;
  if (raw.mcp !== undefined) {
    const { mcp, errors: mcpErrors } = mapMcp(raw.mcp as RawMcp);
    mcpConfig = mcp;
    errors.push(...mcpErrors);
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

  const runtimeMode = mapRuntimeModeConfig(raw);
  errors.push(...runtimeMode.errors);

  if (errors.length > 0) throw new AppLoaderError(errors, sourcePath);

  return {
    name: raw.name as string,
    teams,
    router,
    ...(triggers.length > 0 ? { triggers } : {}),
    ...(mcpConfig ? { mcp: mcpConfig } : {}),
    ...(voiceConfig ? { voice: voiceConfig } : {}),
    ...(safetyConfig ? { safety: safetyConfig } : {}),
    ...(runtimeMode.config ? { runtimeModeConfig: runtimeMode.config } : {}),
  };
}

/** Validate the dependency graph of an App. Returns null if valid, AppLoaderError if not. */
export function validateAppGraph(app: App): AppLoaderError | null {
  const appErrors = validateApp(app);
  if (appErrors.length === 0) return null;
  return new AppLoaderError(appErrors);
}
