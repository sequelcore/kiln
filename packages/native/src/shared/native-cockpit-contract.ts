import type {
  OperatorCockpitAction,
  OperatorCockpitActionAdmissionInput,
  OperatorCockpitActionTarget,
  OperatorCockpitAttachTarget,
  OperatorCockpitReadOnlyAttachPlan,
  OperatorCockpitReadOnlyAttachPlanInput,
  OperatorCockpitReadOnlyProjection,
  OperatorCockpitReadOnlyProjectionInput,
  OperatorCockpitReadOnlyActionIntent,
  OperatorCockpitReadOnlyActionIntentInput,
} from "@kilnai/gateway-contracts";
import {
  createOperatorCockpitReadOnlyAttachPlan,
  createOperatorCockpitReadOnlyActionIntent,
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
export type NativeCockpitReadOnlyAttachPlanView = OperatorCockpitReadOnlyAttachPlan;
export type NativeCockpitReadOnlyView = OperatorCockpitReadOnlyProjection;
export type NativeCockpitReadOnlyActionIntentView = OperatorCockpitReadOnlyActionIntent;

export interface NativeCockpitReadOnlyAttachPlanInput extends OperatorCockpitReadOnlyAttachPlanInput {
  readonly surfaceId: string;
}

export interface NativeCockpitReadOnlyAttachPlan {
  readonly surfaceMode: "operator-cockpit";
  readonly surfaceId: string;
  readonly runtimeBoundary: "gateway-contracts";
  readonly networkAttach: "not-started";
  readonly mutationDispatch: "disabled";
  readonly plan: NativeCockpitReadOnlyAttachPlanView;
}

export function createNativeCockpitReadOnlyAttachPlan(
  input: NativeCockpitReadOnlyAttachPlanInput,
): NativeCockpitReadOnlyAttachPlan {
  return {
    surfaceMode: "operator-cockpit",
    surfaceId: input.surfaceId,
    runtimeBoundary: "gateway-contracts",
    networkAttach: "not-started",
    mutationDispatch: "disabled",
    plan: createOperatorCockpitReadOnlyAttachPlan({
      plannedAt: input.plannedAt,
      attachTargets: input.attachTargets,
    }),
  };
}

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

export interface NativeCockpitReadOnlyActionIntentInput extends OperatorCockpitReadOnlyActionIntentInput {
  readonly surfaceId: string;
}

export interface NativeCockpitReadOnlyActionIntent {
  readonly surfaceId: string;
  readonly runtimeBoundary: "gateway-contracts";
  readonly mutationDispatch: "disabled";
  readonly intent: NativeCockpitReadOnlyActionIntentView;
}

export function createNativeCockpitReadOnlyActionIntent(
  input: NativeCockpitReadOnlyActionIntentInput,
): NativeCockpitReadOnlyActionIntent {
  return {
    surfaceId: input.surfaceId,
    runtimeBoundary: "gateway-contracts",
    mutationDispatch: "disabled",
    intent: createOperatorCockpitReadOnlyActionIntent({
      action: input.action,
      requestedAt: input.requestedAt,
      target: input.target,
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
