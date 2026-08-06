import type { TrustedExecutionEnforcement } from "./trusted-execution-integrity.js";

export type TrustedExecutionEnforcementInput =
  | { readonly harness: "codex" }
  | { readonly harness: "claude-code"; readonly allowDangerouslySkipPermissions: boolean }
  | { readonly harness: "opencode"; readonly permissionDefault: string };

export function describeTrustedExecutionEnforcement(
  input: TrustedExecutionEnforcementInput,
): TrustedExecutionEnforcement {
  switch (input.harness) {
    case "codex":
      return {
        approvalControl: "enforced",
        filesystemSandbox: "enforced",
        networkBoundary: "enforced",
        strength: "strong",
      };
    case "claude-code":
      return {
        approvalControl: input.allowDangerouslySkipPermissions ? "enforced" : "unknown",
        filesystemSandbox: "not-enforced",
        networkBoundary: "not-enforced",
        strength: "rules-only",
      };
    case "opencode":
      return {
        approvalControl:
          input.permissionDefault === "allow" || input.permissionDefault === "deny" ? "enforced" : "unknown",
        filesystemSandbox: "not-enforced",
        networkBoundary: "not-enforced",
        strength: "rules-only",
      };
  }
}
