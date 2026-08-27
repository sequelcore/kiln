import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
import { isOperatorAppearancePreference } from "@kilnai/operator-appearance";
import { parse, parseDocument, stringify, type Document } from "yaml";
import { validateGlobalConfig } from "../config/global-config.js";
import { deriveEffectiveKilnYaml } from "../config/config-merger.js";
import { isAlias, isCollection } from "yaml";
import {
  projectExecutionTargetCatalogFromIntent,
  readExecutionTargetEvidenceSnapshot,
  type DirectExecutionTargetIntent,
  type ExecutionTargetCatalogIntent,
  type ExecutionTargetEvidenceRevision,
  type ExecutionTargetEvidenceSnapshot,
} from "../config/execution-target-evidence-store.js";
import {
  configSettingDescriptor,
  configSettingGovernance,
  configSettingKeys,
  normalizeStringListRecord,
  parseConfigSettingValue,
} from "./config-setting-descriptors.js";
import { parseProjectConfigStructure } from "../config/project-config-schema.js";
import type { KilnContextGovernanceConfig, ResolvedKilnConfig } from "../kiln-yaml-types.js";
import { parseAgentDefinitionContent, type KilnAgentDefinition } from "./agent-loader.js";
import {
  type ProjectStateBinding,
  resolveProjectStateBinding,
} from "./project-state-root.js";

/** Where an operation reads current state from and writes its canonical result to. */
export interface ConfigMutationContext {
  readonly projectPath: string;
  readonly globalConfigPath: string;
  /** Established private project-state binding; repository `.kiln` is never a source. */
  readonly projectStateBinding?: ProjectStateBinding;
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
      return normalizeSkillUpsert(context, payload);
    case "agent.upsert":
      return normalizeAgentUpsert(projectBinding(context), payload);
    case "agent.attach_skills":
      return normalizeAgentAttachSkills(projectBinding(context), payload);
    case "context_governance.adapt":
      return normalizeContextGovernanceAdaptation(projectBinding(context), payload);
    case "setting.set":
      return normalizeSettingSet(context, payload);
    case "setting.reset":
      return normalizeSettingReset(context, payload);
    case "project.adopt":
      return normalizeProjectAdopt(context, payload);
    case "target.select":
      return normalizeTargetSelect(context, payload);
    case "target.create":
      return normalizeTargetCreate(context, payload);
    case "native.import":
      return normalizeNativeImport(context, payload);
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

function normalizeContextGovernanceAdaptation(binding: ProjectStateBinding, rawPayload: unknown): NormalizedConfigMutation {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  const path = binding.configPath;
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

function normalizeSkillUpsert(context: ConfigMutationContext, rawPayload: unknown): NormalizedConfigMutation {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  const scopeValue = payload.scope;
  if (scopeValue !== undefined && scopeValue !== "project" && scopeValue !== "user") {
    diagnostics.push({ severity: "error", field: "scope", message: "Skill scope must be exactly project or user." });
  }
  const userScope = scopeValue === "user";
  const name = requireId(payload.name, "name", diagnostics);
  const description = requireText(payload.description, "description", diagnostics);
  const license = optionalText(payload.license, "license", diagnostics);
  const compatibility = optionalText(payload.compatibility, "compatibility", diagnostics);
  if (compatibility !== undefined && compatibility.length > 500) {
    diagnostics.push({ severity: "error", field: "compatibility", message: "Must be at most 500 characters." });
  }
  const metadata = optionalMetadata(payload.metadata, diagnostics);
  const handler = optionalText(payload.handler, "handler", diagnostics);
  const instructions = requireText(payload.instructions, "instructions", diagnostics);
  const tools = optionalStringList(payload.tools, "tools", diagnostics);
  const tags = optionalStringList(payload.tags, "tags", diagnostics);
  const triggers = optionalSkillTriggers(payload.triggers, diagnostics);
  const path = join(projectBinding(context).skillsPath, name || "invalid-skill", "SKILL.md");
  const canonicalPath = userScope
    ? join(dirname(context.globalConfigPath), "skills", name || "invalid-skill", "SKILL.md")
    : path;
  const normalized = {
    name,
    description,
    license,
    compatibility,
    metadata,
    handler,
    tools,
    tags,
    triggers,
    instructions,
  };
  const nextContent = renderSkillMarkdown(normalized);

  try {
    parseSkillMd(nextContent, canonicalPath);
  } catch (error) {
    diagnostics.push({ severity: "error", field: "skill", message: errorMessage(error) });
  }

  return {
    scope: userScope ? "global" : "project",
    payload: { scope: userScope ? "user" : "project", ...removeUndefined(normalized) },
    path: canonicalPath,
    nextContent,
    diagnostics,
    authorityImpact: "none",
    affectedOwners: [userScope ? "user-skill-catalog" : "project-skill-catalog"],
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

  let admitted: unknown;
  if (descriptor) {
    const parsed = parseSettingInput(descriptor, payload.value);
    if (parsed.ok) {
      admitted = parsed.value;
    } else {
      diagnostics.push({ severity: "error", field: "value", message: parsed.message });
    }
  }

  const path = scope === "global" ? context.globalConfigPath : projectConfigPath(context);
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
    payload: { scope, key, value: admitted },
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

function parseSettingInput(
  descriptor: NonNullable<ReturnType<typeof configSettingDescriptor>>,
  value: unknown,
): ReturnType<typeof parseConfigSettingValue> {
  if (typeof value === "string") {
    return parseConfigSettingValue(descriptor, value);
  }
  switch (descriptor.value.kind) {
    case "boolean":
      return typeof value === "boolean"
        ? { ok: true, value }
        : { ok: false, message: `Invalid boolean value for ${descriptor.key}.` };
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false, message: `Invalid numeric value for ${descriptor.key}.` };
    case "string-list":
      return Array.isArray(value) && value.every((entry) => typeof entry === "string")
        ? { ok: true, value: value.map((entry) => entry.trim()).filter(Boolean) }
        : { ok: false, message: `Invalid value for ${descriptor.key}: expected a string array.` };
    case "string-list-record":
      return normalizeStringListRecord(value, descriptor.key);
    case "json":
      return value !== undefined
        ? { ok: true, value }
        : { ok: false, message: `Invalid value for ${descriptor.key}: expected JSON-compatible data.` };
    case "operator-appearance":
      return isOperatorAppearancePreference(value)
        ? { ok: true, value }
        : { ok: false, message: `Invalid ${descriptor.key}: expected a complete appearance preference.` };
    case "text":
    case "enum":
    case "timezone":
      return { ok: false, message: `Invalid text value for ${descriptor.key}.` };
  }
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

/** Removes one descriptor-owned key and returns the document to inheritance. */
function normalizeSettingReset(
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
      message: `${descriptor.key} cannot be reset in the ${scope} scope. Supported scopes: ${descriptor.scopes.join(", ")}.`,
    });
  }
  const path = scope === "global" ? context.globalConfigPath : projectConfigPath(context);
  const document = readCanonicalDocument(path, scope, diagnostics);
  if (document && descriptor && descriptor.scopes.includes(scope)) {
    if (targetsAlias(document, descriptor.path)) {
      diagnostics.push({
        severity: "error",
        field: "key",
        message: `${descriptor.key} resolves through a YAML alias. Edit the anchor directly instead.`,
      });
    } else if (!hasDocumentPath(document, descriptor.path)) {
      diagnostics.push({
        severity: "error",
        field: "key",
        message: `${descriptor.key} is already inherited in the ${scope} scope.`,
      });
    } else {
      document.deleteIn([...descriptor.path]);
      pruneEmptyParents(document, descriptor.path);
    }
  }
  const nextContent = document?.toString() ?? "";
  if (nextContent && diagnostics.every((entry) => entry.severity !== "error")) {
    if (scope === "global") {
      admitGlobalStructure(nextContent, diagnostics);
    } else {
      admitProjectStructure(nextContent, path, diagnostics);
    }
  }
  const governance = descriptor
    ? configSettingGovernance(descriptor, scope)
    : { authorityBearing: true, activation: "next-session" as const, owners: [] };
  return {
    scope,
    payload: { scope, key },
    path,
    nextContent,
    diagnostics,
    authorityImpact: governance.authorityBearing ? "unknown" : "none",
    affectedOwners: governance.owners,
    reconciliationTargets: descriptor?.reconciliationTargets ?? [],
    activation: governance.activation,
  };
}

function hasDocumentPath(document: Document, path: readonly string[]): boolean {
  for (let depth = 1; depth <= path.length; depth += 1) {
    const node = document.getIn(path.slice(0, depth), true);
    if (node === undefined) return false;
    if (depth < path.length && !isCollection(node)) return false;
  }
  return true;
}

/** Deletes empty mapping parents left behind by a keyed reset. */
function pruneEmptyParents(document: Document, path: readonly string[]): void {
  for (let depth = path.length - 1; depth > 0; depth -= 1) {
    const parent = document.getIn(path.slice(0, depth), true);
    if (!isCollection(parent)) break;
    const items = (parent as { readonly items?: readonly unknown[] }).items;
    if (!items || items.length !== 0) break;
    document.deleteIn(path.slice(0, depth));
  }
}

/**
 * Adopts the smallest project document that is structurally admitted by the
 * project schema. Existing valid project intent is preserved; adoption only
 * supplies the requested permission posture when it is not already present.
 * No provider, target evidence, credential, channel, team, or machine path is
 * authored here.
 */
function normalizeProjectAdopt(
  context: ConfigMutationContext,
  rawPayload: unknown,
): NormalizedConfigMutation {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  if (payload.scope !== "project") {
    diagnostics.push({
      severity: "error",
      field: "scope",
      message: 'Project adoption scope must be exactly "project".',
    });
  }
  const posture = payload.posture === "read-only" ? payload.posture : "read-only";
  if (payload.posture !== posture) {
    diagnostics.push({
      severity: "error",
      field: "posture",
      message: 'Project adoption posture must be "read-only".',
    });
  }

  const path = projectConfigPath(context);
  const existingContent = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const safeApproval = safeProjectApproval(context.globalConfigPath);
  let nextContent: string;
  let currentPermissions: Record<string, unknown> = {};
  let projectApproval = safeApproval;
  if (existingContent.trim().length === 0) {
    nextContent = stringify({
      version: "1",
      permissions: {
        approval: safeApproval,
        sandbox: posture,
      },
    });
  } else {
    try {
      const existing = parseProjectConfigStructure(parse(existingContent), path);
      currentPermissions = asRecord(existing.permissions);
      projectApproval = stricterProjectApproval(currentPermissions.approval, safeApproval);
      const document = parseDocument(existingContent);
      document.setIn(["permissions", "approval"], projectApproval);
      document.setIn(["permissions", "sandbox"], posture);
      nextContent = document.toString();
    } catch (error) {
      diagnostics.push({
        severity: "error",
        field: "configuration",
        message: `Existing project configuration is not structurally admitted: ${errorMessage(error)}`,
      });
      nextContent = existingContent;
    }
  }

  if (diagnostics.every((entry) => entry.severity !== "error")) {
    admitProjectStructure(nextContent, path, diagnostics);
  }
  if (diagnostics.every((entry) => entry.severity !== "error")) {
    try {
      const globalContent = existsSync(context.globalConfigPath)
        ? readFileSync(context.globalConfigPath, "utf-8")
        : "";
      if (globalContent.trim().length === 0) {
        throw new Error("Global configuration has not been adopted yet.");
      }
      const global = parse(globalContent);
      validateGlobalConfig(global);
      const project = parseProjectConfigStructure(parse(nextContent), path);
      deriveEffectiveKilnYaml(global, project);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        field: "configuration",
        message: `Project configuration is not admitted against current global composition: ${errorMessage(error)}`,
      });
    }
  }

  const nextPermissions = {
    ...currentPermissions,
    approval: projectApproval,
    sandbox: currentPermissions.sandbox ?? posture,
  };
  let authorityImpact = permissionAuthorityImpact(currentPermissions, nextPermissions);
  // Establishing the canonical safe baseline does not expand project
  // authority. The comparison helper intentionally fails closed for complex
  // permission records, so normalize this one known-safe creation case.
  if (existingContent.trim().length === 0 && posture === "read-only") {
    authorityImpact = "none";
  }

  return {
    scope: "project",
    payload: { scope: "project", posture, approval: projectApproval },
    path,
    nextContent,
    diagnostics,
    authorityImpact,
    affectedOwners: ["project-configuration", "model-facing-execution-authority"],
    reconciliationTargets: ["repo-shims"],
    activation: "next-session",
  };
}

/**
 * Project onboarding never weakens a global approval bound. `untrusted` is
 * stricter than the canonical first-turn `on-request` baseline and is carried
 * into the project document when either global permission family requires it.
 */
type SafeProjectApproval = "on-request" | "on-failure" | "untrusted";

function safeProjectApproval(globalConfigPath: string): SafeProjectApproval {
  if (!existsSync(globalConfigPath)) return "on-request";
  try {
    const global = parse(readFileSync(globalConfigPath, "utf-8")) as Record<string, unknown>;
    const permissions = asRecord(global.permissions);
    const ceiling = asRecord(global.permissionCeiling);
    return stricterProjectApproval(permissions.approval, ceiling.approval, "on-request");
  } catch {
    return "on-request";
  }
}

function stricterProjectApproval(...values: readonly unknown[]): SafeProjectApproval {
  const rank: Record<SafeProjectApproval, number> = { untrusted: 0, "on-failure": 1, "on-request": 2 };
  return values.reduce<SafeProjectApproval>((strictest, value) => {
    if (value !== "untrusted" && value !== "on-failure" && value !== "on-request") return strictest;
    return rank[value] < rank[strictest] ? value : strictest;
  }, "on-request");
}

/**
 * Persists the operator's default execution target and the GUI's explicit
 * selection as one global-document mutation. The target catalog remains the
 * routing owner; this operation only selects an already-admitted direct
 * target and optional account override.
 */
function normalizeTargetSelect(
  context: ConfigMutationContext,
  rawPayload: unknown,
): NormalizedConfigMutation {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  const targetId = requireCanonicalId(payload.targetId, "targetId", diagnostics);
  const accountOverrideId = payload.accountOverrideId === null
    ? undefined
    : payload.accountOverrideId === undefined
      ? undefined
      : requireCanonicalId(payload.accountOverrideId, "accountOverrideId", diagnostics);
  const path = context.globalConfigPath;
  const document = readValidGlobalDocument(path, diagnostics);
  let authorityImpact: KilnConfigAuthorityImpact = "none";
  if (document && targetId) {
    const current = parse(document.toString()) as Record<string, unknown>;
    const catalog = asRecord(current.targetCatalog);
    const targets = Array.isArray(catalog.targets) ? catalog.targets : [];
    const target = targets.find((entry) => isRecord(entry) && entry.id === targetId);
    if (!isRecord(target)) {
      diagnostics.push({ severity: "error", field: "targetId", message: `Execution target '${targetId}' is not configured.` });
    } else if (target.kind !== "direct") {
      diagnostics.push({ severity: "error", field: "targetId", message: `Execution target '${targetId}' is not a direct operator target.` });
    } else {
      if (accountOverrideId !== undefined) {
        const policies = Array.isArray(catalog.accountPolicies) ? catalog.accountPolicies : [];
        const policy = policies.find((entry) => isRecord(entry) && entry.id === target.accountPolicyId);
        const accountIds = isRecord(policy) && Array.isArray(policy.accountIds) ? policy.accountIds : [];
        if (!accountIds.includes(accountOverrideId)) {
          diagnostics.push({ severity: "error", field: "accountOverrideId", message: `Account override '${accountOverrideId}' is not eligible for execution target '${targetId}'.` });
        }
      }
      const currentSelection = asRecord(asRecord(current.ui).targetSelection);
      const currentRoutingTarget = asRecord(current.targetRouting).defaultTargetId;
      const currentSelectionTarget = currentSelection.targetId;
      const currentOverride = currentSelection.accountOverrideId;
      if (currentRoutingTarget !== targetId
        || (currentSelectionTarget !== undefined && currentSelectionTarget !== targetId)
        || currentOverride !== accountOverrideId) {
        // A target choice can change provider, model, account, billing, and
        // execution effects. No complete cross-target authority comparison is
        // available here, so selection fails closed until explicitly approved.
        authorityImpact = "unknown";
      }
      document.setIn(["targetRouting", "defaultTargetId"], targetId);
      document.setIn(["ui", "targetSelection"], {
        targetId,
        ...(accountOverrideId === undefined ? {} : { accountOverrideId }),
      });
    }
  }
  const nextContent = document?.toString() ?? "";
  if (document && diagnostics.every((entry) => entry.severity !== "error")) {
    admitGlobalStructure(nextContent, diagnostics);
  }
  return {
    scope: "global",
    payload: { targetId, ...(accountOverrideId === undefined ? {} : { accountOverrideId }) },
    path,
    nextContent,
    diagnostics,
    authorityImpact,
    affectedOwners: ["execution-routing", "operator-preferences"],
    reconciliationTargets: ["execution-targets"],
    activation: "next-session",
  };
}

/**
 * Adds a target intent whose managed evidence was already admitted and
 * published by the execution-target evidence owner. The proposal itself never
 * writes evidence bytes; it fences the global reference against the exact
 * published revision and validates the complete projected catalog before
 * producing canonical YAML.
 */
function normalizeTargetCreate(
  context: ConfigMutationContext,
  rawPayload: unknown,
): NormalizedConfigMutation {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  const targetRecord = asRecord(payload.target);
  const target = targetRecord as unknown as DirectExecutionTargetIntent;
  const targetId = requireCanonicalId(targetRecord.id, "target.id", diagnostics);
  if (targetRecord.kind !== "direct") {
    diagnostics.push({ severity: "error", field: "target.kind", message: "Target creation currently admits direct execution targets only." });
  }
  const evidenceRevision = requireEvidenceRevision(payload.evidenceRevision, diagnostics);
  const expectedRevision = requireConfigRevision(payload.expectedRevision, diagnostics);
  const path = context.globalConfigPath;
  const document = readValidGlobalDocument(path, diagnostics);
  let nextContent = "";
  if (document && evidenceRevision) {
    const actualRevision = existsSync(path) ? `sha256:${hashText(readFileSync(path, "utf-8"))}` : "absent";
    if (expectedRevision !== actualRevision) {
      diagnostics.push({ severity: "error", field: "expectedRevision", message: `Global configuration changed before target creation (expected ${expectedRevision}, found ${actualRevision}).` });
    }
    const current = parse(document.toString()) as Record<string, unknown>;
    const currentIntent = asRecord(current.targetCatalog) as unknown as ExecutionTargetCatalogIntent;
    if (!currentIntent || typeof currentIntent.evidenceRevision !== "string") {
      diagnostics.push({ severity: "error", field: "targetCatalog", message: "Global config must declare targetCatalog before creating a target." });
    } else if (currentIntent.evidenceRevision === evidenceRevision) {
      diagnostics.push({ severity: "error", field: "evidenceRevision", message: "Target creation must reference a newly published evidence revision, not the revision already bound to canonical config." });
    } else if (currentIntent.targets.some((entry) => entry.id === targetId)) {
      diagnostics.push({ severity: "error", field: "target.id", message: `Execution target '${targetId}' is already configured.` });
    } else {
      let evidence: ExecutionTargetEvidenceSnapshot;
      try {
        evidence = readExecutionTargetEvidenceSnapshot({ globalConfigPath: context.globalConfigPath, revision: evidenceRevision });
      } catch (error) {
        diagnostics.push({ severity: "error", field: "evidenceRevision", message: errorMessage(error) });
        evidence = { version: 1, accounts: [], targets: [] };
      }
      const nextIntent: ExecutionTargetCatalogIntent = {
        ...currentIntent,
        evidenceRevision,
        targets: [...currentIntent.targets, target],
      };
      try {
        // This proves the evidence owner published a complete snapshot that
        // contains every configured account/target and the new route identity.
        projectExecutionTargetCatalogFromIntent(nextIntent, evidence, evidenceRevision);
        document.setIn(["targetCatalog", "evidenceRevision"], evidenceRevision);
        document.setIn(["targetCatalog", "targets"], nextIntent.targets);
        nextContent = document.toString();
        admitGlobalStructure(nextContent, diagnostics);
      } catch (error) {
        diagnostics.push({ severity: "error", field: "targetCatalog", message: errorMessage(error) });
      }
    }
  }
  return {
    scope: "global",
    payload: { target, evidenceRevision, expectedRevision },
    path,
    nextContent,
    diagnostics,
    authorityImpact: "expands-write",
    affectedOwners: ["execution-routing", "execution-target-evidence"],
    reconciliationTargets: ["execution-targets"],
    activation: "next-session",
  };
}

/**
 * Imports only typed native intent. Existing global state must already be
 * valid; import is not an adoption path and cannot use backup-and-replace.
 */
function normalizeNativeImport(
  context: ConfigMutationContext,
  rawPayload: unknown,
): NormalizedConfigMutation {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  const target = payload.target;
  if (target !== "codex" && target !== "opencode") {
    diagnostics.push({ severity: "error", field: "target", message: "Native import target must be codex or opencode." });
  }
  const importedPermissions = payload.permissions === undefined
    ? undefined
    : asRecord(payload.permissions);
  if (payload.permissions !== undefined && Object.keys(asRecord(payload.permissions)).length === 0) {
    diagnostics.push({ severity: "error", field: "permissions", message: "Imported permissions must be a non-empty object when provided." });
  }
  if (importedPermissions !== undefined) {
    const supported = new Set(["approval", "sandbox"]);
    for (const key of Object.keys(importedPermissions)) {
      if (!supported.has(key)) {
        diagnostics.push({ severity: "error", field: `permissions.${key}`, message: "Native import only admits approval and sandbox permission intent." });
      }
    }
    if (importedPermissions.approval !== undefined
      && !["untrusted", "on-failure", "on-request", "never"].includes(String(importedPermissions.approval))) {
      diagnostics.push({ severity: "error", field: "permissions.approval", message: "Unknown native approval posture." });
    }
    if (importedPermissions.sandbox !== undefined
      && !["read-only", "workspace-write", "danger-full-access"].includes(String(importedPermissions.sandbox))) {
      diagnostics.push({ severity: "error", field: "permissions.sandbox", message: "Unknown native sandbox posture." });
    }
  }
  const path = context.globalConfigPath;
  const document = readValidGlobalDocument(path, diagnostics);
  let nextContent = "";
  let authorityImpact: KilnConfigAuthorityImpact = "none";
  if (document && (target === "codex" || target === "opencode")) {
    const current = parse(document.toString()) as Record<string, unknown>;
    const currentPermissions = asRecord(current.permissions);
    const currentEngines = asRecord(current.engines);
    const nextPermissions = importedPermissions === undefined
      ? currentPermissions
      : { ...currentPermissions, ...importedPermissions };
    const currentEngine = asRecord(currentEngines[target]);
    const nextEngine = { ...currentEngine, enabled: true };
    document.setIn(["engines", target], nextEngine);
    if (importedPermissions !== undefined) {
      for (const [key, value] of Object.entries(importedPermissions)) {
        document.setIn(["permissions", key], value);
      }
    }
    nextContent = document.toString();
    if (currentEngine.enabled !== true) authorityImpact = "expands-write";
    const permissionImpact = permissionAuthorityImpact(currentPermissions, nextPermissions);
    if (permissionImpact === "expands-write" || permissionImpact === "unknown") authorityImpact = permissionImpact;
    if (diagnostics.every((entry) => entry.severity !== "error")) {
      admitGlobalStructure(nextContent, diagnostics);
    }
  }
  return {
    scope: "global",
    payload: { target, ...(importedPermissions === undefined ? {} : { permissions: importedPermissions }) },
    path,
    nextContent,
    diagnostics,
    authorityImpact,
    affectedOwners: ["native-config-import", "permission-authority"],
    reconciliationTargets: ["native-permissions"],
    activation: "reconcile",
  };
}

function projectConfigPath(context: ConfigMutationContext): string {
  return projectBinding(context).configPath;
}

function projectBinding(context: ConfigMutationContext): ProjectStateBinding {
  return context.projectStateBinding ?? resolveProjectStateBinding(context.projectPath);
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

function readValidGlobalDocument(
  path: string,
  diagnostics: KilnConfigValidationDiagnostic[],
): Document | undefined {
  const document = readCanonicalDocument(path, "global", diagnostics);
  if (!document) return undefined;
  try {
    validateGlobalConfig(parse(document.toString()));
  } catch (error) {
    diagnostics.push({
      severity: "error",
      field: "configuration",
      message: `Canonical global configuration is invalid; import and selection require explicit adoption: ${errorMessage(error)}`,
    });
    return undefined;
  }
  return document;
}

function admitGlobalStructure(
  content: string,
  diagnostics: KilnConfigValidationDiagnostic[],
): void {
  try {
    validateGlobalConfig(parse(content));
  } catch (error) {
    diagnostics.push({
      severity: "error",
      field: "configuration",
      message: `Result rejected by the global configuration validator: ${errorMessage(error)}`,
    });
  }
}

function requireCanonicalId(
  value: unknown,
  field: string,
  diagnostics: KilnConfigValidationDiagnostic[],
): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value.trim())) {
    diagnostics.push({ severity: "error", field, message: "Must be a canonical identifier." });
    return "";
  }
  return value.trim();
}

function requireEvidenceRevision(
  value: unknown,
  diagnostics: KilnConfigValidationDiagnostic[],
): ExecutionTargetEvidenceRevision {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    diagnostics.push({ severity: "error", field: "evidenceRevision", message: "Must be an execution-target evidence SHA-256 revision." });
    return `sha256:${"0".repeat(64)}`;
  }
  return value as ExecutionTargetEvidenceRevision;
}

function requireConfigRevision(
  value: unknown,
  diagnostics: KilnConfigValidationDiagnostic[],
): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    diagnostics.push({ severity: "error", field: "expectedRevision", message: "Must be the current global configuration SHA-256 revision." });
    return "invalid";
  }
  return value;
}

/**
 * Compare the scalar permission dimensions with a conservative monotonic
 * ordering. Complex rule changes are not ordered by pattern semantics here,
 * so they fail closed as unknown rather than being treated as a narrowing.
 */
export function permissionAuthorityImpact(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): KilnConfigAuthorityImpact {
  if (stableStringify(current) === stableStringify(next)) return "none";
  const approvalRank: Record<string, number> = { untrusted: 0, "on-failure": 1, "on-request": 2, never: 3 };
  const sandboxRank: Record<string, number> = { "read-only": 0, "workspace-write": 1, "danger-full-access": 2 };
  const currentApproval = String(current.approval ?? "on-request");
  const nextApproval = String(next.approval ?? "on-request");
  const currentSandbox = String(current.sandbox ?? "read-only");
  const nextSandbox = String(next.sandbox ?? "read-only");
  if (approvalRank[currentApproval] === undefined || approvalRank[nextApproval] === undefined
    || sandboxRank[currentSandbox] === undefined || sandboxRank[nextSandbox] === undefined) {
    return "unknown";
  }
  if ((approvalRank[nextApproval] ?? 0) > (approvalRank[currentApproval] ?? 0)
    || (sandboxRank[nextSandbox] ?? 0) > (sandboxRank[currentSandbox] ?? 0)
    || (current.safeDefaults !== false && next.safeDefaults === false)) {
    return "expands-write";
  }
  if ((approvalRank[nextApproval] ?? 0) < (approvalRank[currentApproval] ?? 0)
    || (sandboxRank[nextSandbox] ?? 0) < (sandboxRank[currentSandbox] ?? 0)
    || (current.safeDefaults === false && next.safeDefaults === true)) {
    const scalarOnly = Object.keys(current).every((key) => ["approval", "sandbox", "safeDefaults"].includes(key))
      && Object.keys(next).every((key) => ["approval", "sandbox", "safeDefaults"].includes(key));
    return scalarOnly ? "none" : "unknown";
  }
  return "unknown";
}

function normalizeAgentUpsert(binding: ProjectStateBinding, rawPayload: unknown): NormalizedConfigMutation {
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
  const path = join(binding.agentsPath, `${name || "invalid-agent"}.md`);
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

function normalizeAgentAttachSkills(binding: ProjectStateBinding, rawPayload: unknown): NormalizedConfigMutation {
  const payload = asRecord(rawPayload);
  const diagnostics: KilnConfigValidationDiagnostic[] = [];
  const agent = requireId(payload.agent, "agent", diagnostics);
  const skills = optionalStringList(payload.skills, "skills", diagnostics);
  if (skills.length === 0) {
    diagnostics.push({ severity: "error", field: "skills", message: "At least one skill is required." });
  }

  const path = join(binding.agentsPath, `${agent || "invalid-agent"}.md`);
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
  readonly license?: string;
  readonly compatibility?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly handler?: string;
  readonly tools: readonly string[];
  readonly tags: readonly string[];
  readonly triggers?: readonly Record<string, unknown>[];
  readonly instructions: string;
}): string {
  const frontmatter = removeUndefined({
    name: skill.name,
    description: skill.description,
    license: skill.license,
    compatibility: skill.compatibility,
    metadata: skill.metadata && Object.keys(skill.metadata).length > 0 ? skill.metadata : undefined,
    handler: skill.handler,
    tools: skill.tools.length > 0 ? skill.tools : undefined,
    tags: skill.tags.length > 0 ? skill.tags : undefined,
    triggers: skill.triggers && skill.triggers.length > 0 ? skill.triggers : undefined,
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

function optionalMetadata(
  value: unknown,
  diagnostics: KilnConfigValidationDiagnostic[],
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    diagnostics.push({ severity: "error", field: "metadata", message: "Expected a string-to-string/number/boolean object." });
    return undefined;
  }
  const metadata: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean") {
      diagnostics.push({ severity: "error", field: `metadata.${key}`, message: "Expected string, number, or boolean." });
      continue;
    }
    metadata[key] = String(entry);
  }
  return metadata;
}

function optionalSkillTriggers(
  value: unknown,
  diagnostics: KilnConfigValidationDiagnostic[],
): readonly Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push({ severity: "error", field: "triggers", message: "Expected an array of event trigger objects." });
    return [];
  }
  const triggers: Record<string, unknown>[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry) || typeof entry.event !== "string" || entry.event.trim().length === 0) {
      diagnostics.push({ severity: "error", field: `triggers[${index}]`, message: "Expected an object with a non-empty event." });
      continue;
    }
    if (entry.filter !== undefined && !isRecord(entry.filter)) {
      diagnostics.push({ severity: "error", field: `triggers[${index}].filter`, message: "Expected an object." });
      continue;
    }
    triggers.push({ event: entry.event.trim(), ...(entry.filter === undefined ? {} : { filter: entry.filter }) });
  }
  return triggers;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  const beforeLines = before.trimEnd().split("\n");
  const afterLines = after.trimEnd().split("\n");
  return [`--- ${path}`, `+++ ${path}`, "@@ exact proposed change @@", ...buildLineDiff(beforeLines, afterLines), ""].join("\n");
}

function buildLineDiff(beforeLines: readonly string[], afterLines: readonly string[]): string[] {
  const lengths = Array.from({ length: beforeLines.length + 1 }, () =>
    Array.from({ length: afterLines.length + 1 }, () => 0));
  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lengths[beforeIndex]![afterIndex] = beforeLines[beforeIndex] === afterLines[afterIndex]
        ? lengths[beforeIndex + 1]![afterIndex + 1]! + 1
        : Math.max(lengths[beforeIndex + 1]![afterIndex]!, lengths[beforeIndex]![afterIndex + 1]!);
    }
  }
  const diff: string[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      diff.push(` ${beforeLines[beforeIndex]}`);
      beforeIndex += 1;
      afterIndex += 1;
    } else if (lengths[beforeIndex + 1]![afterIndex]! >= lengths[beforeIndex]![afterIndex + 1]!) {
      diff.push(`-${beforeLines[beforeIndex]}`);
      beforeIndex += 1;
    } else {
      diff.push(`+${afterLines[afterIndex]}`);
      afterIndex += 1;
    }
  }
  for (; beforeIndex < beforeLines.length; beforeIndex += 1) diff.push(`-${beforeLines[beforeIndex]}`);
  for (; afterIndex < afterLines.length; afterIndex += 1) diff.push(`+${afterLines[afterIndex]}`);
  return diff;
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
