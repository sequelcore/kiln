import type {
  OperatorCockpitAction,
  OperatorCockpitActionAdmissionInput,
  OperatorCockpitActionTarget,
  OperatorCockpitAttachTarget,
  OperatorCockpitReadOnlyProjection,
  OperatorCockpitReadOnlyProjectionInput,
} from "@kilnai/gateway-contracts";
import {
  operatorCockpitActionAllowed,
  projectOperatorCockpitReadOnlyView,
} from "@kilnai/gateway-contracts";

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

export type NativeCockpitAction = OperatorCockpitAction;
export type NativeCockpitActionTarget = OperatorCockpitActionTarget;
export type NativeCockpitActionAdmissionInput = OperatorCockpitActionAdmissionInput;

export function nativeCockpitActionAllowed(
  input: NativeCockpitActionAdmissionInput,
): boolean {
  return operatorCockpitActionAllowed(input);
}

export type NativeCockpitAttachTarget = OperatorCockpitAttachTarget;
export type NativeCockpitReadOnlyView = OperatorCockpitReadOnlyProjection;

export interface NativeCockpitReadOnlyProjectionInput extends OperatorCockpitReadOnlyProjectionInput {
  readonly surfaceId: string;
}

export interface NativeCockpitReadOnlyProjection {
  readonly surfaceMode: "operator-cockpit";
  readonly surfaceId: string;
  readonly runtimeBoundary: "gateway-contracts";
  readonly mutationDispatch: "disabled";
  readonly view: NativeCockpitReadOnlyView;
}

export function createNativeCockpitReadOnlyProjection(
  input: NativeCockpitReadOnlyProjectionInput,
): NativeCockpitReadOnlyProjection {
  return {
    surfaceMode: "operator-cockpit",
    surfaceId: input.surfaceId,
    runtimeBoundary: "gateway-contracts",
    mutationDispatch: "disabled",
    view: projectOperatorCockpitReadOnlyView({
      projectedAt: input.projectedAt,
      attachTargets: input.attachTargets,
      events: input.events,
    }),
  };
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
