import { classifyTrustedExecutionIntegrity } from "@kilnai/core";
import { type TrustedExecutionIntegrity, TrustedExecutionIntegritySchema } from "@kilnai/gateway-contracts";

/** Native projection snapshots are evidence and must never carry executable authority. */
export function withoutPersistedTrustedExecutionAuthority(
  input: unknown,
  targetId: string,
  source: string,
): TrustedExecutionIntegrity {
  const parsed = TrustedExecutionIntegritySchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid permission integrity for '${targetId}' at ${source}`);
  }
  if (parsed.data.authorization.status !== "authorized") {
    return parsed.data;
  }

  const authorization = {
    status: "unavailable" as const,
    revocable: true,
    reason: "persisted-authorization-is-not-executable",
  };
  const classification = classifyTrustedExecutionIntegrity({
    harness: parsed.data.harness,
    desired: parsed.data.desired,
    persistedNative: parsed.data.persistedNative,
    sessionOverride: parsed.data.sessionOverride,
    effectiveRuntime: parsed.data.effectiveRuntime,
    enforcement: parsed.data.enforcement,
    authorization,
    semanticLoss: parsed.data.semanticLoss,
    semanticLimitations: parsed.data.semanticLimitations,
    observation: "complete",
  }).classification;
  return TrustedExecutionIntegritySchema.parse({
    ...parsed.data,
    authorization,
    classification,
    remediationRequiresApproval: true,
    recommendation: "Attach a current attended-session lease before treating trusted execution as authorized.",
  });
}
