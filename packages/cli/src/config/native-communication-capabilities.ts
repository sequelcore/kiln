import {
  resolveCommunicationProfile,
  type CommunicationResolution,
  type CommunicationSurface,
  type ModelCommunicationCapabilities,
  type ResolvedCommunicationIntent,
} from "@kilnai/core";

export type NativeCommunicationHarness = "claude" | "codex" | "opencode";

export function nativeCommunicationCapabilities(
  harness: NativeCommunicationHarness,
  model: string,
): ModelCommunicationCapabilities | undefined {
  const responseDetail = harness === "claude"
    ? {
        mechanism: "native" as const,
        supported: ["concise"] as const,
        nativeValues: { concise: "Concise" },
      }
    : harness === "codex" && /^gpt-5(?:\.|-|$)/u.test(model)
    ? {
        mechanism: "native" as const,
        supported: ["concise", "standard", "detailed"] as const,
        nativeValues: { concise: "low", standard: "medium", detailed: "high" },
      }
    : harness === "opencode" && /^openai\/gpt-5(?:\.|-|$)/u.test(model)
      ? {
          mechanism: "native" as const,
          supported: ["concise", "standard", "detailed"] as const,
          nativeValues: { concise: "low", standard: "medium", detailed: "high" },
        }
      : undefined;
  const interactionProfiles = harness === "codex"
    ? ([
        { profileId: "friendly", profileRevision: "v1", supportedBehaviors: ["audience-calibrated", "plain-language"], nativeValue: "friendly" },
        { profileId: "pragmatic", profileRevision: "v1", supportedBehaviors: ["outcome-first", "plain-language", "next-action-explicit"], nativeValue: "pragmatic" },
      ] as const).map((profile) => ({
        ...profile,
        mechanism: "native" as const,
        fidelity: "translated" as const,
        semanticLoss: ["Codex personality does not guarantee every neutral interaction behavior."],
      }))
    : undefined;
  if (!responseDetail && !interactionProfiles) return undefined;
  return {
    provider: harness,
    model,
    ...(responseDetail ? { responseDetail } : {}),
    ...(interactionProfiles ? { interactionProfiles } : {}),
    evidence: {
      sourceIdentity: harness === "claude"
        ? "claude-code-output-style"
        : harness === "codex" ? "codex-agent-config" : "opencode-agent-provider-options",
      sourceRevision: harness === "claude"
        ? "claude-code-2.1.237"
        : harness === "codex"
          ? "32329b289d05eb6a3f8e35c267ceb25ba46716a2"
          : "3016830e253492ef41b6cc00dbed623e5989279b",
      observedAt: harness === "claude" ? "2026-08-20T00:00:00.000Z" : "2026-08-13T00:00:00.000Z",
    },
  };
}

export function resolveNativeCommunication(input: {
  readonly intent: ResolvedCommunicationIntent;
  readonly harness: NativeCommunicationHarness;
  readonly model: string;
  readonly surface?: CommunicationSurface;
  readonly projection?: "agent-file" | "global-settings" | "invocation";
}): CommunicationResolution {
  const capabilities = input.projection === "agent-file" && input.harness === "claude"
    ? undefined
    : input.projection === "invocation" && input.harness === "opencode"
    ? undefined
    : nativeCommunicationCapabilities(input.harness, input.model);
  const resolution = resolveCommunicationProfile({
    intent: input.intent,
    execution: {
      provider: input.harness,
      model: input.model,
      surface: input.surface ?? "standalone-harness",
      harness: input.harness,
    },
    capabilities,
  });
  if (input.intent.intent.onUnsupported === "deny"
    && (resolution.responseDetail.status === "unsupported"
      || resolution.interactionProfile.status === "unsupported")) {
    throw new Error(
      `${input.harness} cannot exactly project the configured communication intent for ${input.model}.`,
    );
  }
  return resolution;
}
