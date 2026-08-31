import {
  compareManagedAgentExternalRuntimeAttachment,
  digestManagedEconomicValue,
} from "@kilnai/core";
import {
  discoverVisionAnalyzeCapabilities,
  VISION_ANALYZE_CAPABILITY_ID,
  type VisionAnalyzeCapabilityDiscoveryResult,
  type VisionAnalyzeImplementationResolution,
} from "@kilnai/core/capabilities";
import type {
  ManagedInvocationAgentCatalogEntry,
  ManagedInvocationToolAttachment,
  ManagedInvocationToolRoute,
} from "@kilnai/runtime";

export interface ConfiguredVisionCapabilitySelection {
  readonly capabilityId: typeof VISION_ANALYZE_CAPABILITY_ID;
  readonly agentProfile: string;
  /** Local Agent Task selections have no provider/economic route. */
  readonly kind?: "agent-task";
  readonly routeId?: string;
  readonly providerRoute?: {
    readonly providerId: string;
    readonly model?: string;
  };
  readonly externalRuntimeAttachment?: NonNullable<ManagedInvocationToolRoute["externalRuntimeAttachment"]>;
  readonly implementationIdentityDigest: `sha256:${string}`;
}

export interface ConfiguredVisionCapabilityResolution {
  readonly discovery: VisionAnalyzeCapabilityDiscoveryResult;
  readonly selection?: ConfiguredVisionCapabilitySelection;
}

/**
 * Projects one exact configured vision specialist into inert Core discovery
 * evidence. Ambiguous or non-executable declarations remain unavailable.
 */
export function resolveConfiguredVisionCapability(
  attachment: ManagedInvocationToolAttachment | undefined,
  evaluatedAt: string,
  localAgentProfileId?: string,
): ConfiguredVisionCapabilityResolution {
  if (localAgentProfileId !== undefined) {
    return resolveLocalVisionCapability(localAgentProfileId, evaluatedAt);
  }
  const eligible = attachment?.options.invocationService
    ? eligibleVisionAgents(attachment)
    : [];
  if (eligible.length !== 1) {
    return {
      discovery: discoverVisionAnalyzeCapabilities({
        evaluatedAt,
        implementation: unavailableResolution(eligible.length),
      }),
    };
  }
  const selected = eligible[0]!;
  const identity = {
    executorContract: "kiln.runtime.managed-vision-analysis/v1",
    agent: configuredAgentIdentity(selected.agent),
    route: configuredRouteIdentity(selected.route),
  };
  const implementationIdentityDigest = capabilityDigest(identity);
  const validUntil = new Date(Date.parse(evaluatedAt) + 5 * 60_000).toISOString();
  const discovery = discoverVisionAnalyzeCapabilities({
    evaluatedAt,
    implementation: {
      status: "available",
      observedAt: evaluatedAt,
      validUntil,
      implementationIdentityDigest,
      provenanceDigest: capabilityDigest({ source: "configured-managed-agent", ...identity }),
      agentIdentityDigest: capabilityDigest(identity.agent),
    },
  });
  return {
    discovery,
    selection: {
      capabilityId: VISION_ANALYZE_CAPABILITY_ID,
      agentProfile: selected.agent.name,
      routeId: selected.route.routeId,
      providerRoute: {
        providerId: selected.route.providerId,
        ...(selected.route.model ? { model: selected.route.model } : {}),
      },
      ...(selected.route.externalRuntimeAttachment
        ? { externalRuntimeAttachment: selected.route.externalRuntimeAttachment }
        : {}),
      implementationIdentityDigest,
    },
  };
}

function resolveLocalVisionCapability(
  configuredAgentProfileId: string,
  evaluatedAt: string,
): ConfiguredVisionCapabilityResolution {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(configuredAgentProfileId)) {
    return {
      discovery: discoverVisionAnalyzeCapabilities({
        evaluatedAt,
        implementation: unavailableResolution(0),
      }),
    };
  }
  const identity = {
    executorContract: "kiln.runtime.agent-task-vision-analysis/v1",
    configuredAgentProfileId,
  };
  const implementationIdentityDigest = capabilityDigest(identity);
  const validUntil = new Date(Date.parse(evaluatedAt) + 5 * 60_000).toISOString();
  const discovery = discoverVisionAnalyzeCapabilities({
    evaluatedAt,
    implementation: {
      status: "available",
      observedAt: evaluatedAt,
      validUntil,
      implementationIdentityDigest,
      provenanceDigest: capabilityDigest({ source: "configured-local-agent-task", ...identity }),
      agentIdentityDigest: capabilityDigest({ owner: "agent-task", configuredAgentProfileId }),
    },
  });
  return {
    discovery,
    selection: {
      capabilityId: VISION_ANALYZE_CAPABILITY_ID,
      kind: "agent-task",
      agentProfile: configuredAgentProfileId,
      implementationIdentityDigest,
    },
  };
}

function eligibleVisionAgents(
  attachment: ManagedInvocationToolAttachment,
): readonly {
  readonly agent: ManagedInvocationAgentCatalogEntry;
  readonly route: ManagedInvocationToolRoute;
}[] {
  const routes = new Map(attachment.options.routes.map((route) => [route.routeId, route] as const));
  return (attachment.options.agentCatalog ?? []).flatMap((agent) => {
    if (
      agent.structured !== true
      || !agent.modalities?.includes("image")
      || agent.admissionProfile !== "foundation-readonly-plan"
      || agent.economicPolicyId !== undefined
      || !agent.routeId
    ) return [];
    const route = routes.get(agent.routeId);
    if (
      !route
      || !route.createAdapter
      || !hasExactAttachmentBinding(route)
      || !matchesProviderRouteHint(agent, route)
      || route.capability.proof.status === "unproven"
      || !route.capability.proof.provenProfiles.includes(agent.admissionProfile)
    ) return [];
    const profile = route.profiles.find((candidate) =>
      candidate.authorityProfileId === agent.authorityProfileId
      && candidate.admissionProfile === agent.admissionProfile
      && candidate.writeAllowed !== true);
    return profile ? [{ agent, route }] : [];
  });
}

function configuredAgentIdentity(agent: ManagedInvocationAgentCatalogEntry): Readonly<Record<string, unknown>> {
  return {
    name: agent.name,
    authorityProfileId: agent.authorityProfileId,
    admissionProfile: agent.admissionProfile,
    modalities: [...(agent.modalities ?? [])].sort(),
    structured: agent.structured === true,
    routeId: agent.routeId,
    ...(agent.providerRoute ? { providerRoute: configuredProviderRouteIdentity(agent.providerRoute) } : {}),
  };
}

function configuredProviderRouteIdentity(
  providerRoute: NonNullable<ManagedInvocationAgentCatalogEntry["providerRoute"]>,
): Readonly<Record<string, unknown>> {
  return {
    providerId: providerRoute.providerId,
    ...(providerRoute.model !== undefined ? { model: providerRoute.model } : {}),
    ...(providerRoute.deliberationIntent !== undefined ? { deliberationIntent: providerRoute.deliberationIntent } : {}),
    ...(providerRoute.communicationIntent !== undefined ? { communicationIntent: providerRoute.communicationIntent } : {}),
  };
}

function matchesProviderRouteHint(
  agent: ManagedInvocationAgentCatalogEntry,
  route: ManagedInvocationToolRoute,
): boolean {
  const hint = agent.providerRoute;
  return hint === undefined
    || (hint.providerId === route.providerId && (hint.model === undefined || hint.model === route.model));
}

function hasExactAttachmentBinding(route: ManagedInvocationToolRoute): boolean {
  const routeAttachment = route.externalRuntimeAttachment;
  const capabilityAttachment = route.capability.externalRuntimeAttachment;
  return route.capability.supportsAttachments === true
    && isExternalRuntimeAttachment(routeAttachment)
    && isExternalRuntimeAttachment(capabilityAttachment)
    && compareManagedAgentExternalRuntimeAttachment(routeAttachment, capabilityAttachment) === "matched";
}

function isExternalRuntimeAttachment(
  value: ManagedInvocationToolRoute["externalRuntimeAttachment"],
): value is NonNullable<ManagedInvocationToolRoute["externalRuntimeAttachment"]> {
  return value?.kind === "external-runtime"
    && typeof value.runtimeId === "string"
    && value.runtimeId.trim().length > 0
    && typeof value.attachmentId === "string"
    && value.attachmentId.trim().length > 0;
}

function configuredRouteIdentity(route: ManagedInvocationToolRoute): Readonly<Record<string, unknown>> {
  return {
    routeId: route.routeId,
    routeRevision: route.capability.identity.revision,
    routeSource: route.routeSource,
    providerId: route.providerId,
    ...(route.model ? { model: route.model } : {}),
    adapter: route.capability.adapter,
    proof: route.capability.proof,
    supportsAttachments: route.capability.supportsAttachments,
    externalRuntimeAttachment: route.externalRuntimeAttachment,
    capabilityExternalRuntimeAttachment: route.capability.externalRuntimeAttachment,
  };
}

function unavailableResolution(candidateCount: number): VisionAnalyzeImplementationResolution {
  return {
    status: candidateCount > 1 ? "validation_failed" : "unavailable",
    diagnostic: {
      code: candidateCount > 1 ? "invalid_declaration" : "not_configured",
    },
  };
}

function capabilityDigest(value: unknown): `sha256:${string}` {
  const digest = digestManagedEconomicValue(value);
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error("Configured vision capability identity did not produce a canonical digest.");
  }
  return digest as `sha256:${string}`;
}
