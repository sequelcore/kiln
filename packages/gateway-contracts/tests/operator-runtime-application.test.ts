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
