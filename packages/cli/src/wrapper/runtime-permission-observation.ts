import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { TrustedExecutionProfile } from "@kilnai/core";
import type { ProjectStateBinding } from "../application/project-state-root.js";
import { resolveProjectStateBinding } from "../application/project-state-root.js";
import {
  assertPrivateStateFileTarget,
  ensurePrivateStateDirectory,
} from "../application/private-project-state-filesystem.js";
import { readNativeProjectionInstallState } from "../config/native-projection-state.js";

export const RUNTIME_PERMISSION_EVIDENCE_SCHEMA = "kiln.runtime-permission-evidence" as const;
export const RUNTIME_PERMISSION_EVIDENCE_VERSION = 3 as const;
const HARNESS_IDS = ["claude-code", "codex", "opencode"] as const;
const COMPONENT_IDS = ["approvalControl", "filesystemSandbox", "networkBoundary"] as const;
const TARGET_IDS = { "claude-code": "claude-settings", codex: "codex-config", opencode: "opencode-config" } as const;
const RECEIPT_FILE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.json$/iu;

export type RuntimePermissionObservationHarness = typeof HARNESS_IDS[number];
export type RuntimePermissionComponent = typeof COMPONENT_IDS[number];
export interface RuntimePermissionVersionEvidence { readonly kind: "sdk" | "executable"; readonly version: string }

export interface RuntimePermissionComponentValues {
  readonly approvalControl: string;
  readonly filesystemSandbox: string;
  readonly networkBoundary: string;
}

export interface RuntimePermissionComponentEvidence {
  readonly requestedDigest: string;
  readonly observedDigest?: string;
  readonly proof: "proven" | "inferred" | "contradictory";
}

export interface CodexAppServerRuntimeIdentity {
  readonly protocol: "codex-app-server-v2";
  readonly executableDigest: string;
  readonly processId: number;
  readonly threadDigest: string;
}

interface RuntimePermissionBinding {
  readonly harness: RuntimePermissionObservationHarness;
  readonly sessionDigest: string;
  readonly targetId: string;
  readonly projectionDigest: string;
  readonly effectivePolicyDigest: string;
  readonly profile: TrustedExecutionProfile;
}

export interface RuntimePermissionRequestedEvidence extends RuntimePermissionBinding {
  readonly schema: typeof RUNTIME_PERMISSION_EVIDENCE_SCHEMA;
  readonly version: typeof RUNTIME_PERMISSION_EVIDENCE_VERSION;
  readonly kind: "requested";
  readonly source: "runtime-request";
  readonly proof: "inferred";
  readonly requestedAt: string;
  readonly components: Readonly<Record<RuntimePermissionComponent, { readonly requestedDigest: string }>>;
  readonly runtimeVersion?: RuntimePermissionVersionEvidence;
}

export interface RuntimePermissionObservedEvidence extends RuntimePermissionBinding {
  readonly schema: typeof RUNTIME_PERMISSION_EVIDENCE_SCHEMA;
  readonly version: typeof RUNTIME_PERMISSION_EVIDENCE_VERSION;
  readonly kind: "observed";
  readonly requestDigest: string;
  readonly source: "runtime-observation";
  readonly proof: "proven" | "inferred" | "contradictory";
  readonly requestedAt: string;
  readonly observedAt: string;
  readonly verifiedAt: string;
  readonly components: Readonly<Record<RuntimePermissionComponent, RuntimePermissionComponentEvidence>>;
  readonly runtimeIdentity?: CodexAppServerRuntimeIdentity;
  readonly runtimeVersion?: RuntimePermissionVersionEvidence;
}

export interface RuntimePermissionRequestDraft {
  readonly harness: RuntimePermissionObservationHarness;
  readonly sessionId: string;
  readonly profile: TrustedExecutionProfile;
  readonly requestedAt: Date;
  readonly componentValues: RuntimePermissionComponentValues;
  readonly runtimeVersion?: RuntimePermissionVersionEvidence;
}

export interface RuntimePermissionObservationInput {
  readonly observedAt: Date;
  readonly proof?: "inferred";
  readonly componentValues?: RuntimePermissionComponentValues;
  readonly runtimeIdentity?: CodexAppServerRuntimeIdentity;
  readonly runtimeVersion?: RuntimePermissionVersionEvidence;
}

export interface RuntimePermissionObservationWriter {
  readonly recordRequested: (draft: RuntimePermissionRequestDraft) => Promise<RuntimePermissionRequestedEvidence>;
  readonly recordObserved: (requested: RuntimePermissionRequestedEvidence, input: RuntimePermissionObservationInput) => Promise<RuntimePermissionObservedEvidence>;
}

export interface RuntimePermissionEvidencePair {
  readonly requested: RuntimePermissionRequestedEvidence;
  readonly observed?: RuntimePermissionObservedEvidence;
}

export interface RuntimePermissionObservationStore extends RuntimePermissionObservationWriter {
  readonly evidenceDirectory: string;
  readonly readLatestExact: (input: { readonly harness: RuntimePermissionObservationHarness; readonly targetId: string; readonly projectionDigest: string }) => Promise<RuntimePermissionEvidencePair | undefined>;
}

export function deriveClaudeRuntimePermissionRequest(input: { readonly sessionId: string; readonly permissionMode: "default" | "acceptEdits" | "bypassPermissions" | "plan"; readonly allowDangerouslySkipPermissions: boolean; readonly requestedAt: Date; readonly runtimeVersion?: RuntimePermissionVersionEvidence }): RuntimePermissionRequestDraft {
  const profile: TrustedExecutionProfile = input.permissionMode === "bypassPermissions"
    ? input.allowDangerouslySkipPermissions ? "trusted-full-access" : "workspace-write"
    : input.permissionMode === "acceptEdits" ? "workspace-write" : "restricted";
  return {
    harness: "claude-code", sessionId: input.sessionId, profile, requestedAt: input.requestedAt,
    componentValues: {
      approvalControl: `permission-mode:${input.permissionMode};skip:${input.allowDangerouslySkipPermissions}`,
      filesystemSandbox: "unsupported",
      networkBoundary: "unsupported",
    },
    ...(input.runtimeVersion ? { runtimeVersion: input.runtimeVersion } : {}),
  };
}

export function deriveCodexRuntimePermissionRequest(input: { readonly sessionId: string; readonly approvalMode: "never" | "on-request" | "on-failure" | "untrusted"; readonly sandboxMode: "read-only" | "workspace-write" | "danger-full-access"; readonly requestedAt: Date; readonly runtimeVersion?: RuntimePermissionVersionEvidence }): RuntimePermissionRequestDraft {
  return {
    harness: "codex", sessionId: input.sessionId,
    profile: profileFromPolicy(input.approvalMode, input.sandboxMode), requestedAt: input.requestedAt,
    componentValues: codexRuntimePermissionComponentValues(input.approvalMode, input.sandboxMode),
    ...(input.runtimeVersion ? { runtimeVersion: input.runtimeVersion } : {}),
  };
}

export function deriveOpenCodeRuntimePermissionRequest(input: { readonly sessionId: string; readonly permissionRules: readonly { readonly permission: string; readonly action: "ask" | "allow" | "deny" }[]; readonly requestedAt: Date; readonly runtimeVersion?: RuntimePermissionVersionEvidence }): RuntimePermissionRequestDraft {
  return {
    harness: "opencode", sessionId: input.sessionId,
    profile: deriveOpenCodeTrustedExecutionProfile(input.permissionRules), requestedAt: input.requestedAt,
    componentValues: {
      approvalControl: JSON.stringify(input.permissionRules),
      filesystemSandbox: "unsupported",
      networkBoundary: "unsupported",
    },
    ...(input.runtimeVersion ? { runtimeVersion: input.runtimeVersion } : {}),
  };
}

export function deriveOpenCodeTrustedExecutionProfile(rules: readonly { readonly permission: string; readonly action: "ask" | "allow" | "deny" }[]): TrustedExecutionProfile {
  return rules.some((rule) => rule.permission === "*" && rule.action === "allow") && rules.every((rule) => rule.action === "allow") ? "workspace-write" : "restricted";
}

export interface RuntimePermissionObservationStoreInput {
  readonly projectPath: string;
  /** Explicit binding seam for composition and hermetic tests. */
  readonly projectStateBinding?: ProjectStateBinding;
  readonly evidenceDirectory?: string;
  /** Explicit private root when an overridden evidence directory remains project-owned. */
  readonly privateStateRoot?: string;
  /** Private directory containing the native projection install-state record. */
  readonly projectionStateDirectory?: string;
}

export function createRuntimePermissionObservationStore(
  input: RuntimePermissionObservationStoreInput,
): RuntimePermissionObservationStore {
  const stateBinding = input.projectStateBinding ?? resolveProjectStateBinding(input.projectPath);
  const evidenceDirectory = resolve(input.evidenceDirectory ?? join(stateBinding.evidencePath, "runtime-permission-observations"));
  const projectionStateDirectory = resolve(input.projectionStateDirectory ?? stateBinding.projectionsPath);
  const privateStateRoot = input.privateStateRoot ?? (input.evidenceDirectory === undefined ? stateBinding.projectStateRoot : undefined);
  const write = async (value: RuntimePermissionRequestedEvidence | RuntimePermissionObservedEvidence): Promise<void> => {
    if (!isEvidence(value)) throw new Error("Runtime permission evidence failed strict validation.");
    const directory = join(evidenceDirectory, value.harness);
    const timestamp = value.kind === "requested" ? value.requestedAt : value.verifiedAt;
    const name = `${timestamp.replace(/[:.]/gu, "-")}-${randomUUID()}.json`;
    const finalPath = join(directory, name);
    const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
    if (privateStateRoot !== undefined) {
      await ensurePrivateStateDirectory(privateStateRoot, directory, true);
      await assertPrivateStateFileTarget(privateStateRoot, finalPath);
      await assertPrivateStateFileTarget(privateStateRoot, temporary);
    } else {
      await mkdir(directory, { recursive: true });
    }
    try {
      const handle = await open(temporary, "wx");
      try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, finalPath);
    } finally { await rm(temporary, { force: true }); }
  };
  return {
    evidenceDirectory,
    recordRequested: async (draft) => {
      const target = readNativeProjectionInstallState(projectionStateDirectory).targets[TARGET_IDS[draft.harness]];
      if (!target?.permissionIntegrity || target.permissionIntegrity.harness !== draft.harness) {
        throw new Error(`No exact native permission projection is installed for ${draft.harness}.`);
      }
      const requested: RuntimePermissionRequestedEvidence = {
        schema: RUNTIME_PERMISSION_EVIDENCE_SCHEMA, version: RUNTIME_PERMISSION_EVIDENCE_VERSION, kind: "requested",
        harness: draft.harness, sessionDigest: digest(draft.sessionId), targetId: target.targetId,
        projectionDigest: target.contentHash, effectivePolicyDigest: policyDigest(draft.harness, draft.profile), profile: draft.profile,
        source: "runtime-request", proof: "inferred", requestedAt: draft.requestedAt.toISOString(),
        components: requestedComponents(draft.componentValues),
        ...(draft.runtimeVersion ? { runtimeVersion: normalizeVersion(draft.runtimeVersion) } : {}),
      };
      await write(requested);
      return requested;
    },
    recordObserved: async (requested, observed) => {
      if (!isRequested(requested)) throw new Error("Observed runtime permission evidence requires an exact requested receipt.");
      if (observed.componentValues !== undefined && observed.runtimeIdentity === undefined) {
        throw new Error("Proven runtime permission evidence requires an exact runtime identity.");
      }
      if (observed.componentValues === undefined && observed.runtimeIdentity !== undefined) {
        throw new Error("Runtime identity cannot substitute for component observations.");
      }
      const timestamp = observed.observedAt.toISOString();
      const components = observed.componentValues === undefined
        ? inferredComponents(requested.components)
        : observedComponents(requested.components, observed.componentValues);
      const proof = COMPONENT_IDS.every((component) => components[component].proof === "proven")
        ? "proven" as const
        : COMPONENT_IDS.some((component) => components[component].proof === "contradictory")
          ? "contradictory" as const
          : "inferred" as const;
      const value: RuntimePermissionObservedEvidence = {
        ...binding(requested), schema: RUNTIME_PERMISSION_EVIDENCE_SCHEMA, version: RUNTIME_PERMISSION_EVIDENCE_VERSION,
        kind: "observed", requestDigest: digestStable(requested), source: "runtime-observation", proof,
        requestedAt: requested.requestedAt, observedAt: timestamp, verifiedAt: timestamp,
        components,
        ...(observed.runtimeIdentity ? { runtimeIdentity: normalizeRuntimeIdentity(observed.runtimeIdentity) } : {}),
        ...(observed.runtimeVersion ?? requested.runtimeVersion ? { runtimeVersion: normalizeVersion(observed.runtimeVersion ?? requested.runtimeVersion!) } : {}),
      };
      await write(value);
      return value;
    },
    readLatestExact: (expected) => readLatestExact(evidenceDirectory, expected),
  };
}

function binding(value: RuntimePermissionBinding): RuntimePermissionBinding { return { harness: value.harness, sessionDigest: value.sessionDigest, targetId: value.targetId, projectionDigest: value.projectionDigest, effectivePolicyDigest: value.effectivePolicyDigest, profile: value.profile }; }
function policyDigest(harness: RuntimePermissionObservationHarness, profile: TrustedExecutionProfile): string { return digestStable({ harness, profile }); }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function digestStable(value: unknown): string { return digest(JSON.stringify(value, Object.keys(value as object).sort())); }
function normalizeVersion(value: RuntimePermissionVersionEvidence): RuntimePermissionVersionEvidence { const version = value.version.trim(); if (!version) throw new Error("Runtime version evidence must not be empty."); return { kind: value.kind, version }; }

export function codexRuntimePermissionComponentValues(
  approvalMode: "never" | "on-request" | "on-failure" | "untrusted",
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access",
): RuntimePermissionComponentValues {
  return {
    approvalControl: `approval:${approvalMode}`,
    filesystemSandbox: `sandbox:${sandboxMode}`,
    networkBoundary: `network:${sandboxMode === "danger-full-access" ? "enabled" : "restricted"}`,
  };
}

function requestedComponents(values: RuntimePermissionComponentValues): RuntimePermissionRequestedEvidence["components"] {
  return Object.fromEntries(
    COMPONENT_IDS.map((component) => [component, { requestedDigest: digest(values[component]) }]),
  ) as RuntimePermissionRequestedEvidence["components"];
}

function inferredComponents(
  requested: RuntimePermissionRequestedEvidence["components"],
): RuntimePermissionObservedEvidence["components"] {
  return Object.fromEntries(COMPONENT_IDS.map((component) => [component, {
    requestedDigest: requested[component].requestedDigest,
    proof: "inferred" as const,
  }])) as RuntimePermissionObservedEvidence["components"];
}

function observedComponents(
  requested: RuntimePermissionRequestedEvidence["components"],
  values: RuntimePermissionComponentValues,
): RuntimePermissionObservedEvidence["components"] {
  return Object.fromEntries(COMPONENT_IDS.map((component) => {
    const observedDigest = digest(values[component]);
    const requestedDigest = requested[component].requestedDigest;
    return [component, {
      requestedDigest,
      observedDigest,
      proof: observedDigest === requestedDigest ? "proven" as const : "contradictory" as const,
    }];
  })) as RuntimePermissionObservedEvidence["components"];
}

function normalizeRuntimeIdentity(value: CodexAppServerRuntimeIdentity): CodexAppServerRuntimeIdentity {
  if (value.protocol !== "codex-app-server-v2" || !isDigest(value.executableDigest) || !isDigest(value.threadDigest)
    || !Number.isSafeInteger(value.processId) || value.processId <= 0) {
    throw new Error("Runtime identity evidence is invalid.");
  }
  return { ...value };
}

async function readLatestExact(directory: string, expected: { readonly harness: RuntimePermissionObservationHarness; readonly targetId: string; readonly projectionDigest: string }): Promise<RuntimePermissionEvidencePair | undefined> {
  let names: string[];
  try { names = (await readdir(join(directory, expected.harness))).filter((name) => RECEIPT_FILE.test(name)); } catch { return undefined; }
  const values: Array<RuntimePermissionRequestedEvidence | RuntimePermissionObservedEvidence> = [];
  for (const name of names) {
    try { const parsed: unknown = JSON.parse(await readFile(join(directory, expected.harness, name), "utf8")); if (isEvidence(parsed) && parsed.harness === expected.harness && parsed.targetId === expected.targetId && parsed.projectionDigest === expected.projectionDigest) values.push(parsed); } catch { /* malformed evidence is ignored */ }
  }
  const requests = values.filter(isRequested).sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
  const requested = requests[0];
  if (!requested) return undefined;
  const observed = values.filter(isObserved).filter((item) => item.requestDigest === digestStable(requested) && sameBinding(item, requested)).sort((a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt))[0];
  return { requested, ...(observed ? { observed } : {}) };
}

function sameBinding(a: RuntimePermissionBinding, b: RuntimePermissionBinding): boolean { return a.harness === b.harness && a.sessionDigest === b.sessionDigest && a.targetId === b.targetId && a.projectionDigest === b.projectionDigest && a.effectivePolicyDigest === b.effectivePolicyDigest && a.profile === b.profile; }
function isRequested(value: unknown): value is RuntimePermissionRequestedEvidence { return isEvidenceBase(value) && value.kind === "requested" && value.source === "runtime-request" && value.proof === "inferred" && typeof value.requestedAt === "string" && isIso(value.requestedAt) && isRequestedComponents(value.components); }
function isObserved(value: unknown): value is RuntimePermissionObservedEvidence { return isEvidenceBase(value) && value.kind === "observed" && value.source === "runtime-observation" && (value.proof === "proven" || value.proof === "inferred" || value.proof === "contradictory") && typeof value.requestDigest === "string" && isDigest(value.requestDigest) && typeof value.requestedAt === "string" && typeof value.observedAt === "string" && typeof value.verifiedAt === "string" && isIso(value.requestedAt) && isIso(value.observedAt) && value.observedAt === value.verifiedAt && isObservedComponents(value.components) && (value.proof !== "proven" || (value.runtimeIdentity !== undefined && isRuntimeIdentity(value.runtimeIdentity))); }
function isEvidence(value: unknown): value is RuntimePermissionRequestedEvidence | RuntimePermissionObservedEvidence { return isRequested(value) || isObserved(value); }
function isEvidenceBase(value: unknown): value is Record<string, unknown> { if (!isRecord(value)) return false; return value.schema === RUNTIME_PERMISSION_EVIDENCE_SCHEMA && value.version === RUNTIME_PERMISSION_EVIDENCE_VERSION && typeof value.harness === "string" && HARNESS_IDS.includes(value.harness as RuntimePermissionObservationHarness) && typeof value.sessionDigest === "string" && isDigest(value.sessionDigest) && typeof value.targetId === "string" && typeof value.projectionDigest === "string" && isDigest(value.projectionDigest) && typeof value.effectivePolicyDigest === "string" && isDigest(value.effectivePolicyDigest) && typeof value.profile === "string" && ["restricted", "workspace-write", "trusted-full-access"].includes(value.profile); }
function isRequestedComponents(value: unknown): value is RuntimePermissionRequestedEvidence["components"] { if (!isRecord(value)) return false; return COMPONENT_IDS.every((component) => { const entry = value[component]; return isRecord(entry) && typeof entry.requestedDigest === "string" && isDigest(entry.requestedDigest); }); }
function isObservedComponents(value: unknown): value is RuntimePermissionObservedEvidence["components"] { if (!isRecord(value)) return false; return COMPONENT_IDS.every((component) => { const entry = value[component]; return isRecord(entry) && typeof entry.requestedDigest === "string" && isDigest(entry.requestedDigest) && (entry.observedDigest === undefined || (typeof entry.observedDigest === "string" && isDigest(entry.observedDigest))) && (entry.proof === "proven" || entry.proof === "inferred" || entry.proof === "contradictory"); }); }
function isRuntimeIdentity(value: unknown): value is CodexAppServerRuntimeIdentity { return isRecord(value) && value.protocol === "codex-app-server-v2" && typeof value.executableDigest === "string" && isDigest(value.executableDigest) && typeof value.threadDigest === "string" && isDigest(value.threadDigest) && typeof value.processId === "number" && Number.isSafeInteger(value.processId) && value.processId > 0; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isDigest(value: string): boolean { return /^[0-9a-f]{64}$/u.test(value); }
function isIso(value: string): boolean { return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function profileFromPolicy(approval: "never" | "on-request" | "on-failure" | "untrusted", sandbox: "read-only" | "workspace-write" | "danger-full-access"): TrustedExecutionProfile { if (approval === "never" && sandbox === "danger-full-access") return "trusted-full-access"; if (sandbox === "workspace-write" || approval === "never") return "workspace-write"; return "restricted"; }
