import {
  assertCapabilityCatalogSnapshot,
  type CapabilityCatalogSnapshot,
} from "@kilnai/core";
import {
  CapabilityCatalogProjectionSchema,
  type CapabilityCatalogEntry,
  type CapabilityCatalogProjection,
  type CapabilityCatalogRejection,
} from "@kilnai/gateway-contracts";

/**
 * Projects a Core-admitted catalog into the public discovery contract.
 * Implementation references remain Runtime-private and are never dispatch authority.
 */
export function projectCapabilityCatalog(snapshot: CapabilityCatalogSnapshot): CapabilityCatalogProjection {
  assertCapabilityCatalogSnapshot(snapshot);

  const entries = snapshot.descriptors.map((descriptor): CapabilityCatalogEntry => {
    if (descriptor.freshness.status !== "available") {
      throw new TypeError("Core capability catalog contains an unavailable admitted descriptor");
    }
    return {
      capabilityId: descriptor.capabilityId,
      revision: descriptor.revision,
      descriptorDigest: descriptor.descriptorDigest,
      kind: descriptor.kind,
      owner: { ...descriptor.owner },
      inputSchemaDigest: descriptor.inputSchemaDigest,
      outputSchemaDigest: descriptor.outputSchemaDigest,
      artifacts: descriptor.artifacts.map((artifact) => ({ ...artifact })),
      effect: {
        ...descriptor.effect,
        boundaries: [...descriptor.effect.boundaries],
        consequences: [...descriptor.effect.consequences],
      },
      permissions: [...descriptor.permissions],
      approval: descriptor.approval,
      network: descriptor.network,
      data: { ...descriptor.data },
      supportedCallers: [...descriptor.supportedCallers],
      freshness: { ...descriptor.freshness, status: "available" },
      provenance: { ...descriptor.provenance },
      limits: { ...descriptor.limits },
    };
  });
  const rejections = snapshot.decisions
    .filter((decision) => decision.status === "ineligible")
    .map((decision): CapabilityCatalogRejection => ({
      ...(decision.capabilityId ? { capabilityId: decision.capabilityId } : {}),
      ...(decision.revision ? { revision: decision.revision } : {}),
      ...(decision.descriptorDigest ? { descriptorDigest: decision.descriptorDigest } : {}),
      status: "ineligible",
      reasons: decision.reasons.filter((reason) => reason !== "eligible"),
    }));

  return CapabilityCatalogProjectionSchema.parse({
    schema: "kiln.capability-catalog/v1",
    observedAt: snapshot.evaluatedAt,
    catalogDigest: snapshot.catalogDigest,
    entries,
    rejections,
  });
}
