import { compareManagedAgentExternalRuntimeAttachment } from "./external-runtime-attachment.js";
import type { ManagedAgentExternalRuntimeAttachmentIdentity } from "./external-runtime-attachment.js";
import type { ManagedAgentAdmissionProfile, ManagedAgentRequestedAuthority } from "./index.js";

declare const capacityIdentityBrand: unique symbol;
declare const credentialRevisionIdBrand: unique symbol;

/** Stable physical account identity. It is intentionally absent from route admission snapshots. */
export type CapacityIdentity = string & { readonly [capacityIdentityBrand]: "CapacityIdentity" };
/** Immutable credential content revision, never a capacity key. */
export type CredentialRevisionId = string & { readonly [credentialRevisionIdBrand]: "CredentialRevisionId" };

export function createCapacityIdentity(value: string): CapacityIdentity {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._:-]*$/u.test(value)) {
    throw new TypeError("CapacityIdentity must be a canonical lowercase identifier.");
  }
  return value as CapacityIdentity;
}

export function createCredentialRevisionId(value: string): CredentialRevisionId {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError("CredentialRevisionId must be exactly 64 lowercase hexadecimal characters.");
  }
  return value as CredentialRevisionId;
}

export const MANAGED_ROUTE_ADAPTER_KINDS = ["direct-provider", "native-harness", "sdk", "cli-harness", "governed-external-runtime"] as const;
export type ManagedRouteAdapterKind = typeof MANAGED_ROUTE_ADAPTER_KINDS[number];
export type RouteAuthority = Exclude<ManagedAgentRequestedAuthority, "auto">;
export type RouteProofStatus = "live-proven" | "configured" | "unproven";
export type RouteEvidenceFreshness = "fresh" | "stale";

/** Stable capacity requirement. Account selection remains owned by the atomic reservation path. */
export type RouteCapacityRequirement =
  | { readonly kind: "accountless" }
  | { readonly kind: "policy-bound"; readonly accountPolicyId: string };

/** Sanitized aggregate capacity evidence. It never contains an account identity or credential. */
export interface CapacitySnapshot {
  readonly accountPolicyId: string;
  readonly availability: "available" | "exhausted" | "unknown";
  readonly freshness: RouteEvidenceFreshness;
  readonly observedAt: string;
  readonly expiresAt: string;
}

/** #34 commitment requirement; settlement outcomes stay owned by ManagedEconomicSettlement. */
export type RouteSettlementContract =
  | { readonly kind: "not-required" }
  | {
    readonly kind: "managed-economic-selection";
    readonly contractVersion: "managed-economic-v1";
    readonly policyIds: readonly string[];
    readonly pendingSettlement: "required";
    readonly recovery: "required";
  };

export interface RouteCapability {
  readonly identity: { readonly routeId: string; readonly revision: string };
  readonly target: { readonly providerId: string; readonly modelId: string };
  /** Catalog mechanism contract identity; materialized adapters retain their own descriptor identity. */
  readonly adapter: { readonly kind: ManagedRouteAdapterKind; readonly capabilityId: string; readonly capabilityVersion: string };
  readonly authorityCeiling: RouteAuthority;
  readonly toolNames: readonly string[];
  readonly supportsRecursion: boolean;
  readonly supportsAttachments: boolean;
  readonly supportsWrite: boolean;
  readonly externalRuntimeAttachment?: ManagedAgentExternalRuntimeAttachmentIdentity;
  readonly proof:
    | { readonly status: "configured" | "unproven"; readonly source: string; readonly provenProfiles: readonly ManagedAgentAdmissionProfile[] }
    | { readonly status: "live-proven"; readonly source: string; readonly freshness: RouteEvidenceFreshness; readonly observedAt: string; readonly expiresAt: string; readonly provenProfiles: readonly ManagedAgentAdmissionProfile[] };
  readonly capacity: RouteCapacityRequirement;
  readonly settlement: RouteSettlementContract;
}

/** Caller authority only narrows this envelope; it deliberately has no route/provider selectors. */
export interface CallerAuthorityProfile {
  readonly authorityCeiling: RouteAuthority;
  readonly allowedToolNames: readonly string[];
  readonly allowsRecursion: boolean;
  readonly allowsAttachments: boolean;
  readonly allowsWrite: boolean;
}

export interface RequestedWorkContract {
  /** Injected time keeps proof and capacity admission replay-stable. */
  readonly evaluatedAt: string;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly requestedAuthority: RouteAuthority;
  readonly requiredToolNames: readonly string[];
  readonly requiresRecursion: boolean;
  readonly requiresAttachments: boolean;
  readonly requiresWrite: boolean;
  readonly requestedExternalRuntimeAttachment?: ManagedAgentExternalRuntimeAttachmentIdentity;
  readonly minimumProof: Exclude<RouteProofStatus, "unproven">;
}

export type RouteAdmissionRejectionCode =
  | "authority-exceeds-caller-ceiling" | "authority-exceeds-route-ceiling" | "missing-tool"
  | "recursion-not-allowed-by-caller" | "recursion-not-supported-by-route"
  | "attachments-not-allowed-by-caller" | "attachments-not-supported-by-route"
  | "external-runtime-attachment-missing" | "external-runtime-attachment-mismatch" | "external-runtime-attachment-unsupported-route"
  | "write-not-allowed-by-caller" | "write-not-supported-by-route"
  | "proof-insufficient" | "proof-stale" | "proof-unknown"
  | "profile-unproven"
  | "capacity-policy-mismatch" | "capacity-exhausted" | "capacity-stale" | "capacity-unknown";

export interface RouteAdmissionRejection {
  readonly code: RouteAdmissionRejectionCode;
  readonly requiredToolName?: string;
  readonly requiredProof?: Exclude<RouteProofStatus, "unproven">;
  readonly profile?: ManagedAgentAdmissionProfile;
}

export type RouteAdmissionDecision =
  | { readonly status: "admitted"; readonly route: RouteCapability; readonly effectiveAuthority: RouteAuthority; readonly allowedToolNames: readonly string[] }
  | { readonly status: "unavailable" | "unresolved"; readonly routeId: string; readonly reasons: readonly RouteAdmissionRejection[] };

export interface AdmitManagedRouteInput {
  readonly route: RouteCapability;
  readonly work: RequestedWorkContract;
  readonly caller: CallerAuthorityProfile;
  /** Optional aggregate evidence only; absent evidence defers policy-bound capacity to atomic reservation. */
  readonly capacitySnapshot?: CapacitySnapshot;
}

/** Pure admission over supplied evidence. It never selects an account or materializes an adapter. */
export function admitManagedRoute(input: AdmitManagedRouteInput): RouteAdmissionDecision {
  const { route, work, caller, capacitySnapshot } = input;
  validateRoute(route);
  const evaluatedAt = parseTime(work.evaluatedAt, "evaluatedAt");
  validateWork(work);
  validateCaller(caller);
  const reasons: RouteAdmissionRejection[] = [];
  if (rank(work.requestedAuthority) > rank(caller.authorityCeiling)) reasons.push({ code: "authority-exceeds-caller-ceiling" });
  if (rank(work.requestedAuthority) > rank(route.authorityCeiling)) reasons.push({ code: "authority-exceeds-route-ceiling" });
  const callerTools = new Set(caller.allowedToolNames);
  const routeTools = new Set(route.toolNames);
  for (const toolName of unique(work.requiredToolNames)) {
    if (!callerTools.has(toolName) || !routeTools.has(toolName)) reasons.push({ code: "missing-tool", requiredToolName: toolName });
  }
  if (work.requiresRecursion && !caller.allowsRecursion) reasons.push({ code: "recursion-not-allowed-by-caller" });
  if (work.requiresRecursion && !route.supportsRecursion) reasons.push({ code: "recursion-not-supported-by-route" });
  if (work.requiresAttachments && !caller.allowsAttachments) reasons.push({ code: "attachments-not-allowed-by-caller" });
  if (work.requiresAttachments && !route.supportsAttachments) reasons.push({ code: "attachments-not-supported-by-route" });
  if (work.requestedExternalRuntimeAttachment !== undefined) appendAttachmentRejection(route, work, reasons);
  if (work.requiresWrite && !caller.allowsWrite) reasons.push({ code: "write-not-allowed-by-caller" });
  if (work.requiresWrite && !route.supportsWrite) reasons.push({ code: "write-not-supported-by-route" });
  appendProofRejection(route, work, evaluatedAt, reasons);
  appendCapacityRejection(route.capacity, capacitySnapshot, evaluatedAt, reasons);
  if (reasons.length > 0) return { status: reasons.some(isUnresolved) ? "unresolved" : "unavailable", routeId: route.identity.routeId, reasons };
  return { status: "admitted", route, effectiveAuthority: work.requestedAuthority, allowedToolNames: route.toolNames.filter((name) => callerTools.has(name)) };
}

function appendAttachmentRejection(route: RouteCapability, work: RequestedWorkContract, reasons: RouteAdmissionRejection[]): void {
  const comparison = compareManagedAgentExternalRuntimeAttachment(route.externalRuntimeAttachment, work.requestedExternalRuntimeAttachment);
  if (comparison === "missing") reasons.push({ code: "external-runtime-attachment-missing" });
  if (comparison === "mismatch") reasons.push({ code: "external-runtime-attachment-mismatch" });
  if (comparison === "unsupported-route") reasons.push({ code: "external-runtime-attachment-unsupported-route" });
}

function appendProofRejection(route: RouteCapability, work: RequestedWorkContract, evaluatedAt: number, reasons: RouteAdmissionRejection[]): void {
  if (route.proof.status === "unproven") reasons.push({ code: "proof-unknown" });
  else if (route.proof.status === "live-proven" && (route.proof.freshness === "stale" || parseTime(route.proof.expiresAt, "proof.expiresAt") <= evaluatedAt)) reasons.push({ code: "proof-stale" });
  else if (rankProof(route.proof.status) < rankProof(work.minimumProof)) reasons.push({ code: "proof-insufficient", requiredProof: work.minimumProof });
  if (!route.proof.provenProfiles.includes(work.profile)) reasons.push({ code: "profile-unproven", profile: work.profile });
}

function appendCapacityRejection(capacity: RouteCapacityRequirement, snapshot: CapacitySnapshot | undefined, evaluatedAt: number, reasons: RouteAdmissionRejection[]): void {
  if (snapshot === undefined) return;
  validateCapacitySnapshot(snapshot);
  if (capacity.kind !== "policy-bound" || capacity.accountPolicyId !== snapshot.accountPolicyId) {
    reasons.push({ code: "capacity-policy-mismatch" });
    return;
  }
  if (snapshot.freshness === "stale" || parseTime(snapshot.expiresAt, "capacity.expiresAt") <= evaluatedAt) reasons.push({ code: "capacity-stale" });
  else if (snapshot.availability === "exhausted") reasons.push({ code: "capacity-exhausted" });
  else if (snapshot.availability === "unknown") reasons.push({ code: "capacity-unknown" });
}

function isUnresolved(reason: RouteAdmissionRejection): boolean {
  return reason.code === "proof-stale" || reason.code === "proof-unknown" || reason.code === "capacity-stale" || reason.code === "capacity-unknown";
}

function validateRoute(route: RouteCapability): void {
  for (const value of [route.identity.routeId, route.identity.revision, route.target.providerId, route.target.modelId, route.adapter.capabilityId, route.adapter.capabilityVersion, route.proof.source]) requireText(value, "route value");
  requireAuthority(route.authorityCeiling, "route authority ceiling");
  if (!MANAGED_ROUTE_ADAPTER_KINDS.includes(route.adapter.kind)) throw new TypeError("Unknown managed route adapter kind.");
  for (const profile of route.proof.provenProfiles) requireProfile(profile, "proof proven profile");
  if (route.proof.status === "live-proven") {
    const proofExpiresAt = parseTime(route.proof.expiresAt, "proof.expiresAt");
    if (proofExpiresAt < parseTime(route.proof.observedAt, "proof.observedAt")) throw new TypeError("proof.expiresAt must not precede proof.observedAt.");
  }
  if (route.capacity.kind === "policy-bound") {
    requireText(route.capacity.accountPolicyId, "account policy id");
  }
}

function validateCapacitySnapshot(snapshot: CapacitySnapshot): void {
  requireText(snapshot.accountPolicyId, "capacity account policy id");
  const expiresAt = parseTime(snapshot.expiresAt, "capacity.expiresAt");
  if (expiresAt < parseTime(snapshot.observedAt, "capacity.observedAt")) throw new TypeError("capacity.expiresAt must not precede capacity.observedAt.");
}

function validateWork(work: RequestedWorkContract): void { requireAuthority(work.requestedAuthority, "requested authority"); requireProfile(work.profile, "work profile"); for (const name of work.requiredToolNames) requireText(name, "required tool name"); }
function validateCaller(caller: CallerAuthorityProfile): void { requireAuthority(caller.authorityCeiling, "caller authority ceiling"); for (const name of caller.allowedToolNames) requireText(name, "allowed tool name"); }
function rank(authority: RouteAuthority): number { return authority === "read_only" ? 0 : authority === "audited" ? 1 : 2; }
function rankProof(status: RouteProofStatus): number { return status === "unproven" ? 0 : status === "configured" ? 1 : 2; }
function parseTime(value: string, field: string): number { const timestamp = Date.parse(value); if (!Number.isFinite(timestamp)) throw new TypeError(`${field} must be an ISO-compatible timestamp.`); return timestamp; }
function requireAuthority(value: RouteAuthority, field: string): void { if (value !== "read_only" && value !== "audited" && value !== "destructive") throw new TypeError(`${field} must be explicit.`); }
function requireProfile(value: ManagedAgentAdmissionProfile, field: string): void { if (!["foundation-readonly-plan", "foundation-propose-writes", "foundation-apply-approved-writes", "foundation-memory-write-proposals", "diagnostic-only", "comparison-only", "rejected"].includes(value)) throw new TypeError(`${field} is invalid.`); }
function requireText(value: string, field: string): void { if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${field} must not be empty.`); }
function unique(values: readonly string[]): readonly string[] { return [...new Set(values)]; }
