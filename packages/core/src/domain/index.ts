// Domain configuration: tech stack detection, quality gates, tool filtering
// Domain-agnostic infrastructure -- no built-in configs, no hardcoded paths

// Re-export QualityGate from engine (single source of truth)
export type { QualityGate } from "../engine/composites/team.js";
export type { Agent, AgentTier } from "../engine/domain/agent.js";

import type { QualityGate } from "../engine/composites/team.js";

/** Domain configuration for a tech stack */
export interface DomainConfig {
  readonly name: string;
  readonly displayName: string;
  readonly toolTags: ReadonlySet<string>;
  readonly qualityGates: readonly QualityGate[];
  readonly detectPatterns: readonly string[];
  readonly multishotExamples: string;
  readonly phaseExamples: string;
}

/** Merge multiple domain configs for hybrid projects */
export function mergeDomainConfigs(configs: readonly DomainConfig[]): DomainConfig {
  if (configs.length === 0) throw new Error("No configs to merge");
  if (configs.length === 1) return configs[0]!;

  const mergedTags = new Set<string>();
  for (const c of configs) {
    for (const tag of c.toolTags) mergedTags.add(tag);
  }

  return {
    name: configs.map((c) => c.name).join("+"),
    displayName: configs.map((c) => c.displayName).join(" + "),
    toolTags: mergedTags,
    qualityGates: configs.flatMap((c) => c.qualityGates),
    detectPatterns: configs.flatMap((c) => c.detectPatterns),
    multishotExamples: configs.map((c) => c.multishotExamples).join("\n\n"),
    phaseExamples: configs.map((c) => c.phaseExamples).join("\n\n"),
  };
}

export { DomainRegistry } from "./domain-registry.js";
export type { DomainRegistryOptions } from "./domain-registry.js";
export { parseDomainYaml, loadDomainYaml, DomainYamlError } from "./yaml-parser.js";
export type { DomainYaml, QualityGateYaml, YamlValidationError } from "./yaml-schema.js";
export { validateDomainYaml } from "./yaml-schema.js";

// Domain package adapter: parses domain YAML into DomainPackageManifest (delegates to package/)
// These accept domain YAML without requiring type/version/author fields.
export {
  parseDomainPackageYaml,
  loadDomainPackageYaml,
  verifyContentHash,
} from "./domain-package-adapter.js";
export type { DomainPackageManifest } from "./domain-package-adapter.js";
