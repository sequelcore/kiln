import {
  defineDeliberationLevelId,
  type DeliberationIntent,
  type DiscoveredDirectProviderModelCapabilities,
} from "@kilnai/core";
import type {
  GuiDeliberationIntent,
  GuiProviderModelCapabilities,
} from "@kilnai/gateway-contracts";

export function toCoreDeliberationIntent(
  value: unknown,
): DeliberationIntent | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Deliberation intent must be an object.");
  const intent = value as unknown as GuiDeliberationIntent;
  if (intent.onUnsupported !== "deny" && intent.onUnsupported !== "omit" && intent.onUnsupported !== "allow-clamp") {
    throw new Error("Deliberation intent has an invalid unsupported policy.");
  }
  if (intent.mode === "provider-default") {
    assertOnlyKeys(value, ["mode", "onUnsupported"]);
    return { mode: "provider-default", onUnsupported: intent.onUnsupported };
  }
  if (intent.mode !== "fixed" && intent.mode !== "adaptive") {
    throw new Error("Deliberation intent has an invalid mode.");
  }
  const boundsValue = value.bounds;
  if (boundsValue !== undefined && !isRecord(boundsValue)) {
    throw new Error("Deliberation intent bounds must be an object.");
  }
  if (boundsValue) assertOnlyKeys(boundsValue, ["min", "max"]);
  const min = boundsValue?.min;
  const max = boundsValue?.max;
  if (min !== undefined && typeof min !== "string") throw new Error("Deliberation minimum bound must be a string.");
  if (max !== undefined && typeof max !== "string") throw new Error("Deliberation maximum bound must be a string.");
  const bounds = boundsValue
    ? {
        ...(min ? { min: defineDeliberationLevelId(min) } : {}),
        ...(max ? { max: defineDeliberationLevelId(max) } : {}),
      }
    : undefined;
  if (intent.mode === "fixed") {
    assertOnlyKeys(value, ["mode", "preferredLevel", "bounds", "onUnsupported"]);
    if (typeof value.preferredLevel !== "string") {
      throw new Error("Fixed deliberation intent requires a preferred level string.");
    }
    return {
      mode: "fixed",
      preferredLevel: defineDeliberationLevelId(value.preferredLevel),
      ...(bounds ? { bounds } : {}),
      onUnsupported: intent.onUnsupported,
    };
  }
  assertOnlyKeys(value, ["mode", "target", "bounds", "onUnsupported"]);
  if (intent.target !== "latency-first" && intent.target !== "balanced" && intent.target !== "quality-first") {
    throw new Error("Adaptive deliberation intent has an invalid target.");
  }
  return {
    mode: "adaptive",
    target: intent.target,
    ...(bounds ? { bounds } : {}),
    onUnsupported: intent.onUnsupported,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const admitted = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !admitted.has(key));
  if (unknown) throw new Error(`Unknown deliberation intent field '${unknown}'.`);
}

export function toCoreModelCapabilities(
  capabilities: GuiProviderModelCapabilities | undefined,
): DiscoveredDirectProviderModelCapabilities | undefined {
  if (!capabilities) return undefined;
  return {
    supportsFunctionTools: capabilities.supportsFunctionTools,
    supportsRuntimeTools: capabilities.supportsRuntimeTools,
    supportsNativeShellTools: capabilities.supportsNativeShellTools,
    supportsNativePatchTools: capabilities.supportsNativePatchTools,
    supportsTools: capabilities.supportsTools,
    ...(capabilities.deliberation
      ? {
          deliberation: {
            provider: capabilities.deliberation.provider,
            model: capabilities.deliberation.model,
            levels: capabilities.deliberation.levels.map((level) => ({
              id: defineDeliberationLevelId(level.id),
              ...(level.nativeId ? { nativeId: level.nativeId } : {}),
            })),
            ...(capabilities.deliberation.defaultLevel
              ? { defaultLevel: defineDeliberationLevelId(capabilities.deliberation.defaultLevel) }
              : {}),
            supportsAdaptive: capabilities.deliberation.supportsAdaptive,
            evidence: capabilities.deliberation.evidence,
          },
        }
      : {}),
  };
}
