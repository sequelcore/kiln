import type { CapabilityAnnotations, ToolAuthorizer, ToolAuthorizationResult } from "@kilnai/core";
import type { KilnPermissionPolicy } from "./session.js";

/**
 * Translates a CLI KilnPermissionPolicy into orchestrator ToolAuthorizationResult calls.
 * Implements ToolAuthorizer so ModeBOrchestrator respects CLI permission rules.
 */
export class PermissionPolicyAuthorizer implements ToolAuthorizer {
  private readonly approval: KilnPermissionPolicy["approval"];

  constructor(policy: KilnPermissionPolicy) {
    this.approval = policy.approval ?? "on-request";
  }

  authorize(toolName: string, annotations?: CapabilityAnnotations): ToolAuthorizationResult {
    const isReadOnly = annotations?.readOnly === true;
    const isIdempotent = annotations?.idempotent === true;
    const isDestructive = annotations?.destructive === true;

    switch (this.approval) {
      case "never":
        return {
          level: isReadOnly ? 1 : isIdempotent ? 2 : isDestructive ? 4 : 2,
          allowed: true,
          requiresApproval: false,
          reason: "approval=never: all tools auto-authorized",
        };
      case "untrusted":
        return {
          level: 4,
          allowed: false,
          requiresApproval: true,
          reason: "approval=untrusted: all tools denied without explicit approval",
        };
      case "on-failure":
      case "on-request": {
        if (isReadOnly) {
          return {
            level: 1,
            allowed: true,
            requiresApproval: false,
            reason: `${this.approval}: read-only tool "${toolName}" auto-authorized`,
          };
        }
        if (isIdempotent) {
          return {
            level: 2,
            allowed: true,
            requiresApproval: false,
            reason: `${this.approval}: idempotent tool "${toolName}" audited without approval`,
          };
        }
        return {
          level: isDestructive ? 4 : 3,
          allowed: false,
          requiresApproval: true,
          reason: `${this.approval}: tool "${toolName}" requires approval before execution`,
        };
      }
      default:
        return {
          level: 3,
          allowed: false,
          requiresApproval: true,
          reason: `Unknown approval mode "${this.approval}"`,
        };
    }
  }
}
