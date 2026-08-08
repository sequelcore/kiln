import { z } from "zod";

/** First stable wire contract between native harness bridges and the operator runtime. */
export const OPERATOR_RUNTIME_PROTOCOL_VERSION = "1" as const;
export const OPERATOR_RUNTIME_AUDIENCE = "kiln-operator-runtime" as const;

export const OPERATOR_RUNTIME_HARNESSES = ["codex", "claude", "opencode"] as const;
export const OPERATOR_SUPERVISOR_LIFECYCLES = ["starting", "ready", "degraded", "stopping"] as const;
export const OPERATOR_SUPERVISOR_DIAGNOSTICS = ["none", "runtime_unavailable", "internal"] as const;
export const OPERATOR_PROJECT_RUNTIME_LIFECYCLES = ["starting", "ready", "recovering", "unavailable"] as const;
export const OPERATOR_PROJECT_RUNTIME_DIAGNOSTICS = [
  "none",
  "project_unavailable",
  "project_binding_changed",
  "recovery_failed",
  "internal",
] as const;

const epochSeconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).finite();
const portableIdentifier = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "must be a non-empty portable identifier");
const projectRuntimeId = z.string().regex(/^krp_[a-f0-9]{64}$/);
const markerDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const runtimeVersion = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/, "must be a bounded portable version identifier");

export const OperatorProjectBindingSchema = z
  .object({
    projectRuntimeId,
    markerDigest,
  })
  .strict();

export type OperatorProjectBinding = z.infer<typeof OperatorProjectBindingSchema>;

export const OperatorSupervisorIdentitySchema = z
  .object({
    protocolVersion: z.literal(OPERATOR_RUNTIME_PROTOCOL_VERSION),
    service: z.literal(OPERATOR_RUNTIME_AUDIENCE),
    instanceId: portableIdentifier,
    version: runtimeVersion,
    pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    startedAt: epochSeconds,
    port: z.number().int().min(1).max(65_535),
  })
  .strict();

export type OperatorSupervisorIdentity = z.infer<typeof OperatorSupervisorIdentitySchema>;

export const OperatorSessionClaimsSchema = z
  .object({
    protocolVersion: z.literal(OPERATOR_RUNTIME_PROTOCOL_VERSION),
    audience: z.literal(OPERATOR_RUNTIME_AUDIENCE),
    projectRuntimeId,
    markerDigest,
    harness: z.enum(OPERATOR_RUNTIME_HARNESSES),
    sessionId: portableIdentifier,
    issuedAt: epochSeconds,
    expiresAt: epochSeconds,
  })
  .strict();

export type OperatorRuntimeHarness = z.infer<typeof OperatorSessionClaimsSchema>["harness"];
export type OperatorSessionClaims = z.infer<typeof OperatorSessionClaimsSchema>;

export const OperatorSupervisorStatusSchema = z
  .object({
    protocolVersion: z.literal(OPERATOR_RUNTIME_PROTOCOL_VERSION),
    identity: OperatorSupervisorIdentitySchema,
    lifecycle: z.enum(OPERATOR_SUPERVISOR_LIFECYCLES),
    diagnostic: z.enum(OPERATOR_SUPERVISOR_DIAGNOSTICS),
    activeProjectRuntimeCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export type OperatorSupervisorLifecycle = z.infer<typeof OperatorSupervisorStatusSchema>["lifecycle"];
export type OperatorSupervisorDiagnostic = z.infer<typeof OperatorSupervisorStatusSchema>["diagnostic"];
export type OperatorSupervisorStatus = z.infer<typeof OperatorSupervisorStatusSchema>;

export const OperatorProjectRuntimeStatusSchema = z
  .object({
    protocolVersion: z.literal(OPERATOR_RUNTIME_PROTOCOL_VERSION),
    binding: OperatorProjectBindingSchema,
    lifecycle: z.enum(OPERATOR_PROJECT_RUNTIME_LIFECYCLES),
    diagnostic: z.enum(OPERATOR_PROJECT_RUNTIME_DIAGNOSTICS),
  })
  .strict();

export type OperatorProjectRuntimeLifecycle = z.infer<typeof OperatorProjectRuntimeStatusSchema>["lifecycle"];
export type OperatorProjectRuntimeDiagnostic = z.infer<typeof OperatorProjectRuntimeStatusSchema>["diagnostic"];
export type OperatorProjectRuntimeStatus = z.infer<typeof OperatorProjectRuntimeStatusSchema>;
