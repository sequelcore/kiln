import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  assertPolicyAdaptationPromotionEvidence,
  hashPolicyAdaptationConfiguration,
  parseSkillMd,
  type PolicyAdaptationCandidate,
  type PolicyAdaptationEvaluationReport,
} from "@kilnai/core";
import type {
  KilnConfigChangeOperation,
  KilnConfigChangeProposal,
  KilnConfigValidationDiagnostic,
} from "@kilnai/gateway-contracts";
import { parse, stringify } from "yaml";
import type { KilnContextGovernanceConfig, KilnYaml } from "../kiln-yaml-types.js";
import { parseAgentDefinitionContent, type KilnAgentDefinition } from "./agent-loader.js";

export interface CreateConfigChangeProposalInput {
  readonly projectPath: string;
  readonly operation: KilnConfigChangeOperation;
  readonly payload: unknown;
  readonly now?: Date;
}

export interface ConfigChangeProposalWrite {
  readonly path: string;
  readonly previousHash: string | null;
  readonly nextHash: string;
  readonly nextContent: string;
}

export interface ConfigChangeProposalRecord {
  readonly proposal: KilnConfigChangeProposal;
  readonly proposalHash: string;
  readonly writes: readonly ConfigChangeProposalWrite[];
}

interface NormalizedProposalParts {
  readonly payload: Record<string, unknown>;
  readonly path: string;
  readonly nextContent: string;
  readonly diagnostics: readonly KilnConfigValidationDiagnostic[];
  readonly authorityImpact: KilnConfigChangeProposal["authorityImpact"];
  readonly nativeProjectionEffects: readonly string[];
  readonly rollbackHint: string;
}

const SUPPORTED_AGENT_PROFILE_TOOLS = new Set([
  "read",
  "grep",
  "glob",
  "web",
  "write",
  "bash",
]);

export function createConfigChangeProposal(input: CreateConfigChangeProposalInput): KilnConfigChangeProposal {
  return createConfigChangeProposalRecord(input).proposal;
}

export function createConfigChangeProposalRecord(input: CreateConfigChangeProposalInput): ConfigChangeProposalRecord {
  const parts = normalizeProposal(input);
  const projectRoot = resolve(input.projectPath);
  const resolvedPath = resolve(parts.path);
  if (!isInsideProject(projectRoot, resolvedPath)) {
    const diagnostic: KilnConfigValidationDiagnostic = {
      severity: "error",
      field: "path",
      message: "Canonical config writes must stay inside the project root.",
    };
    const proposal = buildProposal(input, {
      ...parts,
      diagnostics: [...parts.diagnostics, diagnostic],
    });
    return {
      proposal,
      proposalHash: hashStable(proposal),
      writes: [],
    };
  }

  const proposal = buildProposal(input, parts);
  const existingContent = existsSync(parts.path) ? readFileSync(parts.path, "utf-8") : null;
  const writes = proposal.status === "valid"
    ? [{
      path: parts.path,
      previousHash: existingContent === null ? null : hashText(existingContent),
      nextHash: hashText(parts.nextContent),
      nextContent: parts.nextContent,
    }]
    : [];

  return {
    proposal,
    proposalHash: hashStable({
      proposal,
      writes: writes.map((write) => ({
        path: write.path,
        previousHash: write.previousHash,
        nextHash: write.nextHash,
      })),
    }),
    writes,
  };
}

function buildProposal(
  input: CreateConfigChangeProposalInput,
  parts: NormalizedProposalParts,
): KilnConfigChangeProposal {
  const existingContent = existsSync(parts.path) ? readFileSync(parts.path, "utf-8") : "";
  const status = parts.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "invalid" : "valid";
  const createdAt = (input.now ?? new Date()).toISOString();
  const proposalSeed = {
    operation: input.operation,
    payload: parts.payload,
    path: parts.path,
    nextContent: parts.nextContent,
  };

  return {
    proposalId: `cfg_${hashStable(proposalSeed).slice(0, 24)}`,
    createdAt,
    operation: input.operation,
    status,
    normalizedPayload: parts.payload,
    affectedCanonicalPaths: [parts.path],
    nativeProjectionEffects: parts.nativeProjectionEffects,
    authorityImpact: parts.authorityImpact,
    diagnostics: parts.diagnostics,
    previewDiff: renderPreviewDiff(parts.path, existingContent, parts.nextContent),
    rollbackHint: parts.rollbackHint,
  };
}

function normalizeProposal(input: CreateConfigChangeProposalInput): NormalizedProposalParts {
  switch (input.operation) {
    case "skill.upsert":
      return normalizeSkillUpsert(input.projectPath, input.payload);
    case "agent.upsert":
      return normalizeAgentUpsert(input.projectPath, input.payload);
    case "agent.attach_skills":
      return normalizeAgentAttachSkills(input.projectPath, input.payload);
    case "context_governance.adapt":
      return normalizeContextGovernanceAdaptation(input.projectPath, input.payload);
  }
}

function normalizeContextGovernanceAdaptation(projectPath: string, rawPayload: unknown): NormalizedProposalParts {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  const path = join(projectPath, ".kiln", "kiln.yaml");
  const existingContent = existsSync(path) ? readFileSync(path, "utf-8") : "version: '1'\n";
  const parsed = parse(existingContent) as KilnYaml | null;
  const config: KilnYaml = parsed && typeof parsed === "object" ? parsed : { version: "1" };
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
    payload,
    path,
    nextContent,
    diagnostics,
    authorityImpact: "none",
    nativeProjectionEffects: [],
    rollbackHint: `Restore the previous contextGovernance selection in ${path}`,
  };
}

function normalizeSkillUpsert(projectPath: string, rawPayload: unknown): NormalizedProposalParts {
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
    payload: normalized,
    path,
    nextContent,
    diagnostics,
    authorityImpact: "none",
    nativeProjectionEffects: ["native skill projections must be regenerated after apply"],
    rollbackHint: existsSync(path) ? `Restore previous ${path}` : `Delete ${path}`,
  };
}

function normalizeAgentUpsert(projectPath: string, rawPayload: unknown): NormalizedProposalParts {
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
      message: "Agent model is not a canonical top-level field. Use providerRoute for strict execution routing.",
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

  return {
    payload: normalized,
    path,
    nextContent,
    diagnostics,
    authorityImpact: tools.includes("write") || tools.includes("bash") ? "expands-write" : "none",
    nativeProjectionEffects: ["native agent projections must be regenerated after apply"],
    rollbackHint: existsSync(path) ? `Restore previous ${path}` : `Delete ${path}`,
  };
}

function normalizeAgentAttachSkills(projectPath: string, rawPayload: unknown): NormalizedProposalParts {
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
    payload: { agent, skills },
    path,
    nextContent: nextAgent ? renderExistingAgent(nextAgent) : existing,
    diagnostics,
    authorityImpact: "none",
    nativeProjectionEffects: ["native agent projections must be regenerated after apply"],
    rollbackHint: `Restore previous ${path}`,
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

function renderExistingAgent(agent: KilnAgentDefinition): string {
  return renderAgentMarkdown(removeUndefined({
    name: agent.name,
    displayName: agent.displayName,
    role: agent.role,
    goal: agent.goal,
    tier: agent.tier,
    tools: agent.tools,
    skills: agent.skills,
    taskAffinity: agent.taskAffinity,
    providerRoute: agent.providerRoute,
    instructions: agent.instructions,
  }));
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

function renderPreviewDiff(path: string, before: string, after: string): string {
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

function hashStable(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isInsideProject(projectRoot: string, candidate: string): boolean {
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
