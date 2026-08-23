// Domain package adapter: parses domain YAML into DomainPackageManifest with content hashing.
// Delegates to package/ bounded context for hashing and manifest types.
// Domain YAML does not require type/version/author fields (defaults applied).

import { parse } from "yaml";
import { readFileSync } from "node:fs";
import type { DomainConfig } from "./index.js";
import type { DomainYaml } from "./yaml-schema.js";
import { validateDomainYaml } from "./yaml-schema.js";
import { DomainYamlError } from "./yaml-parser.js";
import { computeContentHash } from "../package/security.js";
import type { PackageToolsConfig } from "../package/types.js";
import type { DomainPackageManifest } from "../package/types.js";

// Re-export DomainPackageManifest type (defined in package/types.ts)
export type { DomainPackageManifest } from "../package/types.js";

/**
 * Parse domain.yaml content into a DomainPackageManifest.
 * Domain YAML does not require type/version/author (defaults applied).
 * Uses domain YAML validator (not package validator).
 */
export function parseDomainPackageYaml(
  content: string,
  installPath: string,
  filePath?: string,
): DomainPackageManifest {
  const data = parse(content) as unknown;
  const errors = validateDomainYaml(data, filePath);
  if (errors.length > 0) throw new DomainYamlError(errors, filePath);

  const yaml = data as DomainYaml & {
    version?: string;
    author?: string;
    skills?: readonly string[];
    tools?: { server: string };
  };

  const config: DomainConfig = {
    name: yaml.name,
    displayName: yaml.displayName,
    detectPatterns: yaml.detectPatterns,
    toolTags: new Set(yaml.toolTags),
    qualityGates: yaml.qualityGates.map((g) => ({
      name: g.name,
      command: g.command,
      description: g.description,
      required: g.required ?? true,
    })),
    multishotExamples: yaml.multishotExamples ?? "",
    phaseExamples: yaml.phaseExamples ?? "",
  };

  const tools: PackageToolsConfig | null = yaml.tools
    ? { server: yaml.tools.server }
    : null;

  return {
    name: yaml.name,
    type: "domain",
    version: yaml.version ?? "0.0.0",
    author: yaml.author ?? "",
    installPath,
    contentHash: computeContentHash(content),
    config,
    skills: yaml.skills ?? [],
    tools,
  };
}

/** Load domain.yaml from disk into a DomainPackageManifest */
export function loadDomainPackageYaml(
  filePath: string,
  installPath: string,
): DomainPackageManifest {
  const content = readFileSync(filePath, "utf-8");
  return parseDomainPackageYaml(content, installPath, filePath);
}

/** Verify a file on disk has not been tampered with */
export function verifyContentHash(filePath: string, expectedHash: string): boolean {
  const content = readFileSync(filePath, "utf-8");
  return computeContentHash(content) === expectedHash;
}
