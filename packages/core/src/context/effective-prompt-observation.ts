import type { CommunicationResolution } from "../agents/communication-policy.js";
import type { ProviderRequestEvidence } from "../events/execution-session-event.js";
import { sha256ContentIdentity } from "../content-addressing/content-identity.js";
import type { EffectivePromptEvidence } from "./effective-prompt-manifest.js";
import { buildEffectivePromptManifest, toEffectivePromptEvidence } from "./effective-prompt-manifest.js";

export interface EffectivePromptObservation {
  readonly version: "v1";
  readonly requestIndex: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly finalPromptHash: string;
  readonly estimatedTokens: number;
  readonly componentCount: number;
  readonly componentScopeCounts: Readonly<Record<"static" | "dynamic" | "deferred", number>>;
  readonly effectivePrompt: EffectivePromptEvidence;
  readonly communicationResolution?: CommunicationResolution;
  readonly evidenceIdentity: string;
}

/**
 * Projects the provider-ready prompt evidence for the request that actually
 * completed the turn. It deliberately does not fall back to an earlier request.
 */
export function projectFinalEffectivePromptObservation(
  providerRequests: readonly ProviderRequestEvidence[] | undefined,
): EffectivePromptObservation | undefined {
  const request = providerRequests?.at(-1);
  if (!request?.effectivePrompt) return undefined;

  const componentScopeCounts = request.effectivePrompt.components.reduce(
    (counts, component) => ({ ...counts, [component.scope]: counts[component.scope] + 1 }),
    { static: 0, dynamic: 0, deferred: 0 },
  );
  const evidence = {
    version: "v1" as const,
    requestIndex: request.requestIndex,
    providerId: request.providerId,
    modelId: request.modelId,
    finalPromptHash: request.effectivePrompt.finalPromptHash,
    estimatedTokens: request.effectivePrompt.estimatedTokens,
    componentCount: request.effectivePrompt.components.length,
    componentScopeCounts,
    effectivePrompt: request.effectivePrompt,
    communicationResolution: request.communicationResolution,
  };

  return {
    ...evidence,
    evidenceIdentity: sha256ContentIdentity(JSON.stringify(evidence)),
  };
}

/** Builds content-free evidence from the exact prompt handed to a standalone harness. */
export function observeStandaloneEffectivePrompt(input: {
  readonly providerId: string;
  readonly modelId: string;
  readonly finalPrompt: string;
  readonly communicationProjection?: string;
  readonly communicationResolution?: CommunicationResolution;
}): EffectivePromptObservation {
  const projection = input.communicationProjection;
  const projectionIndex = projection ? input.finalPrompt.indexOf(projection) : -1;
  if (projection && projectionIndex < 0) {
    throw new Error("Standalone communication projection is absent from the final provider prompt.");
  }
  const before = projectionIndex >= 0 ? input.finalPrompt.slice(0, projectionIndex) : input.finalPrompt;
  const after = projectionIndex >= 0 ? input.finalPrompt.slice(projectionIndex + projection!.length) : "";
  const components = [
    ...(before ? [{ id: "standalone-prompt-prefix", revision: "v1", scope: "dynamic" as const, content: before, provenance: { source: "standalone-harness" } }] : []),
    ...(projection ? [{ id: "runtime-communication-contract", revision: input.communicationResolution?.identity ?? "v1", scope: "dynamic" as const, content: projection, provenance: { source: "communication-resolution" } }] : []),
    ...(after ? [{ id: "standalone-prompt-suffix", revision: "v1", scope: "dynamic" as const, content: after, provenance: { source: "standalone-harness" } }] : []),
  ];
  const manifest = buildEffectivePromptManifest({ components });
  const effectivePrompt = toEffectivePromptEvidence(manifest);
  const evidence = {
    version: "v1" as const,
    requestIndex: 0,
    providerId: input.providerId,
    modelId: input.modelId,
    finalPromptHash: manifest.finalPromptHash,
    estimatedTokens: manifest.estimatedTokens,
    componentCount: effectivePrompt.components.length,
    componentScopeCounts: { static: 0, dynamic: effectivePrompt.components.length, deferred: 0 },
    effectivePrompt,
    ...(input.communicationResolution ? { communicationResolution: input.communicationResolution } : {}),
  };
  return { ...evidence, evidenceIdentity: sha256ContentIdentity(JSON.stringify(evidence)) };
}
