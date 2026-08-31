import { describe, expect, it } from "vitest";
import {
  OperatorRuntimeApplicationRequestSchema,
  OperatorRuntimeApplicationResponseSchema,
} from "../src/index.js";

describe("operator runtime application protocol", () => {
  it("accepts the closed managed-economic authority operation set", () => {
    expect(OperatorRuntimeApplicationRequestSchema.parse({
      schemaVersion: 1,
      operation: "managed-economic.acquire",
      input: {
        jobId: "job-1",
        economicAttemptId: "attempt-1",
        intentFingerprint: `sha256:${"a".repeat(64)}`,
        snapshot: {},
        expectation: {},
        routeCapacity: [],
      },
    })).toEqual({
      schemaVersion: 1,
      operation: "managed-economic.acquire",
      input: {
        jobId: "job-1",
        economicAttemptId: "attempt-1",
        intentFingerprint: `sha256:${"a".repeat(64)}`,
        snapshot: {},
        expectation: {},
        routeCapacity: [],
      },
    });
    expect(OperatorRuntimeApplicationRequestSchema.parse({
      schemaVersion: 1,
      operation: "managed-economic.fence-dispatch",
      jobId: "job-1",
      economicAttemptId: "attempt-1",
      dispatchFenceId: "fence-1",
      actionClaim: {
        version: 1,
        attemptId: "attempt-1",
        intentFingerprint: `sha256:${"a".repeat(64)}`,
        admissionId: `sha256:${"b".repeat(64)}`,
        admissionBundle: { version: 1, sessionId: "session-1", turnId: "turn-1" },
        ownerGeneration: "owner-1",
        effectIdentity: "economic-dispatch-1",
      },
    }).operation).toBe("managed-economic.fence-dispatch");
  });

  it("rejects unknown operations and extra authority fields", () => {
    expect(OperatorRuntimeApplicationRequestSchema.safeParse({
      schemaVersion: 1,
      operation: "managed-economic.reset",
    }).success).toBe(false);
    expect(OperatorRuntimeApplicationRequestSchema.safeParse({
      schemaVersion: 1,
      operation: "managed-economic.release-pre-fence",
      jobId: "job-1",
      economicAttemptId: "attempt-1",
      ownerId: "caller-controlled",
    }).success).toBe(false);
  });

  it("accepts the closed Agent Task operation set without caller-controlled identity or routing", () => {
    expect(OperatorRuntimeApplicationRequestSchema.parse({
      schemaVersion: 1,
      operation: "agent-task.submit",
      input: {
        objective: "Review the changed boundary.",
        configuredAgentProfileId: "reviewer",
        idempotencyKey: "review-boundary-1",
      },
    })).toEqual({
      schemaVersion: 1,
      operation: "agent-task.submit",
      input: {
        objective: "Review the changed boundary.",
        configuredAgentProfileId: "reviewer",
        idempotencyKey: "review-boundary-1",
      },
    });
    for (const operation of ["agent-task.status", "agent-task.result", "agent-task.cancel", "agent-task.replay"] as const) {
      expect(OperatorRuntimeApplicationRequestSchema.parse({
        schemaVersion: 1,
        operation,
        jobId: "job-1",
      }).operation).toBe(operation);
    }
    expect(OperatorRuntimeApplicationRequestSchema.safeParse({
      schemaVersion: 1,
      operation: "agent-task.submit",
      input: {
        objective: "Review",
        configuredAgentProfileId: "reviewer",
        idempotencyKey: "review-1",
        callerId: "caller-controlled",
        providerId: "codex-oauth",
      },
    }).success).toBe(false);
  });

  it("accepts the bounded typed vision capability on Agent Task submission", () => {
    expect(OperatorRuntimeApplicationRequestSchema.parse({
      schemaVersion: 1,
      operation: "agent-task.submit",
      input: {
        objective: "Inspect the image evidence.",
        configuredAgentProfileId: "vision-reviewer",
        idempotencyKey: "vision-review-1",
        capability: {
          capabilityId: "vision.analyze",
          contract: "vision.analyze/v1",
          input: {
            resourceUris: ["kiln://project/artifacts/image-1"],
            instruction: "Summarize the visible evidence.",
          },
        },
      },
    })).toMatchObject({
      input: { capability: { capabilityId: "vision.analyze", contract: "vision.analyze/v1" } },
    });
    expect(OperatorRuntimeApplicationRequestSchema.safeParse({
      schemaVersion: 1,
      operation: "agent-task.submit",
      input: {
        objective: "Inspect",
        configuredAgentProfileId: "vision-reviewer",
        idempotencyKey: "vision-review-1",
        capability: {
          capabilityId: "vision.analyze",
          contract: "vision.analyze/v1",
          input: {
            resourceUris: ["kiln://project/artifacts/image-1", "kiln://project/artifacts/image-1"],
            instruction: "Summarize",
          },
        },
      },
    }).success).toBe(false);
    expect(OperatorRuntimeApplicationRequestSchema.safeParse({
      schemaVersion: 1,
      operation: "agent-task.submit",
      input: {
        objective: "Inspect",
        configuredAgentProfileId: "vision-reviewer",
        idempotencyKey: "vision-review-1",
        capability: {
          capabilityId: "vision.analyze",
          contract: "vision.analyze/v1",
          input: { resourceUris: ["https://example.invalid/image"], instruction: "Summarize" },
        },
      },
    }).success).toBe(false);
  });

  it("admits only explicit success or bounded failure responses", () => {
    expect(OperatorRuntimeApplicationResponseSchema.parse({
      schemaVersion: 1,
      status: "ok",
      result: { status: "committed" },
    }).status).toBe("ok");
    expect(OperatorRuntimeApplicationResponseSchema.parse({
      schemaVersion: 1,
      status: "error",
      error: {
        code: "runtime_unavailable",
        message: "Operator runtime application is unavailable.",
      },
    }).status).toBe("error");
    expect(OperatorRuntimeApplicationResponseSchema.safeParse({
      schemaVersion: 1,
      status: "error",
      error: { code: "secret-provider-error", message: "raw" },
    }).success).toBe(false);
  });
});
