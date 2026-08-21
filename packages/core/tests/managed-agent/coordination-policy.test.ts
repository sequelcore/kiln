import { describe, expect, it } from "vitest";
import { decideManagedAgentCoordination } from "../../src/agents/managed-invocation/coordination-policy.js";

describe("managed agent coordination policy", () => {
  const capacity = {
    managedRouteCount: 2,
    maxParallelWorkers: 3,
    routeHealth: "available" as const,
    workspace: "available" as const,
  };

  it("keeps bounded work direct when governance permits it", () => {
    expect(decideManagedAgentCoordination({
      governanceRecommendation: "direct",
      workItemCount: 1,
      dependencyCount: 0,
      requiresIndependentReview: false,
      taskRisk: "low",
      ...capacity,
    })).toEqual({
      status: "selected",
      policyId: "managed-agent-coordination-v1",
      topology: "direct",
      maxConcurrentChildren: 0,
      reasons: ["no coordination trigger applies"],
    });
  });

  it("selects sequential decomposition for dependency-bound work", () => {
    expect(decideManagedAgentCoordination({
      governanceRecommendation: "orchestrate",
      workItemCount: 3,
      dependencyCount: 2,
      requiresIndependentReview: false,
      taskRisk: "medium",
      ...capacity,
    })).toMatchObject({
      status: "selected",
      topology: "sequential",
      orchestrationMode: "decomposition",
      maxConcurrentChildren: 1,
    });
  });

  it("selects centralized parallel decomposition only for independent work", () => {
    expect(decideManagedAgentCoordination({
      governanceRecommendation: "orchestrate",
      workItemCount: 4,
      dependencyCount: 0,
      requiresIndependentReview: false,
      taskRisk: "medium",
      ...capacity,
    })).toMatchObject({
      status: "selected",
      topology: "centralized",
      orchestrationMode: "decomposition",
      maxConcurrentChildren: 3,
    });
  });

  it("uses an independent review topology when verification requires a separate critic", () => {
    expect(decideManagedAgentCoordination({
      governanceRecommendation: "orchestrate",
      workItemCount: 2,
      dependencyCount: 0,
      requiresIndependentReview: true,
      taskRisk: "medium",
      ...capacity,
    })).toMatchObject({
      status: "selected",
      topology: "independent-review",
      orchestrationMode: "review-swarm",
      maxConcurrentChildren: 2,
    });
  });

  it("fails closed when orchestration has no admissible runtime route", () => {
    expect(decideManagedAgentCoordination({
      governanceRecommendation: "orchestrate",
      workItemCount: 2,
      dependencyCount: 0,
      requiresIndependentReview: false,
      taskRisk: "medium",
      ...capacity,
      managedRouteCount: 0,
    })).toEqual({
      status: "denied",
      policyId: "managed-agent-coordination-v1",
      reasons: ["managed orchestration requires an available route"],
      missingCapabilities: ["managed-route"],
    });
  });
});
