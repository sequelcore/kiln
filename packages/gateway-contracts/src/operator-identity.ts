import type {
  OperatorManagedAgentChildIdentitySnapshot,
  OperatorManagedAgentInvocationEventPayload,
} from "./frames.js";

export type OperatorIdentityKind =
  | "operator"
  | "assistant"
  | "agent"
  | "agent_profile"
  | "provider"
  | "tool"
  | "system";

export interface OperatorIdentityProjection {
  readonly kind: OperatorIdentityKind;
  readonly id: string;
  readonly label: string;
  readonly seed: string;
  readonly subtitle?: string;
}

export type OperatorMessageIdentityRole = "user" | "assistant" | "tool" | "error";

interface OperatorMessageIdentityInput {
  readonly role: OperatorMessageIdentityRole;
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly userId?: string | null;
  readonly toolName?: string | null;
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function childIdentityLabel(identity: OperatorManagedAgentChildIdentitySnapshot | undefined): string | null {
  return cleanText(identity?.displayName)
    ?? cleanText(identity?.admittedAgentProfile)
    ?? cleanText(identity?.requestedAgentProfile)
    ?? cleanText(identity?.agentId);
}

function childIdentitySeed(identity: OperatorManagedAgentChildIdentitySnapshot | undefined): string | null {
  const agentId = cleanText(identity?.agentId);
  if (agentId) return `agent:${agentId}`;
  const admitted = cleanText(identity?.admittedAgentProfile);
  if (admitted) return `agent-profile:${admitted}`;
  const requested = cleanText(identity?.requestedAgentProfile);
  if (requested) return `agent-profile:${requested}`;
  return null;
}

export function projectManagedAgentIdentity(
  payload: Partial<OperatorManagedAgentInvocationEventPayload> | null | undefined,
): OperatorIdentityProjection | null {
  if (!payload) return null;
  const childIdentity = payload.capabilitySnapshot?.childIdentity;
  const id = cleanText(childIdentity?.agentId)
    ?? cleanText(payload.agentId)
    ?? cleanText(childIdentity?.admittedAgentProfile)
    ?? cleanText(childIdentity?.requestedAgentProfile);
  if (!id) return null;

  const label = childIdentityLabel(childIdentity)
    ?? id;
  const seed = childIdentitySeed(childIdentity)
    ?? (cleanText(payload.agentId) ? `agent:${cleanText(payload.agentId)}` : null)
    ?? `agent:${id}`;
  const provider = cleanText(payload.providerRoute?.providerId);
  const model = cleanText(payload.providerRoute?.model);
  const surface = cleanText(payload.providerRoute?.surface);
  const subtitle = [provider, model].filter(Boolean).join("/")
    + (surface ? ` (${surface})` : "");

  return {
    kind: "agent",
    id,
    label,
    seed,
    ...(subtitle.trim().length > 0 ? { subtitle } : {}),
  };
}

export function projectAgentProfileIdentity(profile: string | null | undefined): OperatorIdentityProjection | null {
  const label = cleanText(profile);
  if (!label) return null;
  return {
    kind: "agent_profile",
    id: label,
    label,
    seed: `agent-profile:${label}`,
  };
}

export function projectMessageIdentity(input: OperatorMessageIdentityInput): OperatorIdentityProjection {
  if (input.role === "user") {
    const id = cleanText(input.userId) ?? "local-operator";
    return {
      kind: "operator",
      id,
      label: "User",
      seed: `operator:${id}`,
    };
  }

  if (input.role === "assistant") {
    const provider = cleanText(input.provider) ?? "assistant";
    const model = cleanText(input.model);
    return {
      kind: "assistant",
      id: model ? `${provider}:${model}` : provider,
      label: "Assistant",
      seed: model ? `assistant:${provider}:${model}` : `assistant:${provider}`,
      ...(model ? { subtitle: `${provider} / ${model}` } : { subtitle: provider }),
    };
  }

  if (input.role === "tool") {
    const toolName = cleanText(input.toolName) ?? "tool";
    return {
      kind: "tool",
      id: toolName,
      label: "Tool",
      seed: `tool:${toolName}`,
    };
  }

  return {
    kind: "system",
    id: "error",
    label: "Error",
    seed: "system:error",
  };
}

export function operatorIdentityInitials(label: string): string {
  const words = label
    .trim()
    .split(/[\s._:@/-]+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const second = words.length > 1 ? words[1]?.[0] ?? "" : words[0]?.[1] ?? "";
  return `${first}${second}`.toUpperCase();
}
