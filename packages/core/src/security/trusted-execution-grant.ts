import { basename } from "node:path";
import {
  readTrustedExecutionAuthorization,
  type TrustedExecutionHarness,
  writeTrustedExecutionAuthorization,
} from "./trusted-execution-authorization-store.js";
import { describeTrustedExecutionEnforcement } from "./trusted-execution-enforcement.js";
import {
  authorizeTrustedExecutionIntent,
  type TrustedExecutionAuthorization,
  type TrustedExecutionEnforcement,
  type TrustedExecutionProfile,
} from "./trusted-execution-integrity.js";

export interface TrustedExecutionGrantPlan {
  readonly harness: TrustedExecutionHarness;
  readonly projectPath: string;
  readonly currentProfile: TrustedExecutionProfile;
  readonly requestedProfile: TrustedExecutionProfile;
  readonly enforcement: TrustedExecutionEnforcement;
  readonly confirmationKind: "binary" | "typed-basename";
  readonly basename?: string;
}
export function planTrustedExecutionGrant(input: {
  readonly harness: TrustedExecutionHarness;
  readonly projectPath: string;
  readonly requestedProfile: TrustedExecutionProfile;
  readonly baseDir?: string;
}): TrustedExecutionGrantPlan {
  const currentProfile =
    readTrustedExecutionAuthorization(input.harness, input.projectPath, input.baseDir)?.profile ?? "restricted";
  const enforcement =
    input.harness === "codex"
      ? describeTrustedExecutionEnforcement({ harness: "codex" })
      : input.harness === "claude-code"
        ? describeTrustedExecutionEnforcement({
            harness: "claude-code",
            allowDangerouslySkipPermissions: input.requestedProfile === "trusted-full-access",
          })
        : describeTrustedExecutionEnforcement({
            harness: "opencode",
            permissionDefault: input.requestedProfile === "trusted-full-access" ? "allow" : "ask",
          });
  const confirmationKind = input.requestedProfile === "trusted-full-access" ? "typed-basename" : "binary";
  return {
    harness: input.harness,
    projectPath: input.projectPath,
    currentProfile,
    requestedProfile: input.requestedProfile,
    enforcement,
    confirmationKind,
    ...(confirmationKind === "typed-basename" ? { basename: basename(input.projectPath) } : {}),
  };
}
export function finalizeTrustedExecutionGrant(
  plan: TrustedExecutionGrantPlan,
  confirmation: { readonly approved: boolean; readonly operatorId: string; readonly authorizedAt: string },
  baseDir?: string,
): TrustedExecutionAuthorization {
  const authorization = authorizeTrustedExecutionIntent({
    source: "operator-local",
    currentProfile: plan.currentProfile,
    requestedProfile: plan.requestedProfile,
    operatorApproved: confirmation.approved,
    revocable: true,
    operatorId: confirmation.operatorId,
    authorizedAt: confirmation.authorizedAt,
  });
  if (authorization.status === "authorized" || authorization.status === "narrowed")
    writeTrustedExecutionAuthorization(
      plan.harness,
      plan.projectPath,
      { profile: plan.requestedProfile, authorization },
      baseDir,
    );
  return authorization;
}
export function revokeTrustedExecutionGrant(
  harness: TrustedExecutionHarness,
  projectPath: string,
  confirmation: { readonly operatorId: string; readonly authorizedAt: string },
  baseDir?: string,
): { readonly authorization: TrustedExecutionAuthorization; readonly hadExistingGrant: boolean } {
  const record = readTrustedExecutionAuthorization(harness, projectPath, baseDir);
  const authorization = authorizeTrustedExecutionIntent({
    source: "operator-local",
    currentProfile: record?.profile,
    requestedProfile: "restricted",
    operatorApproved: true,
    revocable: true,
    operatorId: confirmation.operatorId,
    authorizedAt: confirmation.authorizedAt,
  });
  if (record)
    writeTrustedExecutionAuthorization(harness, projectPath, { profile: "restricted", authorization }, baseDir);
  return { authorization, hadExistingGrant: record !== undefined };
}
