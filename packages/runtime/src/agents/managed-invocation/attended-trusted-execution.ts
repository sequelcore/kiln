import type {
  ActionEffectEnvelope,
  ManagedAgentAdapterDescriptor,
  ManagedAgentCapabilitySnapshotInput,
  ManagedAgentInvocationRequest,
} from "@kilnai/core";
import type { AttendedTrustedExecutionLeaseAuthority } from "../../execution-kernel/attended-trusted-execution-lease-authority.js";
import type { ManagedChildAuthorityAdmissionContract } from "./child-authority-admission.js";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";

/** Runtime implementation revision for the first attended destructive path. */
export const MANAGED_ATTENDED_TRUSTED_EXECUTION_ENFORCEMENT_REVISION = "runtime-attended-trusted-execution-v1";

/**
 * Process-local context carried beside, never inside, managed invocation
 * records. Existing admission and effect authorization remain conjunctive.
 */
export interface ManagedAttendedTrustedExecutionContext {
  readonly authority: AttendedTrustedExecutionLeaseAuthority;
  readonly projectRuntimeId: `krp_${string}`;
  readonly compositionRevision: `sha256:${string}`;
  readonly harness: "codex";
  readonly routeId: string;
  readonly policyDigest: `sha256:${string}`;
  readonly enforcementRevision: typeof MANAGED_ATTENDED_TRUSTED_EXECUTION_ENFORCEMENT_REVISION;
  readonly requestedProfile: "trusted-full-access";
}

export function requireManagedAttendedTrustedExecution(input: {
  readonly now: Date;
  readonly request: ManagedAgentInvocationRequest;
  readonly adapterDescriptor: ManagedAgentAdapterDescriptor;
  readonly capabilitySnapshotInput: Pick<ManagedAgentCapabilitySnapshotInput, "routeId">;
  readonly childAuthorityAdmission?: ManagedChildAuthorityAdmissionContract;
  readonly economicDispatchPresent: boolean;
  readonly context?: ManagedAttendedTrustedExecutionContext;
}): ManagedAttendedTrustedExecutionContext | undefined {
  if (input.request.requestedAuthority !== "destructive") return undefined;

  const deny = (reason: string): never => {
    throw new ManagedAgentRuntimeAdmissionError(`Attended trusted execution denied before dispatch: ${reason}.`);
  };
  const context = input.context ?? deny("process-local lease authority is absent");
  const intent = input.request.executionIntent;
  if (intent?.attendance !== "attended" || intent.lifecycle !== "foreground") {
    deny("only attended foreground invocation is supported");
  }
  if (
    input.request.adapterKind !== "direct" ||
    input.request.executionMode !== "direct-provider" ||
    input.request.providerRoute.providerId !== "codex-oauth" ||
    input.adapterDescriptor.adapterKind !== "direct" ||
    input.adapterDescriptor.providerId !== "codex-oauth" ||
    !input.adapterDescriptor.supportedExecutionModes.includes("direct-provider")
  ) {
    deny("only the Runtime-controlled codex-oauth direct-provider route is supported");
  }
  if (input.economicDispatchPresent) deny("economic dispatch is unsupported");
  if (input.request.executionScope?.managedInvocationId !== undefined) {
    deny("nested invocation trees are unsupported");
  }
  const childAdmission =
    input.childAuthorityAdmission?.bundle ?? deny("the persisted parent authority admission is absent");
  const binding = context.authority.binding;
  const admittedCompositionRevision = childAdmission.configuration.turnRevision.revisionSetId;
  if (binding.projectRuntimeId !== context.projectRuntimeId) deny("project Runtime binding does not match");
  if (
    binding.compositionRevision !== context.compositionRevision ||
    context.compositionRevision !== admittedCompositionRevision
  ) {
    deny("admitted composition revision does not match");
  }
  if (binding.operatorSessionId !== input.request.parentSessionId) deny("operator session does not match");
  if (binding.invocationTreeId !== input.request.invocationId) deny("invocation tree does not match");
  if (context.harness !== "codex") deny("harness does not match");
  if (context.routeId !== input.capabilitySnapshotInput.routeId) deny("route does not match");
  if (context.policyDigest !== childAdmission.admissionId) deny("policy digest does not match");
  if (context.enforcementRevision !== MANAGED_ATTENDED_TRUSTED_EXECUTION_ENFORCEMENT_REVISION) {
    deny("enforcement revision does not match");
  }
  if (context.requestedProfile !== "trusted-full-access") deny("profile does not match");

  const lease = context.authority.currentLease ?? deny("active lease is absent");
  if (lease.status.kind !== "active") deny(`lease is ${lease.status.kind}`);
  if (input.now.getTime() < Date.parse(lease.issuedAt)) deny("lease is not yet valid");
  if (input.now.getTime() >= Date.parse(lease.expiresAt)) {
    context.authority.revoke();
    deny("lease is expired");
  }
  if (
    lease.operatorSessionId !== input.request.parentSessionId ||
    lease.invocationTreeId !== input.request.invocationId ||
    lease.projectRuntimeId !== context.projectRuntimeId ||
    lease.compositionRevision !== context.compositionRevision ||
    lease.harness !== context.harness ||
    lease.routeId !== context.routeId ||
    lease.policyDigest !== context.policyDigest ||
    lease.enforcementRevision !== context.enforcementRevision ||
    lease.profileCeiling !== context.requestedProfile
  ) {
    deny("lease binding does not match");
  }
  if (!sameNames(lease.allowedToolNames, input.request.authority.toolAuthority.allowedToolNames)) {
    deny("tool ceiling does not match");
  }
  if (!sameEffect(lease.effectCeiling, childAdmission.turn.effectCeiling)) {
    deny("effect ceiling does not match");
  }
  return context;
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort(compareCodeUnits);
  const rightSorted = [...right].sort(compareCodeUnits);
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function sameEffect(left: ActionEffectEnvelope, right: ActionEffectEnvelope): boolean {
  return (
    left.operation === right.operation &&
    left.reversibility === right.reversibility &&
    left.dataEgress === right.dataEgress &&
    left.identityUse === right.identityUse &&
    left.idempotency === right.idempotency &&
    sameNames(left.boundaries, right.boundaries) &&
    sameNames(left.consequences, right.consequences)
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
