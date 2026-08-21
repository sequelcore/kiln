import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  assertPolicyAdaptationPromotionEvidence,
  hashPolicyAdaptationConfiguration,
  parseSkillMd,
  type PolicyAdaptationCandidate,
  type PolicyAdaptationEvaluationReport,
} from "@kilnai/core";
import type {
  KilnConfigActivationClass,
  KilnConfigAuthorityImpact,
  KilnConfigMutationOperation,
  KilnConfigMutationScope,
  KilnConfigReconciliationTarget,
  KilnConfigValidationDiagnostic,
} from "@kilnai/gateway-contracts";
import { parse, parseDocument, stringify, type Document } from "yaml";
import { defaultGlobalConfig } from "../config/global-config.js";
import { defaultKilnYaml } from "../kiln-yaml.js";
import { isAlias, isCollection } from "yaml";
import {
  configSettingDescriptor,
  configSettingGovernance,
  configSettingKeys,
  parseConfigSettingValue,
} from "./config-setting-descriptors.js";
import { parseProjectConfigStructure } from "../config/project-config-schema.js";
import type { KilnContextGovernanceConfig, ResolvedKilnConfig } from "../kiln-yaml-types.js";
import { parseAgentDefinitionContent, type KilnAgentDefinition } from "./agent-loader.js";

/** Where an operation reads current state from and writes its canonical result to. */
export interface ConfigMutationContext {
  readonly projectPath: string;
  readonly globalConfigPath: string;
}

/**
 * One operation's admitted result. Handlers own structural validation, canonical
 * content, and the authority/activation facts the lifecycle needs; they never
 * write files, mint identity, or decide approval.
 */
export interface NormalizedConfigMutation {
  readonly scope: KilnConfigMutationScope;
  readonly payload: Record<string, unknown>;
  readonly path: string;
  readonly nextContent: string;
  readonly diagnostics: readonly KilnConfigValidationDiagnostic[];
  /** Authority delta between current and proposed state, not the proposed state alone. */
  readonly authorityImpact: KilnConfigAuthorityImpact;
  readonly affectedOwners: readonly string[];
  readonly reconciliationTargets: readonly KilnConfigReconciliationTarget[];
  readonly activation: KilnConfigActivationClass;
}

const SUPPORTED_AGENT_PROFILE_TOOLS = new Set([
  "read",
  "grep",
  "glob",
  "web",
  "write",
  "bash",
]);

/** Agent profile tools that grant authority beyond reading the workspace. */
const WRITE_AUTHORITY_TOOLS = new Set(["write", "bash"]);
const READ_AUTHORITY_TOOLS = new Set(["web"]);

export function normalizeConfigMutation(
  operation: KilnConfigMutationOperation,
  context: ConfigMutationContext,
  payload: unknown,
): NormalizedConfigMutation {
  switch (operation) {
    case "skill.upsert":
      return normalizeSkillUpsert(context.projectPath, payload);
    case "agent.upsert":
      return normalizeAgentUpsert(context.projectPath, payload);
    case "agent.attach_skills":
      return normalizeAgentAttachSkills(context.projectPath, payload);
    case "context_governance.adapt":
      return normalizeContextGovernanceAdaptation(context.projectPath, payload);
    case "setting.set":
      return normalizeSettingSet(context, payload);
    case "setting.reset":
      return normalizeSettingReset(context, payload);
    case "mutation.rollback":
      throw new Error("mutation.rollback is resolved by the mutation authority, not an operation handler.");
  }
}

/**
 * Compares two agent tool sets and reports only what the change adds. Removing
 * authority, or restating existing authority, is not an expansion.
 */
export function agentToolAuthorityImpact(
  currentTools: readonly string[],
  nextTools: readonly string[],
): KilnConfigAuthorityImpact {
  const current = new Set(currentTools);
  const added = nextTools.filter((tool) => !current.has(tool));
  if (added.some((tool) => WRITE_AUTHORITY_TOOLS.has(tool))) {
    return "expands-write";
  }
  if (added.some((tool) => READ_AUTHORITY_TOOLS.has(tool))) {
    return "expands-read";
  }
  return "none";
}

function normalizeContextGovernanceAdaptation(projectPath: string, rawPayload: unknown): NormalizedConfigMutation {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  const path = join(projectPath, ".kiln", "kiln.yaml");
  const existingContent = existsSync(path) ? readFileSync(path, "utf-8") : "version: '1'\n";
  const parsed = parse(existingContent) as ResolvedKilnConfig | null;
  const config: ResolvedKilnConfig = parsed && typeof parsed === "object" ? parsed : { version: "1" };
  const current = config.contextGovernance ?? {};
  const currentAdaptation = current.adaptation;
  const expectedRevision = payload.expectedRevision;
  const currentRevision = currentAdaptation?.revision ?? 0;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== currentRevision) {
    diagnostics.push({ severity: "error", field: "expectedRevision", message: `Expected current adaptation revision ${currentRevision}.` });
  }
  const action = payload.action;
  let next: KilnContextGovernanceConfig = current;
  try {
    if (action === "promote") {
      const candidate = payload.candidate as PolicyAdaptationCandidate;
      const evaluation = payload.evaluation as PolicyAdaptationEvaluationReport;
      assertPolicyAdaptationPromotionEvidence(candidate, evaluation);
      if (currentAdaptation?.frozen) throw new Error("Context adaptation is frozen.");
      const currentMode = current.allocationMode ?? "whole-block";
      const currentConfigurationHash = hashPolicyAdaptationConfiguration({ contextAllocationMode: currentMode });
      const currentPolicyId = currentAdaptation?.activePolicyId ?? candidate.basePolicyId;
      if (currentAdaptation && currentAdaptation.activeConfigurationHash !== currentConfigurationHash) {
        throw new Error("Active context policy configuration hash has drifted from canonical config.");
      }
      if (candidate.basePolicyId !== currentPolicyId || candidate.baseConfigurationHash !== currentConfigurationHash) {
        throw new Error("Candidate base does not match the active context policy selection.");
      }
      next = {
        ...current,
        allocationMode: candidate.candidateConfiguration.contextAllocationMode,
        adaptation: {
          version: "policy-adaptation-selection-v1",
          revision: currentRevision + 1,
          activePolicyId: candidate.candidatePolicyId,
          activeConfigurationHash: candidate.candidateConfigurationHash,
          frozen: false,
          rollback: {
            policyId: currentPolicyId,
            configurationHash: currentConfigurationHash,
            allocationMode: currentMode,
          },
          candidateRecordHash: candidate.candidateRecordHash,
          evaluationEvidenceHash: evaluation.evidenceHash,
        },
      };
    } else if (action === "freeze") {
      const reason = requireText(payload.reason, "reason", diagnostics);
      next = {
        ...current,
        adaptation: {
          version: "policy-adaptation-selection-v1",
          revision: currentRevision + 1,
          activePolicyId: currentAdaptation?.activePolicyId ?? `context-${current.allocationMode ?? "whole-block"}-static-v1`,
          activeConfigurationHash: currentAdaptation?.activeConfigurationHash
            ?? hashPolicyAdaptationConfiguration({ contextAllocationMode: current.allocationMode ?? "whole-block" }),
          frozen: true,
          freezeReason: reason,
          ...(currentAdaptation?.rollback ? { rollback: currentAdaptation.rollback } : {}),
          ...(currentAdaptation?.candidateRecordHash ? { candidateRecordHash: currentAdaptation.candidateRecordHash } : {}),
          ...(currentAdaptation?.evaluationEvidenceHash ? { evaluationEvidenceHash: currentAdaptation.evaluationEvidenceHash } : {}),
        },
      };
    } else if (action === "unfreeze") {
      if (!currentAdaptation?.frozen) throw new Error("Context adaptation is not frozen.");
      next = { ...current, adaptation: { ...currentAdaptation, revision: currentRevision + 1, frozen: false, freezeReason: undefined } };
    } else if (action === "rollback") {
      if (!currentAdaptation?.rollback) throw new Error("Context adaptation has no exact rollback selection.");
      next = {
        ...current,
        allocationMode: currentAdaptation.rollback.allocationMode,
        adaptation: {
          version: "policy-adaptation-selection-v1",
          revision: currentRevision + 1,
          activePolicyId: currentAdaptation.rollback.policyId,
          activeConfigurationHash: currentAdaptation.rollback.configurationHash,
          frozen: currentAdaptation.frozen,
          ...(currentAdaptation.freezeReason ? { freezeReason: currentAdaptation.freezeReason } : {}),
        },
      };
    } else {
      diagnostics.push({ severity: "error", field: "action", message: "Must be promote, rollback, freeze, or unfreeze." });
    }
  } catch (error) {
    diagnostics.push({ severity: "error", field: "adaptation", message: error instanceof Error ? error.message : String(error) });
  }
  const nextContent = stringify({ ...config, version: config.version ?? "1", contextGovernance: next });
  return {
    scope: "project",
    payload,
    path,
    nextContent,
    diagnostics,
    authorityImpact: "none",
    affectedOwners: ["context-governance"],
    reconciliationTargets: ["repo-shims"],
    activation: "next-session",
  };
}

function normalizeSkillUpsert(projectPath: string, rawPayload: unknown): NormalizedConfigMutation {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  const name = requireId(payload.name, "name", diagnostics);
  const description = requireText(payload.description, "description", diagnostics);
  const instructions = requireText(payload.instructions, "instructions", diagnostics);
  const tools = optionalStringList(payload.tools, "tools", diagnostics);
  const tags = optionalStringList(payload.tags, "tags", diagnostics);
  const path = join(projectPath, ".kiln", "skills", name || "invalid-skill", "SKILL.md");
  const normalized = {
    name,
    description,
    tools,
    tags,
    instructions,
  };
  const nextContent = renderSkillMarkdown(normalized);

  try {
    parseSkillMd(nextContent, path);
  } catch (error) {
    diagnostics.push({ severity: "error", field: "skill", message: errorMessage(error) });
  }

  return {
    scope: "project",
    payload: normalized,
    path,
    nextContent,
    diagnostics,
    authorityImpact: "none",
    affectedOwners: ["project-skill-catalog"],
    reconciliationTargets: ["native-skills", "repo-shims"],
    activation: "reconcile",
  };
}

/**
 * Sets one admitted configuration key in the requested scope.
 *
 * The key's descriptor supplies scope eligibility, value admission, activation,
 * owners, and whether the change can affect authority. Content is produced by
 * editing the YAML document tree so operator comments and ordering survive.
 */
function normalizeSettingSet(
  context: ConfigMutationContext,
  rawPayload: unknown,
): NormalizedConfigMutation {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  const scope = admitScope(payload.scope, diagnostics);
  const key = requireText(payload.key, "key", diagnostics);
  const descriptor = key ? configSettingDescriptor(key) : undefined;
  if (key && !descriptor) {
    diagnostics.push({
      severity: "error",
      field: "key",
      message: `Unknown configuration key: ${key}. Supported keys: ${configSettingKeys().join(", ")}`,
    });
  }
  if (descriptor && !descriptor.scopes.includes(scope)) {
    diagnostics.push({
      severity: "error",
      field: "scope",
      message: `${descriptor.key} cannot be set in the ${scope} scope. Supported scopes: ${descriptor.scopes.join(", ")}.`,
    });
  }

  const rawValue = requireText(payload.value, "value", diagnostics);
  let admitted: unknown;
  if (descriptor && rawValue) {
    const parsed = parseConfigSettingValue(descriptor, rawValue);
    if (parsed.ok) {
      admitted = parsed.value;
    } else {
      diagnostics.push({ severity: "error", field: "value", message: parsed.message });
    }
  }

  const path = scope === "global" ? context.globalConfigPath : projectConfigPath(context.projectPath);
  const document = readCanonicalDocument(path, scope, diagnostics);
  if (document && descriptor && admitted !== undefined) {
    if (targetsAlias(document, descriptor.path)) {
      diagnostics.push({
        severity: "error",
        field: "key",
        message: `${descriptor.key} resolves through a YAML alias. Edit the anchor directly instead.`,
      });
    } else {
      document.setIn([...descriptor.path], admitted);
    }
  }

  const nextContent = document?.toString() ?? "";
  if (scope === "project" && nextContent && diagnostics.every((entry) => entry.severity !== "error")) {
    // Structural and semantic admission runs before the write, never after it.
    admitProjectStructure(nextContent, path, diagnostics);
  }

  const governance = descriptor
    ? configSettingGovernance(descriptor, scope)
    : { authorityBearing: true, activation: "next-session" as const, owners: [] };

  return {
    scope,
    payload: { scope, key, value: rawValue },
    path,
    nextContent,
    diagnostics,
    // Authority comes from the owning schema's metadata. A key that can change
    // what Kiln may do fails closed rather than guessing whether one value
    // widens or narrows.
    authorityImpact: governance.authorityBearing ? "unknown" : "none",
    affectedOwners: governance.owners,
    reconciliationTargets: descriptor?.reconciliationTargets ?? [],
    activation: governance.activation,
  };
}

/** Scope must be stated exactly; a typo must never silently target another document. */
function admitScope(
  value: unknown,
  diagnostics: KilnConfigValidationDiagnostic[],
): KilnConfigMutationScope {
  if (value === "project" || value === "global") {
    return value;
  }
  diagnostics.push({
    severity: "error",
    field: "scope",
    message: `Scope must be exactly "project" or "global"; received ${JSON.stringify(value)}.`,
  });
  return "project";
}

/** Rejects a path that resolves through a YAML alias, per ADR-014. */
function targetsAlias(document: Document, path: readonly string[]): boolean {
  for (let depth = 1; depth <= path.length; depth += 1) {
    const node = document.getIn(path.slice(0, depth), true);
    if (isAlias(node)) {
      return true;
    }
    if (depth < path.length && node !== undefined && !isCollection(node)) {
      return false;
    }
  }
  return false;
}

function admitProjectStructure(
  content: string,
  path: string,
  diagnostics: KilnConfigValidationDiagnostic[],
): void {
  try {
    parseProjectConfigStructure(parse(content), path);
  } catch (error) {
    diagnostics.push({
      severity: "error",
      field: "configuration",
      message: `Result rejected by the project configuration schema: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/**
 * Restores one configuration scope to its defaults.
 *
 * A reset can revert permission, governance, and interactive-use material in
 * one step, so it always counts as authority-affecting and requires approval.
 */
function normalizeSettingReset(
  context: ConfigMutationContext,
  rawPayload: unknown,
): NormalizedConfigMutation {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  const scope = admitScope(payload.scope, diagnostics);
  const path = scope === "global" ? context.globalConfigPath : projectConfigPath(context.projectPath);
  // Reset is an explicit request for defaults, so unlike a settings change it
  // may establish a configuration that does not exist yet.

  const defaults = scope === "global" ? defaultGlobalConfig() : defaultKilnYaml("generic");
  return {
    scope,
    payload: { scope },
    path,
    // Reset replaces the document outright, so comment preservation does not
    // apply: the operator asked for defaults, not an edit of what they wrote.
    nextContent: stringify(defaults),
    diagnostics,
    authorityImpact: "unknown",
    affectedOwners: scope === "global" ? ["operator-preferences", "permission-authority"] : ["project-composition", "permission-authority"],
    reconciliationTargets: ["repo-shims"],
    activation: "next-session",
  };
}

function projectConfigPath(projectPath: string): string {
  return join(projectPath, ".kiln", "kiln.yaml");
}

/**
 * Parses a canonical document for editing. A configuration that does not exist
 * yet is never minted as a side effect of a settings change; adoption is an
 * explicit operation with its own contract.
 */
function readCanonicalDocument(
  path: string,
  scope: KilnConfigMutationScope,
  diagnostics: KilnConfigValidationDiagnostic[],
): Document | undefined {
  const existingContent = existsSync(path) ? readFileSync(path, "utf-8") : "";
  if (existingContent.trim().length === 0) {
    diagnostics.push({
      severity: "error",
      field: "configuration",
      message: scope === "global"
        ? "Global configuration has not been adopted yet. Run Kiln setup before setting a configuration key."
        : "Project configuration has not been initialized yet. Run 'kiln init' before setting a configuration key.",
    });
    return undefined;
  }
  const document = parseDocument(existingContent);
  if (document.errors.length > 0) {
    diagnostics.push({
      severity: "error",
      field: "configuration",
      message: `Canonical configuration cannot be parsed for mutation: ${document.errors[0]?.message ?? "unknown error"}`,
    });
    return undefined;
  }
  return document;
}

function normalizeAgentUpsert(projectPath: string, rawPayload: unknown): NormalizedConfigMutation {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  const name = requireId(payload.name, "name", diagnostics);
  const role = requireText(payload.role, "role", diagnostics);
  const goal = requireText(payload.goal, "goal", diagnostics);
  const tier = requireTier(payload.tier, diagnostics);
  const displayName = optionalText(payload.displayName, "displayName", diagnostics);
  const nicknameCandidates = optionalAliasList(payload.nicknameCandidates, {
    field: "nicknameCandidates",
    canonicalName: name,
    displayName,
    diagnostics,
  });
  const tools = validateAgentProfileTools(optionalStringList(payload.tools, "tools", diagnostics), diagnostics);
  const skills = optionalStringList(payload.skills, "skills", diagnostics);
  const taskAffinity = optionalTaskAffinity(payload.taskAffinity, diagnostics);
  if (payload.model !== undefined) {
    diagnostics.push({
      severity: "error",
      field: "model",
      message: "Agent model is not a canonical top-level field. Select a global targetId instead.",
    });
  }
  const instructions = optionalText(payload.instructions, "instructions", diagnostics);
  const normalized = removeUndefined({
    name,
    displayName,
    nicknameCandidates: nicknameCandidates.length > 0 ? nicknameCandidates : undefined,
    role,
    goal,
    tier,
    tools,
    skills,
    taskAffinity,
    instructions,
  });
  const path = join(projectPath, ".kiln", "agents", `${name || "invalid-agent"}.md`);
  const nextContent = renderAgentMarkdown(normalized);

  if (!parseAgentDefinitionContent(nextContent, "project")) {
    diagnostics.push({ severity: "error", field: "agent", message: "Agent profile must contain valid name, role, goal, and tier frontmatter." });
  }

  const currentTools = existsSync(path)
    ? (parseAgentDefinitionContent(readFileSync(path, "utf-8"), "project")?.tools ?? [])
    : [];

  return {
    scope: "project",
    payload: normalized,
    path,
    nextContent,
    diagnostics,
    authorityImpact: agentToolAuthorityImpact(currentTools, tools),
    affectedOwners: ["project-agent-catalog"],
    reconciliationTargets: ["native-agents", "repo-shims"],
    activation: "reconcile",
  };
}

function normalizeAgentAttachSkills(projectPath: string, rawPayload: unknown): NormalizedConfigMutation {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  const agent = requireId(payload.agent, "agent", diagnostics);
  const skills = optionalStringList(payload.skills, "skills", diagnostics);
  if (skills.length === 0) {
    diagnostics.push({ severity: "error", field: "skills", message: "At least one skill is required." });
  }

  const path = join(projectPath, ".kiln", "agents", `${agent || "invalid-agent"}.md`);
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const existingAgent = existing ? parseAgentDefinitionContent(existing, "project") : undefined;
  if (!existingAgent) {
    diagnostics.push({ severity: "error", field: "agent", message: "Project agent profile not found or invalid." });
  }

  const nextAgent = existingAgent
    ? {
      ...existingAgent,
      skills: uniqueStrings([...(existingAgent.skills ?? []), ...skills]),
    }
    : undefined;

  return {
    scope: "project",
    payload: { agent, skills },
    path,
    nextContent: nextAgent ? renderExistingAgent(nextAgent) : existing,
    diagnostics,
    authorityImpact: "none",
    affectedOwners: ["project-agent-catalog"],
    reconciliationTargets: ["native-agents", "repo-shims"],
    activation: "reconcile",
  };
}

function renderSkillMarkdown(skill: {
  readonly name: string;
  readonly description: string;
  readonly tools: readonly string[];
  readonly tags: readonly string[];
  readonly instructions: string;
}): string {
  const frontmatter = removeUndefined({
    name: skill.name,
    description: skill.description,
    tools: skill.tools.length > 0 ? skill.tools : undefined,
    tags: skill.tags.length > 0 ? skill.tags : undefined,
  });
  return `---\n${stringify(frontmatter).trim()}\n---\n\n${skill.instructions.trim()}\n`;
}

function renderAgentMarkdown(agent: Record<string, unknown>): string {
  const { instructions, ...frontmatter } = agent;
  return `---\n${stringify(frontmatter).trim()}\n---\n\n${typeof instructions === "string" ? instructions.trim() : ""}\n`;
}

/**
 * Re-renders an existing profile. Every admitted field is serialized: attaching
 * a skill must not silently drop routing, economic, authority, or communication
 * material that the operator authored. `scope` is derived at load time and is
 * not canonical profile content.
 */
function renderExistingAgent(agent: KilnAgentDefinition): string {
  const { scope: _scope, instructions, ...profile } = agent;
  return renderAgentMarkdown(removeUndefined({ ...profile, instructions }));
}

function optionalTaskAffinity(value: unknown, diagnostics: KilnConfigValidationDiagnostic[]): readonly string[] {
  const entries = optionalStringList(value, "taskAffinity", diagnostics);
  const supported = new Set([
    "architecture-review",
    "backend-coding",
    "frontend-design",
    "mechanical-edit",
    "research",
    "test-writing",
  ]);
  const invalid = entries.filter((entry) => !supported.has(entry));
  for (const entry of invalid) {
    diagnostics.push({ severity: "error", field: "taskAffinity", message: `Unsupported task affinity: ${entry}` });
  }
  return entries.filter((entry) => supported.has(entry));
}

function validateAgentProfileTools(
  tools: readonly string[],
  diagnostics: KilnConfigValidationDiagnostic[],
): readonly string[] {
  const valid: string[] = [];
  for (const tool of tools) {
    if (!SUPPORTED_AGENT_PROFILE_TOOLS.has(tool)) {
      diagnostics.push({
        severity: "error",
        field: "tools",
        message: `Unsupported agent profile tool: ${tool}`,
      });
      continue;
    }
    valid.push(tool);
  }
  return valid;
}

function optionalAliasList(
  value: unknown,
  input: {
    readonly field: string;
    readonly canonicalName: string;
    readonly displayName: string | undefined;
    readonly diagnostics: KilnConfigValidationDiagnostic[];
  },
): readonly string[] {
  const aliases = optionalStringListPreservingDuplicates(value, input.field, input.diagnostics);
  const normalizedAliases = aliases.map((alias) => normalizeAlias(alias));
  const seen = new Set<string>();
  for (const [index, normalized] of normalizedAliases.entries()) {
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      input.diagnostics.push({
        severity: "error",
        field: `${input.field}[${index}]`,
        message: "Duplicate alias.",
      });
    }
    seen.add(normalized);
  }

  const reserved = new Set([
    normalizeAlias(input.canonicalName),
    normalizeAlias(input.displayName),
  ].filter((entry): entry is string => Boolean(entry)));
  for (const [index, normalized] of normalizedAliases.entries()) {
    if (normalized && reserved.has(normalized)) {
      input.diagnostics.push({
        severity: "error",
        field: `${input.field}[${index}]`,
        message: "Alias must not duplicate the canonical name or display name.",
      });
    }
  }
  return uniqueStrings(aliases);
}

function requireId(value: unknown, field: string, diagnostics: KilnConfigValidationDiagnostic[]): string {
  const text = requireText(value, field, diagnostics);
  if (text && !/^[a-z][a-z0-9-]*$/u.test(text)) {
    diagnostics.push({ severity: "error", field, message: "Must be lowercase kebab-case." });
  }
  return text;
}

function requireText(value: unknown, field: string, diagnostics: KilnConfigValidationDiagnostic[]): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    diagnostics.push({ severity: "error", field, message: "Required non-empty string." });
    return "";
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, diagnostics: KilnConfigValidationDiagnostic[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    diagnostics.push({ severity: "error", field, message: "Expected string." });
    return undefined;
  }
  return value.trim() || undefined;
}

function requireTier(value: unknown, diagnostics: KilnConfigValidationDiagnostic[]): "reasoning" | "coding" | "fast" {
  if (value === "reasoning" || value === "coding" || value === "fast") {
    return value;
  }
  diagnostics.push({ severity: "error", field: "tier", message: "Must be reasoning, coding, or fast." });
  return "reasoning";
}

function optionalStringList(value: unknown, field: string, diagnostics: KilnConfigValidationDiagnostic[]): readonly string[] {
  return uniqueStrings(optionalStringListPreservingDuplicates(value, field, diagnostics));
}

function optionalStringListPreservingDuplicates(
  value: unknown,
  field: string,
  diagnostics: KilnConfigValidationDiagnostic[],
): readonly string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    diagnostics.push({ severity: "error", field, message: "Expected string array." });
    return [];
  }
  const strings: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      diagnostics.push({ severity: "error", field: `${field}[${index}]`, message: "Expected non-empty string." });
      continue;
    }
    strings.push(entry.trim());
  }
  return strings;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function removeUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function normalizeAlias(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase().replace(/\s+/gu, " ");
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function renderPreviewDiff(path: string, before: string, after: string): string {
  if (before === after) {
    return `--- ${path}\n+++ ${path}\n(no changes)\n`;
  }
  return [
    `--- ${path}`,
    `+++ ${path}`,
    "@@ proposed content @@",
    after.trimEnd(),
    "",
  ].join("\n");
}

export function hashStable(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isInsideProject(projectRoot: string, candidate: string): boolean {
  const relativePath = relative(projectRoot, candidate);
  return relativePath.length === 0 || (!relativePath.startsWith("..") && !/^[A-Za-z]:/.test(relativePath));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
