import { createHash } from "node:crypto";
import type { KilnSkillSourceInventorySnapshot } from "@kilnai/gateway-contracts";
import type { KilnExternalCatalogPolicy } from "../kiln-yaml-types.js";

export const CODEX_EXTERNAL_SKILL_EXPOSURE_ADAPTER_REVISION = "codex-skills-config-path-v1";

export interface ExternalSkillExposureProjection {
  readonly fingerprint: string;
  readonly policyFingerprint: string;
  readonly appliedAt: string;
  readonly disabledItems: readonly { readonly path: string; readonly enabled: false }[];
}

export function compileCodexExternalSkillExposure(input: {
  readonly inventory: KilnSkillSourceInventorySnapshot;
  readonly policy: KilnExternalCatalogPolicy;
  readonly absolutePathBySourceId: ReadonlyMap<string, string>;
  readonly now?: Date;
}): ExternalSkillExposureProjection {
  const codexPolicy = input.policy.harnesses.codex;
  if (!codexPolicy) throw new Error("External catalog policy has no configured Codex adapter.");
  if (!input.inventory.complete) throw new Error("External catalog inventory is incomplete; exposure projection refused.");
  const external = input.inventory.candidates.filter((candidate) => candidate.relationship === "external"
    && candidate.applicableHarnesses.includes("codex")
    && candidate.exposureScope !== "project"
    && candidate.effectiveVisibility === "implicit");
  const fingerprint = computeCodexExternalInventoryFingerprint(external);
  if (codexPolicy.expectedFingerprint !== fingerprint) {
    throw new Error(`External catalog inventory fingerprint drifted: expected ${codexPolicy.expectedFingerprint}, current ${fingerprint}`);
  }
  const byId = new Map<string, typeof external[number]>();
  for (const candidate of external) {
    if (byId.has(candidate.sourceId)) throw new Error(`Ambiguous external catalog sourceId: ${candidate.sourceId}`);
    byId.set(candidate.sourceId, candidate);
  }
  const keep = new Set<string>();
  for (const decision of codexPolicy.keepImplicit) {
    const candidate = byId.get(decision.sourceId);
    if (!candidate) throw new Error(`Reviewed external catalog source is absent: ${decision.sourceId}`);
    if (candidate.packageDigest !== decision.packageDigest) throw new Error(`Reviewed external catalog digest drifted: ${decision.sourceId}`);
    keep.add(decision.sourceId);
  }
  const disabledItems = external.filter((candidate) => !keep.has(candidate.sourceId)).map((candidate) => {
    const path = input.absolutePathBySourceId.get(candidate.sourceId);
    if (!path) throw new Error(`Absolute external catalog path is unavailable: ${candidate.sourceId}`);
    return { path, enabled: false as const };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const policyFingerprint = `sha256:${createHash("sha256").update(JSON.stringify({
    adapterRevision: CODEX_EXTERNAL_SKILL_EXPOSURE_ADAPTER_REVISION,
    inventoryFingerprint: fingerprint,
    keepImplicit: [...keep].sort(),
  })).digest("hex")}`;
  return { fingerprint, policyFingerprint, appliedAt: (input.now ?? new Date()).toISOString(), disabledItems };
}

export function computeCodexExternalInventoryFingerprint(
  candidates: readonly Pick<KilnSkillSourceInventorySnapshot["candidates"][number], "sourceId" | "packageDigest">[],
): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    adapterRevision: CODEX_EXTERNAL_SKILL_EXPOSURE_ADAPTER_REVISION,
    candidates: candidates.map(({ sourceId, packageDigest }) => ({ sourceId, packageDigest }))
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
  })).digest("hex")}`;
}
