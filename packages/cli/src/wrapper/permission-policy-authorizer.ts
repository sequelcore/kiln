import type { ToolAuthorizer, AuthorityDescriptor, ResolvedInvocationEffect } from "@kilnai/core";
import {
  deriveAuthorityFromEffect,
} from "@kilnai/core";
import type { KilnPermissionPolicy } from "./session.js";
import { createPermissionEvaluator } from "./permission-evaluator.js";

export class PermissionPolicyAuthorizer implements ToolAuthorizer {
  private readonly approval: KilnPermissionPolicy["approval"];
  private readonly permissionEvaluator: ReturnType<typeof createPermissionEvaluator>;

  constructor(policy: KilnPermissionPolicy) {
    this.approval = policy.approval ?? "on-request";
    this.permissionEvaluator = createPermissionEvaluator(policy);
  }

  authorize(toolName: string, resolvedEffect: ResolvedInvocationEffect): AuthorityDescriptor {
    const toolDecision = this.permissionEvaluator.evaluateTool(toolName);
    if (toolDecision.source === "tool-rule") {
      const authority = deriveAuthorityFromEffect(resolvedEffect, {
        defaultLevel: resolvedEffect.operation === "observe" ? 1 : 2,
        requireApprovalForUnknown: toolDecision.action === "ask",
      });
      if (toolDecision.action === "allow") {
        return {
          ...authority,
          allowed: true,
          requiresApproval: false,
          reason: `Explicit tool rule allows "${toolName}".`,
        };
      }
      if (toolDecision.action === "deny") {
        return {
          ...authority,
          allowed: false,
          requiresApproval: false,
          reason: `Explicit tool rule denies "${toolName}".`,
        };
      }
      return {
        ...authority,
        allowed: false,
        requiresApproval: true,
        reason: `Explicit tool rule requires approval for "${toolName}".`,
      };
    }
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
