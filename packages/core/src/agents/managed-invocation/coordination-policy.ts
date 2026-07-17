import type {
  ManagedAgentOrchestrationAvailability,
  ManagedAgentOrchestrationMode,
  ManagedAgentOrchestrationTaskRisk,
} from "./orchestration.js";

export const MANAGED_AGENT_COORDINATION_TOPOLOGIES = [
  "direct",
  "sequential",
  "centralized",
  "independent-review",
] as const;

export type ManagedAgentCoordinationTopology = typeof MANAGED_AGENT_COORDINATION_TOPOLOGIES[number];

export interface ManagedAgentCoordinationSignals {
  readonly governanceRecommendation: "direct" | "orchestrate";
  readonly workItemCount: number;
  readonly dependencyCount: number;
  readonly requiresIndependentReview: boolean;
  readonly taskRisk: ManagedAgentOrchestrationTaskRisk;
  readonly managedRouteCount: number;
  readonly maxParallelWorkers: number;
  readonly routeHealth: ManagedAgentOrchestrationAvailability;
  readonly budget: ManagedAgentOrchestrationAvailability;
  readonly workspace: ManagedAgentOrchestrationAvailability;
}

export type ManagedAgentCoordinationDecision =
  | {
    readonly status: "selected";
    readonly policyId: "managed-agent-coordination-v1";
    readonly topology: ManagedAgentCoordinationTopology;
    readonly orchestrationMode?: ManagedAgentOrchestrationMode;
    readonly maxConcurrentChildren: number;
    readonly reasons: readonly string[];
  }
  | {
    readonly status: "denied";
    readonly policyId: "managed-agent-coordination-v1";
    readonly reasons: readonly string[];
    readonly missingCapabilities: readonly string[];
  };

export function decideManagedAgentCoordination(
  input: ManagedAgentCoordinationSignals,
): ManagedAgentCoordinationDecision {
  const signals = validateSignals(input);
  if (
    signals.governanceRecommendation === "direct"
    && signals.workItemCount === 1
    && !signals.requiresIndependentReview
  ) {
    return selected("direct", 0, ["work is inside the direct-execution envelope"]);
  }

  const missingCapabilities = missingOrchestrationCapabilities(signals);
  if (missingCapabilities.length > 0) {
    return {
      status: "denied",
      policyId: "managed-agent-coordination-v1",
      reasons: missingCapabilities.map(missingCapabilityReason),
      missingCapabilities,
    };
  }

  if (signals.requiresIndependentReview) {
    const concurrency = Math.min(signals.workItemCount, signals.maxParallelWorkers);
    if (concurrency < 2) {
      return {
        status: "denied",
        policyId: "managed-agent-coordination-v1",
        reasons: ["independent review requires capacity for at least two children"],
        missingCapabilities: ["independent-review-capacity"],
      };
    }
    return selected(
      "independent-review",
      concurrency,
      ["verification requires evidence from an independent critic"],
      "review-swarm",
    );
  }

  if (signals.workItemCount === 1) {
    return selected(
      "sequential",
      1,
      ["governance requires managed execution for one bounded work item"],
      "background-job",
    );
  }

  const dependencyBound = signals.dependencyCount > 0;
  if (dependencyBound || signals.maxParallelWorkers === 1 || signals.taskRisk === "high") {
    return selected(
      "sequential",
      1,
      [
        ...(dependencyBound ? ["work item dependencies require ordered execution"] : []),
        ...(signals.maxParallelWorkers === 1 ? ["runtime capacity permits one managed child at a time"] : []),
        ...(signals.taskRisk === "high" ? ["high-risk work is serialized to bound authority and recovery"] : []),
      ],
      "decomposition",
    );
  }

  return selected(
    "centralized",
    Math.min(signals.workItemCount, signals.maxParallelWorkers),
    ["independent work items can execute concurrently under one parent integrator"],
    "decomposition",
  );
}

function selected(
  topology: ManagedAgentCoordinationTopology,
  maxConcurrentChildren: number,
  reasons: readonly string[],
  orchestrationMode?: ManagedAgentOrchestrationMode,
): ManagedAgentCoordinationDecision {
  return {
    status: "selected",
    policyId: "managed-agent-coordination-v1",
    topology,
    ...(orchestrationMode ? { orchestrationMode } : {}),
    maxConcurrentChildren,
    reasons,
  };
}

function missingOrchestrationCapabilities(
  signals: ManagedAgentCoordinationSignals,
): readonly string[] {
  return [
    ...(signals.managedRouteCount > 0 && signals.routeHealth === "available" ? [] : ["managed-route"]),
    ...(signals.budget === "available" ? [] : ["budget"]),
    ...(signals.workspace === "available" ? [] : ["workspace"]),
  ];
}

function missingCapabilityReason(capability: string): string {
  switch (capability) {
    case "managed-route":
      return "managed orchestration requires an available route";
    case "budget":
      return "managed orchestration requires available budget";
    case "workspace":
      return "managed orchestration requires an available workspace";
    default:
      return `managed orchestration requires ${capability}`;
  }
}

function validateSignals(input: ManagedAgentCoordinationSignals): ManagedAgentCoordinationSignals {
  requirePositiveInteger(input.workItemCount, "Managed coordination work item count must be greater than zero");
  requireNonNegativeInteger(input.dependencyCount, "Managed coordination dependency count must be non-negative");
  requireNonNegativeInteger(input.managedRouteCount, "Managed coordination route count must be non-negative");
  requirePositiveInteger(input.maxParallelWorkers, "Managed coordination parallel worker limit must be greater than zero");
  const maximumDependencies = input.workItemCount * (input.workItemCount - 1) / 2;
  if (input.dependencyCount > maximumDependencies) {
    throw new Error("Managed coordination dependency count exceeds the work item graph");
  }
  return { ...input };
}

function requirePositiveInteger(value: number, message: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(message);
  }
}

function requireNonNegativeInteger(value: number, message: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(message);
  }
}
