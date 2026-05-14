export type NativeCockpitHighDensityWorkloadStatus =
  | "missing"
  | "synthetic"
  | "real";

export interface NativeCockpitPreconditionReviewInput {
  readonly highDensityWorkloads: NativeCockpitHighDensityWorkloadStatus;
  readonly configProjectionStable: boolean;
  readonly gatewayEventStreams: boolean;
  readonly guiBaselineBenchmarks: boolean;
  readonly managedInvocationLifecycleEvents: boolean;
  readonly authorityProviderProjections: boolean;
  readonly gatewayMediatedCancellation: boolean;
}

export interface NativeCockpitPreconditionReview {
  readonly canStartContractPhase: boolean;
  readonly canStartReadOnlyPrototype: boolean;
  readonly missingForContractPhase: readonly string[];
  readonly missingForReadOnlyPrototype: readonly string[];
}

export function createNativeCockpitPreconditionReview(
  input: NativeCockpitPreconditionReviewInput,
): NativeCockpitPreconditionReview {
  const missingForContractPhase = [
    ...(input.highDensityWorkloads === "missing" ? ["high-density-workloads"] : []),
    ...(!input.configProjectionStable ? ["stable-config-projection"] : []),
    ...(!input.gatewayEventStreams ? ["gateway-event-streams"] : []),
    ...(!input.managedInvocationLifecycleEvents ? ["managed-invocation-lifecycle-events"] : []),
    ...(!input.authorityProviderProjections ? ["authority-provider-projections"] : []),
  ];
  const missingForReadOnlyPrototype = [
    ...missingForContractPhase,
    ...(!input.guiBaselineBenchmarks ? ["gui-baseline-benchmarks"] : []),
    ...(!input.gatewayMediatedCancellation ? ["gateway-mediated-cancellation"] : []),
  ];

  return {
    canStartContractPhase: missingForContractPhase.length === 0,
    canStartReadOnlyPrototype: missingForReadOnlyPrototype.length === 0,
    missingForContractPhase,
    missingForReadOnlyPrototype,
  };
}

export type NativeCockpitAction =
  | "inspect"
  | "replay"
  | "focus_session"
  | "filter_events"
  | "open_resource"
  | "cancel";

export interface NativeCockpitActionTarget {
  readonly instanceId?: string;
  readonly sessionId?: string;
  readonly eventId?: string;
  readonly resourceUri?: string;
  readonly workItemId?: string;
  readonly managedInvocationId?: string;
}

export interface NativeCockpitActionAdmissionInput {
  readonly action: NativeCockpitAction;
  readonly target: NativeCockpitActionTarget;
}

export function nativeCockpitActionAllowed(
  input: NativeCockpitActionAdmissionInput,
): boolean {
  if (!input.target.instanceId) return false;

  if (input.action === "inspect") return true;
  if (input.action === "filter_events") return true;
  if (input.action === "focus_session") return Boolean(input.target.sessionId);
  if (input.action === "replay") return Boolean(input.target.sessionId && input.target.eventId);
  if (input.action === "open_resource") return Boolean(input.target.resourceUri);
  if (input.action === "cancel") {
    return Boolean(
      input.target.sessionId
      && (input.target.workItemId || input.target.managedInvocationId),
    );
  }

  return false;
}

export interface NativeCockpitBenchmarkFixtureDefinition {
  readonly minimumInstanceCount: number;
  readonly minimumSessionCount: number;
  readonly minimumActiveManagedSessionCount: number;
  readonly minimumChildInvocationCount: number;
  readonly minimumEventCount: number;
  readonly requiresIdenticalOutput: boolean;
}

export const NATIVE_COCKPIT_BENCHMARK_FIXTURES = {
  singleSessionHeavy: {
    minimumInstanceCount: 1,
    minimumSessionCount: 1,
    minimumActiveManagedSessionCount: 1,
    minimumChildInvocationCount: 50,
    minimumEventCount: 100_000,
    requiresIdenticalOutput: true,
  },
  multiSession: {
    minimumInstanceCount: 1,
    minimumSessionCount: 10,
    minimumActiveManagedSessionCount: 3,
    minimumChildInvocationCount: 50,
    minimumEventCount: 100_000,
    requiresIdenticalOutput: true,
  },
  multiInstance: {
    minimumInstanceCount: 2,
    minimumSessionCount: 2,
    minimumActiveManagedSessionCount: 1,
    minimumChildInvocationCount: 0,
    minimumEventCount: 1,
    requiresIdenticalOutput: true,
  },
  projectionHotPath: {
    minimumInstanceCount: 1,
    minimumSessionCount: 1,
    minimumActiveManagedSessionCount: 0,
    minimumChildInvocationCount: 0,
    minimumEventCount: 100_000,
    requiresIdenticalOutput: true,
  },
} satisfies Record<string, NativeCockpitBenchmarkFixtureDefinition>;
