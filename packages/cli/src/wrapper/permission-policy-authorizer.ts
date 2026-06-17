import type { ToolAuthorizer, AuthorityDescriptor, ResolvedInvocationEffect } from "@kilnai/core";
import {
  deriveAuthorityFromEffect,
} from "@kilnai/core";
import type { KilnPermissionPolicy } from "./session.js";

export class PermissionPolicyAuthorizer implements ToolAuthorizer {
  private readonly approval: KilnPermissionPolicy["approval"];

  constructor(policy: KilnPermissionPolicy) {
    this.approval = policy.approval ?? "on-request";
  }

  authorize(toolName: string, resolvedEffect: ResolvedInvocationEffect): AuthorityDescriptor {
    switch (this.approval) {
      case "never": {
        const result = deriveAuthorityFromEffect(resolvedEffect, {
          defaultLevel: resolvedEffect.operation === "observe" ? 1 : 2,
          requireApprovalForUnknown: false,
        });
        return { ...result, allowed: true, requiresApproval: false, reason: "approval=never: all tools auto-authorized" };
      }
      case "untrusted":
        return { level: 4, allowed: false, requiresApproval: true, reason: "approval=untrusted: all tools denied without explicit approval" };
      case "on-failure":
      case "on-request": {
        const result = deriveAuthorityFromEffect(resolvedEffect, {
          defaultLevel: 3,
          requireApprovalForUnknown: true,
        });
        return { ...result, reason: `${this.approval}: tool "${toolName}" ${result.reason}` };
      }
      default:
        return { level: 3, allowed: false, requiresApproval: true, reason: `Unknown approval mode "${this.approval}"` };
    }
  }
}
