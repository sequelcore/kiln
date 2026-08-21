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
import { isOperatorThemeName } from "@kilnai/gateway-contracts";
import { parse, parseDocument, stringify } from "yaml";
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
    case "preference.set":
      return normalizePreferenceSet(context.globalConfigPath, payload);
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
 * Global operator preference. Preferences carry no execution authority and are
 * read per use, so they activate immediately once committed.
 */
function normalizePreferenceSet(globalConfigPath: string, rawPayload: unknown): NormalizedConfigMutation {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  const key = requireText(payload.key, "key", diagnostics);
  const preference = SUPPORTED_OPERATOR_PREFERENCES.get(key);
  if (key && !preference) {
    diagnostics.push({
      severity: "error",
      field: "key",
      message: `Unsupported operator preference: ${key}. Supported: ${[...SUPPORTED_OPERATOR_PREFERENCES.keys()].join(", ")}`,
    });
  }
  const value = requireText(payload.value, "value", diagnostics);
  if (preference && value) {
    const rejection = preference.admit(value);
    if (rejection) {
      diagnostics.push({ severity: "error", field: "value", message: rejection });
    }
  }

  // ADR-014: edit the YAML document tree so operator comments, ordering, and
  // scalar style survive; never round-trip the file through a plain object.
  const existingContent = existsSync(globalConfigPath) ? readFileSync(globalConfigPath, "utf-8") : "";
  if (existingContent.trim().length === 0) {
    // Setting a preference must never mint canonical configuration as a side
    // effect. Adoption is an explicit operation with its own contract.
    diagnostics.push({
      severity: "error",
      field: "global-config",
      message: "Global configuration has not been adopted yet. Run Kiln setup before setting an operator preference.",
    });
  }
  const document = parseDocument(existingContent);
  if (document.errors.length > 0) {
    diagnostics.push({
      severity: "error",
      field: "global-config",
      message: `Global configuration cannot be parsed for mutation: ${document.errors[0]?.message ?? "unknown error"}`,
    });
  } else if (preference && value) {
    document.setIn(preference.path, value);
  }

  return {
    scope: "global",
    payload: { key, value },
    path: globalConfigPath,
    nextContent: document.toString(),
    diagnostics,
    authorityImpact: "none",
    affectedOwners: ["operator-preferences"],
    reconciliationTargets: [],
    activation: preference?.activation ?? "hot",
  };
}

interface OperatorPreferenceDescriptor {
  readonly activation: KilnConfigActivationClass;
  /** Canonical document path this preference owns. */
  readonly path: readonly string[];
  /** Returns a rejection message, or undefined when the value is admitted. */
  readonly admit: (value: string) => string | undefined;
}

/**
 * The bounded preference surface. Each entry resolves the activation class its
 * ownership-ledger row left to this authority, so no preference activates by
 * assumption.
 */
const SUPPORTED_OPERATOR_PREFERENCES = new Map<string, OperatorPreferenceDescriptor>([
  ["ui.theme", {
    activation: "hot",
    path: ["ui", "theme"],
    admit: (value) => isOperatorThemeName(value) ? undefined : `Unknown operator theme '${value}'.`,
  }],
  ["identity.name", {
    // Read fresh from global config at each use (for example `kiln trust`), and
    // never baked into a projection or session cache, so it governs immediately.
    activation: "hot",
    path: ["identity", "name"],
    admit: (value) => value.length <= 120 ? undefined : "Operator name must be 120 characters or fewer.",
  }],
  ["identity.timezone", {
    activation: "hot",
    path: ["identity", "timezone"],
    admit: (value) => isSupportedTimeZone(value) ? undefined : `Unknown IANA time zone '${value}'.`,
  }],
]);

function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
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
