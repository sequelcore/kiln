import {
  MANAGED_AGENT_ADMISSION_PROFILES,
  type VoiceConfig,
} from "@kilnai/core";
import { KilnYamlError } from "../../../kiln-yaml.js";
import {
  isRecord,
  rejectUnknownFields,
  validateCanonicalId,
  validateOptionalStringArray,
  validateOptionalWriteMode,
} from "./shared.js";

export function validateAuthorityProfiles(value: unknown, operatorVoice: VoiceConfig | undefined): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new KilnYamlError("authorityProfiles must be an array");
  const ids = new Set<string>();
  value.forEach((profile, index) => {
    const path = `authorityProfiles[${index}]`;
    if (!isRecord(profile)) throw new KilnYamlError(`${path} must be an object`);
    rejectUnknownFields(profile, [
      "id", "admissionProfile", "voiceProfile", "workingDirectory", "timeoutMs", "tools", "memory",
      "readAuthority", "writeAuthority",
    ], path);
    validateCanonicalId(profile.id, `${path}.id`);
    if (ids.has(String(profile.id))) throw new KilnYamlError(`${path}.id must be unique`);
    ids.add(String(profile.id));
    if (!MANAGED_AGENT_ADMISSION_PROFILES.includes(profile.admissionProfile as never)) {
      throw new KilnYamlError(`${path}.admissionProfile is unsupported`);
    }
    if (profile.workingDirectory !== undefined && !["project", "isolated-worktree", "sandbox"].includes(String(profile.workingDirectory))) {
      throw new KilnYamlError(`${path}.workingDirectory is invalid`);
    }
    if (profile.timeoutMs !== undefined && (!Number.isSafeInteger(profile.timeoutMs) || Number(profile.timeoutMs) <= 0)) {
      throw new KilnYamlError(`${path}.timeoutMs must be a positive integer`);
    }
    validateManagedAgentVoiceProfile(profile.voiceProfile, `${path}.voiceProfile`, operatorVoice);
    validateAuthorityProfileTools(profile.tools, `${path}.tools`);
    validateAuthorityProfileMemory(profile.memory, `${path}.memory`);
    validateManagedAgentReadAuthority(profile.readAuthority, `${path}.readAuthority`);
    validateManagedAgentWriteAuthority(profile.writeAuthority, `${path}.writeAuthority`);
  });
}

function validateAuthorityProfileTools(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["allowed", "network", "writes"], path);
  validateOptionalStringArray(value.allowed, `${path}.allowed`);
  if (value.network !== undefined && typeof value.network !== "boolean") {
    throw new KilnYamlError(`${path}.network must be a boolean`);
  }
  if (value.writes !== undefined && typeof value.writes !== "boolean") {
    throw new KilnYamlError(`${path}.writes must be a boolean`);
  }
}

function validateAuthorityProfileMemory(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["access"], path);
  if (
    value.access !== undefined
    && value.access !== "none"
    && value.access !== "read-only"
    && value.access !== "write-proposals"
  ) {
    throw new KilnYamlError(`${path}.access must be "none", "read-only", or "write-proposals"`);
  }
}

export function validateManagedAgents(value: unknown, operatorVoice: VoiceConfig | undefined): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("managedAgents must be an object");
  }
  rejectUnknownFields(value, [
    "enabled",
    "defaultAuthorityProfileId",
    "defaultVoiceProfile",
    "worktreeLease",
    "requireApproval",
    "intents",
  ], "managedAgents");
  validateManagedAgentWorktreeLease(value.worktreeLease);
  validateManagedAgentVoiceProfile(value.defaultVoiceProfile, "managedAgents.defaultVoiceProfile", operatorVoice);
  validateManagedAgentIntents(value.intents);
}

function validateManagedAgentIntents(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0) {
    throw new KilnYamlError("managedAgents.intents must be a non-empty array");
  }
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const path = `managedAgents.intents[${index}]`;
    const intent = value[index];
    if (!isRecord(intent)) throw new KilnYamlError(`${path} must be an object`);
    rejectUnknownFields(intent, ["id", "purpose", "authorityProfileId", "target", "model", "workLimits", "paidUsage"], path);
    validateCanonicalId(intent.id, `${path}.id`);
    if (ids.has(String(intent.id))) throw new KilnYamlError(`${path}.id must be unique`);
    ids.add(String(intent.id));
    if (typeof intent.purpose !== "string" || intent.purpose.trim().length === 0 || intent.purpose.length > 2000) {
      throw new KilnYamlError(`${path}.purpose must be a non-empty string of at most 2000 characters`);
    }
    validateCanonicalId(intent.authorityProfileId, `${path}.authorityProfileId`);
    validateManagedAgentIntentSelection(intent.target, path, "target", "targetId");
    validateManagedAgentIntentSelection(intent.model, path, "model", "modelId");
    validateManagedAgentWorkLimits(intent.workLimits, `${path}.workLimits`);
    validateManagedAgentPaidUsage(intent.paidUsage, `${path}.paidUsage`);
  }
}

function validateManagedAgentIntentSelection(value: unknown, path: string, field: string, explicitKey: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError(`${path}.${field} must be an object`);
  rejectUnknownFields(value, ["mode", explicitKey], `${path}.${field}`);
  if (value.mode === "inherited") {
    if (Object.keys(value).length !== 1) throw new KilnYamlError(`${path}.${field}.inherited cannot carry explicit selection`);
    return;
  }
  if (value.mode !== "explicit") throw new KilnYamlError(`${path}.${field}.mode must be inherited or explicit`);
  validateCanonicalId(value[explicitKey], `${path}.${field}.${explicitKey}`);
}

function validateManagedAgentWorkLimits(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["maxTurns", "maxDurationMs", "maxConcurrency"], path);
  for (const key of ["maxTurns", "maxDurationMs", "maxConcurrency"] as const) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || Number(value[key]) <= 0)) {
      throw new KilnYamlError(`${path}.${key} must be a positive safe integer`);
    }
  }
}

function validateManagedAgentPaidUsage(value: unknown, path: string): void {
  if (value === undefined) return;
  if (value === "included-only" || value === "ask-before-spend" || value === "uncapped") return;
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be included-only, ask-before-spend, uncapped, or a cap object`);
  rejectUnknownFields(value, ["kind", "amount"], path);
  if (value.kind !== "cap") throw new KilnYamlError(`${path}.kind must be cap`);
  validateManagedAgentSpendAmount(value.amount, `${path}.amount`);
}

function validateManagedAgentSpendAmount(value: unknown, path: string): void {
  if (!isRecord(value)) throw new KilnYamlError(`${path} must be an object`);
  rejectUnknownFields(value, ["atoms", "scale", "unit", "scheme"], path);
  if (typeof value.atoms !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value.atoms)) {
    throw new KilnYamlError(`${path}.atoms must be canonical non-negative base-10`);
  }
  if (!Number.isSafeInteger(value.scale) || Number(value.scale) < 0 || Number(value.scale) > 18) {
    throw new KilnYamlError(`${path}.scale must be an integer from 0 to 18`);
  }
  validateCanonicalId(value.unit, `${path}.unit`);
  if (!isRecord(value.scheme)) throw new KilnYamlError(`${path}.scheme must be an object`);
  if (value.scheme.kind === "currency") {
    rejectUnknownFields(value.scheme, ["kind", "currency"], `${path}.scheme`);
    validateCanonicalId(value.scheme.currency, `${path}.scheme.currency`);
  } else if (value.scheme.kind === "credit") {
    rejectUnknownFields(value.scheme, ["kind", "creditSchemeId"], `${path}.scheme`);
    validateCanonicalId(value.scheme.creditSchemeId, `${path}.scheme.creditSchemeId`);
  } else {
    throw new KilnYamlError(`${path}.scheme.kind must be currency or credit for an enforceable cap`);
  }
}

export function validateManagedTargetReferences(
  managedAgents: unknown,
  targetCatalog: unknown,
  authorityProfiles: unknown,
): void {
  if (isRecord(managedAgents) && managedAgents.defaultAuthorityProfileId !== undefined) {
    const ids = new Set(Array.isArray(authorityProfiles)
      ? authorityProfiles.filter(isRecord).map((profile) => profile.id)
      : []);
    if (!ids.has(managedAgents.defaultAuthorityProfileId)) {
      throw new KilnYamlError("managedAgents.defaultAuthorityProfileId references an unknown authority profile");
    }
  }
  if (!isRecord(managedAgents) || !Array.isArray(managedAgents.intents)) return;
  const targets = isRecord(targetCatalog) && Array.isArray(targetCatalog.targets)
    ? targetCatalog.targets.filter(isRecord)
    : [];
  const authorityIds = new Set(Array.isArray(authorityProfiles)
    ? authorityProfiles.filter(isRecord).map((entry) => String(entry.id))
    : []);
  for (let index = 0; index < managedAgents.intents.length; index += 1) {
    const intent = managedAgents.intents[index];
    if (!isRecord(intent)) continue;
    const path = `managedAgents.intents[${index}]`;
    if (!authorityIds.has(String(intent.authorityProfileId))) {
      throw new KilnYamlError(`${path}.authorityProfileId references an unknown authority profile`);
    }
    const targetSelection = isRecord(intent.target) ? intent.target : undefined;
    const target = targetSelection?.mode === "explicit"
      ? targets.find((entry) => entry.id === targetSelection.targetId)
      : undefined;
    if (targetSelection?.mode === "explicit" && !target) {
      throw new KilnYamlError(`${path}.target.targetId references an unknown target`);
    }
    if (target && target.kind !== "direct") {
      throw new KilnYamlError(`${path}.target.targetId must reference a direct target`);
    }
    if (target && target.kind === "direct") {
      if (typeof target.accountPolicyId !== "string") {
        throw new KilnYamlError(`${path}.target.targetId must reference a direct target with an account policy`);
      }
      const economics = isRecord(target.economics) ? target.economics : undefined;
      if (!economics || economics.fallbackPosture !== "disabled" || economics.overagePosture !== "disabled") {
        throw new KilnYamlError(`${path}.target.targetId cannot activate fallback or overage without a new commitment`);
      }
    }
    const modelSelection = isRecord(intent.model) ? intent.model : undefined;
    if (modelSelection?.mode === "explicit") {
      const matchingTargets = target
        ? [target]
        : targets;
      if (!matchingTargets.some((candidate) => candidate.providerModelId === modelSelection.modelId)) {
        throw new KilnYamlError(`${path}.model.modelId does not match an admitted target model`);
      }
    }
  }
}

function validateManagedAgentReadAuthority(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  validateManagedAgentWorkspaceReadConfig(value.workspace, `${path}.workspace`);
}

function validateManagedAgentWorkspaceReadConfig(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  validateOptionalStringArray(value.allowedPaths, `${path}.allowedPaths`);
  validateOptionalStringArray(value.deniedPaths, `${path}.deniedPaths`);
}

function validateManagedAgentWorktreeLease(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("managedAgents.worktreeLease must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!["mode", "rootPath", "ref", "gitBinary"].includes(key)) {
      throw new KilnYamlError(`Unknown managedAgents.worktreeLease field: ${key}`);
    }
  }
  if (value.mode !== "git") {
    throw new KilnYamlError("managedAgents.worktreeLease.mode must be \"git\"");
  }
  if (typeof value.rootPath !== "string" || value.rootPath.trim().length === 0) {
    throw new KilnYamlError("managedAgents.worktreeLease.rootPath is required");
  }
  if (value.ref !== undefined && (typeof value.ref !== "string" || value.ref.trim().length === 0)) {
    throw new KilnYamlError("managedAgents.worktreeLease.ref must be a non-empty string");
  }
  if (value.gitBinary !== undefined && (typeof value.gitBinary !== "string" || value.gitBinary.trim().length === 0)) {
    throw new KilnYamlError("managedAgents.worktreeLease.gitBinary must be a non-empty string");
  }
}

function validateManagedAgentVoiceProfile(
  value: unknown,
  path: string,
  operatorVoice: VoiceConfig | undefined,
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KilnYamlError(`${path} must be a non-empty string`);
  }
  if (!operatorVoice?.ttsProfiles?.[value.trim()]) {
    throw new KilnYamlError(`${path} references unknown operatorVoice.ttsProfiles entry "${value.trim()}"`);
  }
}

function validateManagedAgentWriteAuthority(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  if (!isRecord(value.approval)) {
    throw new KilnYamlError(`${path}.approval is required`);
  }
  if (value.approval.mode !== "required-before-apply" && value.approval.mode !== "policy-approved") {
    throw new KilnYamlError(`${path}.approval.mode must be "required-before-apply" or "policy-approved"`);
  }
  validateOptionalStringArray(value.approval.evidenceUris, `${path}.approval.evidenceUris`);
  validateManagedAgentWorkspaceWriteConfig(value.workspace, `${path}.workspace`);
  validateManagedAgentMemoryWriteConfig(value.memory, `${path}.memory`);
  validateManagedAgentArtifactWriteConfig(value.artifacts, `${path}.artifacts`);
  validateManagedAgentToolWriteConfig(value.tools, `${path}.tools`);
}

function validateManagedAgentWorkspaceWriteConfig(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  validateOptionalWriteMode(value.mode, `${path}.mode`);
  validateOptionalStringArray(value.allowedPaths, `${path}.allowedPaths`);
  validateOptionalStringArray(value.deniedPaths, `${path}.deniedPaths`);
}

function validateManagedAgentMemoryWriteConfig(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  validateOptionalWriteMode(value.mode, `${path}.mode`);
  if (value.operations !== undefined) {
    if (!Array.isArray(value.operations) || value.operations.some((item) => !isManagedAgentMemoryWriteOperation(item))) {
      throw new KilnYamlError(`${path}.operations contains an unsupported memory write operation`);
    }
  }
}

function validateManagedAgentArtifactWriteConfig(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  validateOptionalWriteMode(value.mode, `${path}.mode`);
  validateOptionalStringArray(value.resourceUris, `${path}.resourceUris`);
  if (
    value.retention !== undefined
    && value.retention !== "none"
    && value.retention !== "session"
    && value.retention !== "durable"
    && value.retention !== "external"
  ) {
    throw new KilnYamlError(`${path}.retention must be "none", "session", "durable", or "external"`);
  }
}

function validateManagedAgentToolWriteConfig(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new KilnYamlError(`${path} must be an object`);
  }
  validateOptionalStringArray(value.allowed, `${path}.allowed`);
  validateOptionalStringArray(value.denied, `${path}.denied`);
}

function isManagedAgentMemoryWriteOperation(value: unknown): boolean {
  return value === "create"
    || value === "update"
    || value === "archive"
    || value === "forget"
    || value === "redact"
    || value === "promote";
}
