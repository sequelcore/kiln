import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/);
const opaqueRecord = z.record(z.string(), z.unknown());

/** Authenticated application commands for operator surfaces; never an MCP surface. */
export const OperatorRuntimeApplicationRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    schemaVersion: z.literal(1),
    operation: z.literal("managed-economic.acquire"),
    input: z.object({
      jobId: identifier,
      economicAttemptId: identifier,
      intentFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      snapshot: opaqueRecord,
      expectation: opaqueRecord,
      routeCapacity: z.array(opaqueRecord).max(1_024),
    }).strict(),
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    operation: z.literal("managed-economic.release-pre-fence"),
    jobId: identifier,
    economicAttemptId: identifier,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    operation: z.literal("managed-economic.fence-dispatch"),
    jobId: identifier,
    economicAttemptId: identifier,
    dispatchFenceId: identifier,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    operation: z.literal("managed-economic.settle-execution"),
    jobId: identifier,
    economicAttemptId: identifier,
    dispatchFenceId: identifier,
    settlement: opaqueRecord,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    operation: z.literal("managed-economic.record-settlement-pending"),
    jobId: identifier,
    economicAttemptId: identifier,
    dispatchFenceId: identifier,
    reason: z.string().trim().min(1).max(512),
  }).strict(),
]);

export type OperatorRuntimeApplicationRequest = z.infer<typeof OperatorRuntimeApplicationRequestSchema>;

export const OperatorRuntimeApplicationResponseSchema = z.discriminatedUnion("status", [
  z.object({
    schemaVersion: z.literal(1),
    status: z.literal("ok"),
    result: z.unknown(),
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    status: z.literal("error"),
    error: z.object({
      code: z.enum([
        "invalid_request",
        "principal_denied",
        "project_unavailable",
        "runtime_unavailable",
        "authority_rejected",
      ]),
      message: z.string().trim().min(1).max(512),
    }).strict(),
  }).strict(),
]);

export type OperatorRuntimeApplicationResponse = z.infer<typeof OperatorRuntimeApplicationResponseSchema>;
