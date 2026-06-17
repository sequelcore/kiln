import {
  DEFAULT_ACTION_EFFECT_POLICY,
  deriveAuthorityFromEffect,
  type ActionEffectPolicy,
  type ResolvedInvocationEffect,
} from "../engine/domain/action-effect.js";
import type { AuthorityDescriptor, ToolAuthorizer } from "../engine/domain/tool-execution.js";

export class ActionEffectAuthorizer implements ToolAuthorizer {
  private readonly policy: ActionEffectPolicy;

  constructor(policy: ActionEffectPolicy = DEFAULT_ACTION_EFFECT_POLICY) {
    this.policy = policy;
  }

  authorize(_toolName: string, resolvedEffect: ResolvedInvocationEffect): AuthorityDescriptor {
    return deriveAuthorityFromEffect(resolvedEffect, this.policy);
  }
}
