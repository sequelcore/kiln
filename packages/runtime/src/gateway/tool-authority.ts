import type { Capability, AuthorityDescriptor } from "@kilnai/core";
import {
  deriveAuthorityFromEffect,
  getBuiltinEffectEnvelope,
  conservativeEnvelopeFromExternalHints,
  DEFAULT_ACTION_EFFECT_POLICY,
  type ActionEffectEnvelope,
} from "@kilnai/core";

export type ToolAuthorityClassification =
  | "destructive"
  | "read_only"
  | "idempotent"
  | "audited";

export function rollupIntegrationAuthority(
  classifications: readonly ToolAuthorityClassification[],
): ToolAuthorityClassification {
  if (classifications.includes("destructive")) {
    return "destructive";
  }
  if (classifications.includes("audited")) {
    return "audited";
  }
  if (classifications.includes("idempotent")) {
    return "idempotent";
  }
  return "read_only";
}

function envelopeForCapability(capability: Capability | undefined): ActionEffectEnvelope {
  if (capability?.effectEnvelope) {
    return capability.effectEnvelope;
  }
  const builtin = capability ? getBuiltinEffectEnvelope(capability.name) : undefined;
  if (builtin) {
    return builtin;
  }
  return conservativeEnvelopeFromExternalHints();
}

export function classifyAuthorityFromCapability(
  capability: Capability | undefined,
): ToolAuthorityClassification {
  const envelope = envelopeForCapability(capability);
  const authority = deriveAuthorityFromEffect(envelope, DEFAULT_ACTION_EFFECT_POLICY);
  if (authority.level >= 4 && !authority.allowed) {
    return "destructive";
  }
  if (authority.level === 1 && authority.allowed && !authority.requiresApproval) {
    if (envelope.idempotency === "idempotent") {
      return "idempotent";
    }
    return "read_only";
  }
  if (authority.level <= 2 && authority.allowed) {
    if (envelope.idempotency === "idempotent") {
      return "idempotent";
    }
    return "audited";
  }
  return "audited";
}

export function authorityFromCapability(
  _toolName: string,
  capability: Capability | undefined,
): AuthorityDescriptor {
  const envelope = envelopeForCapability(capability);
  return deriveAuthorityFromEffect(envelope, DEFAULT_ACTION_EFFECT_POLICY);
}
