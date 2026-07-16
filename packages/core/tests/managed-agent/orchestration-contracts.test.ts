import { describe, expect, it } from "vitest";
import {
  MANAGED_AGENT_ORCHESTRATION_MODES,
  admitManagedAgentOrchestrationRequest,
  buildManagedAgentBackgroundJobOrchestrationRequest,
  buildManagedAgentDecompositionOrchestrationRequest,
  buildManagedAgentFanOutOrchestrationRequest,
  buildManagedAgentOrchestrationResultEvidence,
  buildManagedAgentReviewSwarmOrchestrationRequest,
  buildManagedAgentRouteComparisonOrchestrationRequest,
  defineManagedAgentOrchestrationRequest,
} from "../../src/agents/managed-invocation/orchestration.js";

describe("managed agent orchestration contracts", () => {
  it("defines typed orchestration modes without provider-native vocabulary", () => {
    expect(MANAGED_AGENT_ORCHESTRATION_MODES).toEqual([
      "fan-out",
      "decomposition",
      "review-swarm",
      "route-comparison",
      "background-job",
    ]);
    expect(JSON.stringify(MANAGED_AGENT_ORCHESTRATION_MODES)).not.toMatch(/\bthread\b|\bpool\b|\bsubagent\b/iu);
  });

  it("builds a fan-out request with explicit child evidence and isolation policy", () => {
    const request = buildManagedAgentFanOutOrchestrationRequest({
      orchestrationId: "orchestration-1",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      requestedBy: "operator",
      requestSource: "cli:run-workers",
      task: "Review the current implementation from two independent angles.",
      childCount: 2,
      maxConcurrentChildren: 2,
      workingDirectoryMode: "isolated-worktree",
    });

    expect(request).toMatchObject({
      orchestrationId: "orchestration-1",
      mode: "fan-out",
      task: "Review the current implementation from two independent angles.",
      maxConcurrentChildren: 2,
      isolation: {
        required: true,
        workingDirectoryMode: "isolated-worktree",
      },
      mergePolicy: {
        mode: "compare-and-select",
        adoptionRequired: false,
        adoptionReadinessRequired: false,
      },
    });
    expect(request.expectedEvidence).toEqual([
      {
        kind: "result-handoff",
        label: "bounded child result handoff",
        required: true,
      },
      {
        kind: "comparison-summary",
        label: "parent comparison across child outputs",
        required: true,
      },
    ]);
    expect(request.childRequests).toEqual([
      expect.objectContaining({
        childId: "orchestration-1:child:1",
        ordinal: 1,
        roleIntent: "duplicate-candidate",
      }),
      expect.objectContaining({
        childId: "orchestration-1:child:2",
        ordinal: 2,
        roleIntent: "duplicate-candidate",
      }),
    ]);
  });

  it("builds non-fan-out mode adapters with explicit evidence and merge policy", () => {
    const baseInput = {
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      requestedBy: "operator",
      requestSource: "runtime:managed-agent",
      task: "Coordinate managed child work.",
      workingDirectoryMode: "isolated-worktree" as const,
    };

    const decomposition = buildManagedAgentDecompositionOrchestrationRequest({
      ...baseInput,
      orchestrationId: "decomposition-1",
      childPlans: [
        { roleIntent: "contract-mapping", task: "Map the contract surface." },
        { roleIntent: "test-mapping", task: "Map the regression surface." },
      ],
      maxConcurrentChildren: 2,
    });
    expect(decomposition).toMatchObject({
      orchestrationId: "decomposition-1",
      mode: "decomposition",
      isolation: {
        required: true,
        workingDirectoryMode: "isolated-worktree",
      },
      mergePolicy: {
        mode: "collect-all",
        adoptionRequired: true,
        adoptionReadinessRequired: true,
      },
    });
    expect(decomposition.expectedEvidence.map((evidence) => evidence.kind)).toEqual([
      "result-handoff",
      "completion-signal",
    ]);

    const reviewSwarm = buildManagedAgentReviewSwarmOrchestrationRequest({
      ...baseInput,
      orchestrationId: "review-swarm-1",
      childPlans: [
        { roleIntent: "code-review", task: "Review implementation risk." },
        { roleIntent: "boundary-review", task: "Review architecture boundaries." },
      ],
      maxConcurrentChildren: 2,
    });
    expect(reviewSwarm).toMatchObject({
      mode: "review-swarm",
      mergePolicy: {
        mode: "manual-review-required",
        adoptionRequired: false,
        adoptionReadinessRequired: false,
      },
    });
    expect(reviewSwarm.expectedEvidence.map((evidence) => evidence.kind)).toEqual([
      "review-findings",
      "comparison-summary",
    ]);

    const routeComparison = buildManagedAgentRouteComparisonOrchestrationRequest({
      ...baseInput,
      orchestrationId: "route-comparison-1",
      childPlans: [
        { roleIntent: "accuracy-route", task: "Run the high-accuracy route." },
        { roleIntent: "latency-route", task: "Run the low-latency route." },
      ],
      maxConcurrentChildren: 2,
    });
    expect(routeComparison).toMatchObject({
      mode: "route-comparison",
      mergePolicy: {
        mode: "compare-and-select",
        adoptionRequired: false,
        adoptionReadinessRequired: false,
      },
    });
    expect(routeComparison.expectedEvidence.map((evidence) => evidence.kind)).toEqual([
      "route-outcome",
      "comparison-summary",
    ]);

    const backgroundJob = buildManagedAgentBackgroundJobOrchestrationRequest({
      ...baseInput,
      orchestrationId: "background-job-1",
      roleIntent: "long-running-verification",
      task: "Run long verification in the background.",
    });
    expect(backgroundJob).toMatchObject({
      mode: "background-job",
      maxConcurrentChildren: 1,
      mergePolicy: {
        mode: "none",
        adoptionRequired: false,
        adoptionReadinessRequired: false,
      },
    });
    expect(backgroundJob.childRequests).toHaveLength(1);
    expect(backgroundJob.expectedEvidence.map((evidence) => evidence.kind)).toEqual([
      "completion-signal",
      "result-handoff",
    ]);
  });

  it("permits non-mutating review and decomposition in read-only routes", () => {
    const reviewSwarm = buildManagedAgentReviewSwarmOrchestrationRequest({
      orchestrationId: "review-swarm-read-only",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      requestedBy: "operator",
      requestSource: "runtime:managed-agent",
      task: "Review the implementation without changing the workspace.",
      workingDirectoryMode: "read-only",
      childPlans: [
        { roleIntent: "code-review", task: "Review correctness." },
        { roleIntent: "boundary-review", task: "Review architecture boundaries." },
      ],
      maxConcurrentChildren: 2,
    });

    expect(reviewSwarm.isolation).toMatchObject({
      required: true,
      workingDirectoryMode: "read-only",
    });
    const decomposition = buildManagedAgentDecompositionOrchestrationRequest({
      orchestrationId: "decomposition-read-only",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      requestedBy: "operator",
      requestSource: "runtime:managed-agent",
      task: "Decompose implementation work.",
      workingDirectoryMode: "read-only",
      childPlans: [
        { roleIntent: "contract-review", task: "Inspect the contract." },
        { roleIntent: "test-review", task: "Inspect the test surface." },
      ],
      maxConcurrentChildren: 2,
    });
    expect(decomposition.isolation).toMatchObject({
      required: true,
      workingDirectoryMode: "read-only",
    });
  });

  it("fails closed for malformed orchestration requests", () => {
    const request = buildManagedAgentFanOutOrchestrationRequest({
      orchestrationId: "orchestration-1",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      requestedBy: "operator",
      requestSource: "cli:run-workers",
      task: "Review the current implementation from two independent angles.",
      childCount: 2,
      maxConcurrentChildren: 2,
      workingDirectoryMode: "isolated-worktree",
    });

    expect(() => defineManagedAgentOrchestrationRequest({
      ...request,
      mode: "worker-pool" as typeof request.mode,
    })).toThrow("Unsupported managed orchestration mode: worker-pool");
    expect(() => buildManagedAgentFanOutOrchestrationRequest({
      orchestrationId: "orchestration-1",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      requestedBy: "operator",
      requestSource: "cli:run-workers",
      task: "Review the current implementation.",
      childCount: 1,
      maxConcurrentChildren: 1,
      workingDirectoryMode: "isolated-worktree",
    })).toThrow("Managed fan-out orchestration requires at least two children");
    expect(() => defineManagedAgentOrchestrationRequest({
      ...request,
      expectedEvidence: [],
    })).toThrow("Managed orchestration expected evidence is required");
    expect(() => defineManagedAgentOrchestrationRequest({
      ...request,
      isolation: {
        required: false,
        reason: "caller attempted shared checkout fan-out",
        workingDirectoryMode: "isolated-worktree",
      },
    })).toThrow("Managed fan-out orchestration requires isolated child workspaces");
    expect(() => defineManagedAgentOrchestrationRequest({
      ...request,
      isolation: {
        required: true,
        reason: "caller attempted shared checkout fan-out",
        workingDirectoryMode: "workspace-write",
      },
    })).toThrow("Managed fan-out orchestration requires isolated-worktree working directory mode");
  });

  it("fails closed when callers bypass mode adapters with invalid mode policy", () => {
    const baseInput = {
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      requestedBy: "operator",
      requestSource: "runtime:managed-agent",
      task: "Coordinate managed child work.",
      workingDirectoryMode: "isolated-worktree" as const,
    };
    const decomposition = buildManagedAgentDecompositionOrchestrationRequest({
      ...baseInput,
      orchestrationId: "decomposition-1",
      childPlans: [
        { roleIntent: "contract-mapping", task: "Map the contract surface." },
        { roleIntent: "test-mapping", task: "Map the regression surface." },
      ],
      maxConcurrentChildren: 2,
    });
    const reviewSwarm = buildManagedAgentReviewSwarmOrchestrationRequest({
      ...baseInput,
      orchestrationId: "review-swarm-1",
      childPlans: [
        { roleIntent: "code-review", task: "Review implementation risk." },
        { roleIntent: "boundary-review", task: "Review architecture boundaries." },
      ],
      maxConcurrentChildren: 2,
    });
    const routeComparison = buildManagedAgentRouteComparisonOrchestrationRequest({
      ...baseInput,
      orchestrationId: "route-comparison-1",
      childPlans: [
        { roleIntent: "accuracy-route", task: "Run the high-accuracy route." },
        { roleIntent: "latency-route", task: "Run the low-latency route." },
      ],
      maxConcurrentChildren: 2,
    });
    const backgroundJob = buildManagedAgentBackgroundJobOrchestrationRequest({
      ...baseInput,
      orchestrationId: "background-job-1",
      roleIntent: "long-running-verification",
      task: "Run long verification in the background.",
    });

    expect(() => defineManagedAgentOrchestrationRequest({
      ...decomposition,
      mergePolicy: {
        mode: "collect-all",
        adoptionRequired: false,
        adoptionReadinessRequired: true,
      },
    })).toThrow("Managed decomposition orchestration requires adoption");
    expect(() => defineManagedAgentOrchestrationRequest({
      ...decomposition,
      mergePolicy: {
        mode: "collect-all",
        adoptionRequired: true,
        adoptionReadinessRequired: false,
      },
    })).toThrow("Managed decomposition orchestration requires adoptionReadinessRequired=true");
    expect(() => defineManagedAgentOrchestrationRequest({
      ...reviewSwarm,
      mergePolicy: {
        mode: "collect-all",
        adoptionRequired: false,
        adoptionReadinessRequired: false,
      },
    })).toThrow("Managed review-swarm orchestration requires manual-review-required merge policy");
    expect(() => defineManagedAgentOrchestrationRequest({
      ...routeComparison,
      expectedEvidence: routeComparison.expectedEvidence.filter((evidence) => evidence.kind !== "route-outcome"),
    })).toThrow("Managed route-comparison orchestration requires route-outcome evidence");
    expect(() => defineManagedAgentOrchestrationRequest({
      ...decomposition,
      childRequests: decomposition.childRequests.map((child, index) => index === 0
        ? {
          ...child,
          expectedEvidence: [
            {
              kind: "review-findings",
              label: "wrong child evidence",
              required: true,
            },
          ],
        }
        : child),
    })).toThrow("Managed decomposition orchestration child decomposition-1:child:1 requires result-handoff evidence");
    expect(() => defineManagedAgentOrchestrationRequest({
      ...backgroundJob,
      childRequests: [
        ...backgroundJob.childRequests,
        {
          ...backgroundJob.childRequests[0]!,
          childId: "background-job-1:child:2",
          ordinal: 2,
        },
      ],
    })).toThrow("Managed background-job orchestration requires exactly one child");
  });

  it("admits fan-out only within configured limits and available runtime capacity", () => {
    const request = buildManagedAgentFanOutOrchestrationRequest({
      orchestrationId: "orchestration-1",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      requestedBy: "operator",
      requestSource: "cli:run-workers",
      task: "Review the current implementation from two independent angles.",
      childCount: 2,
      maxConcurrentChildren: 2,
      workingDirectoryMode: "isolated-worktree",
    });

    expect(admitManagedAgentOrchestrationRequest(request, {
      maxChildren: 2,
      routeHealth: "available",
      budget: "available",
      workspace: "available",
      taskRisk: "medium",
    })).toMatchObject({
      status: "admitted",
      orchestrationId: "orchestration-1",
      mode: "fan-out",
      admittedChildCount: 2,
    });

    expect(admitManagedAgentOrchestrationRequest(request, {
      maxChildren: 1,
      routeHealth: "available",
      budget: "available",
      workspace: "available",
      taskRisk: "medium",
    })).toEqual({
      status: "denied",
      orchestrationId: "orchestration-1",
      mode: "fan-out",
      reason: "managed orchestration admission failed",
      missingCapabilities: ["orchestration.maxChildren"],
    });

    expect(admitManagedAgentOrchestrationRequest(request, {
      maxChildren: 2,
      routeHealth: "unavailable",
      budget: "unavailable",
      workspace: "unavailable",
      taskRisk: "high",
    })).toEqual({
      status: "denied",
      orchestrationId: "orchestration-1",
      mode: "fan-out",
      reason: "managed orchestration admission failed",
      missingCapabilities: [
        "orchestration.routeHealth.available",
        "orchestration.budget.available",
        "orchestration.workspace.available",
        "orchestration.taskRisk.parallelAdmissible",
      ],
    });
  });

  it("admits high-risk orchestration only when execution is serialized", () => {
    const request = buildManagedAgentDecompositionOrchestrationRequest({
      orchestrationId: "high-risk-sequential",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      requestedBy: "operator",
      requestSource: "runtime:managed-agent",
      task: "Apply and verify an approved high-risk change.",
      workingDirectoryMode: "isolated-worktree",
      childPlans: [
        { roleIntent: "implementer", task: "Apply the approved change." },
        { roleIntent: "verifier", task: "Verify the applied change." },
      ],
      maxConcurrentChildren: 1,
    });

    expect(admitManagedAgentOrchestrationRequest(request, {
      maxChildren: 2,
      routeHealth: "available",
      budget: "available",
      workspace: "available",
      taskRisk: "high",
    })).toMatchObject({
      status: "admitted",
      orchestrationId: "high-risk-sequential",
      maxConcurrentChildren: 1,
    });
  });

  it("builds terminal orchestration result evidence without hiding partial failure", () => {
    const request = buildManagedAgentFanOutOrchestrationRequest({
      orchestrationId: "orchestration-1",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      requestedBy: "operator",
      requestSource: "cli:run-workers",
      task: "Review the current implementation from two independent angles.",
      childCount: 2,
      maxConcurrentChildren: 2,
      workingDirectoryMode: "isolated-worktree",
    });

    const evidence = buildManagedAgentOrchestrationResultEvidence(request, [
      {
        childId: "orchestration-1:child:1",
        ordinal: 1,
        lifecycleState: "completed",
        success: true,
      },
      {
        childId: "orchestration-1:child:2",
        ordinal: 2,
        lifecycleState: "failed",
        success: false,
        error: "child route failed",
      },
    ]);

    expect(evidence).toEqual({
      orchestrationId: "orchestration-1",
      mode: "fan-out",
      status: "partial",
      requestedChildCount: 2,
      succeededCount: 1,
      failedCount: 1,
      expectedEvidence: request.expectedEvidence,
      childResults: [
        {
          childId: "orchestration-1:child:1",
          ordinal: 1,
          lifecycleState: "completed",
          success: true,
          resourceUris: [],
          diagnosticUris: [],
          replayEvidenceUris: [],
        },
        {
          childId: "orchestration-1:child:2",
          ordinal: 2,
          lifecycleState: "failed",
          success: false,
          error: "child route failed",
          resourceUris: [],
          diagnosticUris: [],
          replayEvidenceUris: [],
        },
      ],
    });
  });

  it("rejects duplicate requested children and malformed child result sets", () => {
    const request = buildManagedAgentFanOutOrchestrationRequest({
      orchestrationId: "orchestration-1",
      parentSessionId: "session-parent",
      parentTurnId: "turn-parent",
      requestedBy: "operator",
      requestSource: "cli:run-workers",
      task: "Review the current implementation from two independent angles.",
      childCount: 2,
      maxConcurrentChildren: 2,
      workingDirectoryMode: "isolated-worktree",
    });

    expect(() => defineManagedAgentOrchestrationRequest({
      ...request,
      childRequests: [
        request.childRequests[0]!,
        {
          ...request.childRequests[1]!,
          childId: request.childRequests[0]!.childId,
        },
      ],
    })).toThrow("Managed orchestration child ids must be unique");
    expect(() => defineManagedAgentOrchestrationRequest({
      ...request,
      childRequests: [
        request.childRequests[0]!,
        {
          ...request.childRequests[1]!,
          ordinal: 1,
        },
      ],
    })).toThrow("Managed orchestration child ordinals must be unique");
    expect(() => buildManagedAgentOrchestrationResultEvidence(request, [
      {
        childId: request.childRequests[0]!.childId,
        ordinal: 1,
        lifecycleState: "completed",
        success: true,
      },
      {
        childId: request.childRequests[1]!.childId,
        ordinal: 2,
        lifecycleState: "completed",
        success: true,
      },
      {
        childId: "orchestration-1:child:3",
        ordinal: 3,
        lifecycleState: "completed",
        success: true,
      },
    ])).toThrow("Managed orchestration result includes unknown child result: orchestration-1:child:3");
    expect(() => buildManagedAgentOrchestrationResultEvidence(request, [
      {
        childId: request.childRequests[0]!.childId,
        ordinal: 1,
        lifecycleState: "completed",
        success: true,
      },
      {
        childId: request.childRequests[1]!.childId,
        ordinal: 2,
        lifecycleState: "running",
        success: true,
      },
    ])).toThrow("Managed orchestration child result lifecycle state must be terminal: running");
    expect(() => buildManagedAgentOrchestrationResultEvidence(request, [
      {
        childId: request.childRequests[0]!.childId,
        ordinal: 1,
        lifecycleState: "failed",
        success: true,
      },
      {
        childId: request.childRequests[1]!.childId,
        ordinal: 2,
        lifecycleState: "completed",
        success: true,
      },
    ])).toThrow("Managed orchestration child result success must use completed or recovered lifecycle state");
    expect(() => buildManagedAgentOrchestrationResultEvidence(request, [
      {
        childId: request.childRequests[0]!.childId,
        ordinal: 1,
        lifecycleState: "completed",
        success: false,
      },
      {
        childId: request.childRequests[1]!.childId,
        ordinal: 2,
        lifecycleState: "completed",
        success: true,
      },
    ])).toThrow("Managed orchestration child result successful lifecycle state must report success");
  });
});
