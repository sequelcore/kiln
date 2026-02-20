// Package YAML parser: loads and validates package YAML into typed manifests

import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { KilnError } from "../engine/errors.js";
import type { DomainConfig } from "../domain/index.js";
import type { DomainPackageManifest, SkillPackageManifest, PackageToolsConfig, PackageKnowledgeConfig } from "./types.js";
import type { PackageYaml } from "./yaml-schema.js";
import { validatePackageYaml } from "./yaml-schema.js";
import { computeContentHash } from "./security.js";
import type { SkillConfig } from "../skill/types.js";
import type { EventType } from "../events/index.js";

export class PackageYamlError extends KilnError {
  readonly errors: readonly { field: string; message: string }[];
  readonly filePath?: string;

  constructor(
    errors: readonly { field: string; message: string }[],
    filePath?: string,
  ) {
    const msg = errors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
    super("PACKAGE_YAML_INVALID", `Invalid package YAML${filePath ? ` (${filePath})` : ""}:\n${msg}`, {
      context: { errors, filePath },
      retryable: false,
    });
    this.name = "PackageYamlError";
    this.errors = errors;
    this.filePath = filePath;
  }
}

/** Parse a YAML string into a DomainPackageManifest */
export function parseDomainPackageYaml(
  content: string,
  installPath: string,
  filePath?: string,
): DomainPackageManifest {
  const data = parse(content) as unknown;
  const errors = validatePackageYaml(data, filePath);
  if (errors.length > 0) throw new PackageYamlError(errors, filePath);

  const yaml = data as PackageYaml;

  if (yaml.type !== "domain") {
    throw new PackageYamlError([{ field: "type", message: 'Expected "domain"' }], filePath);
  }

  const config: DomainConfig = {
    name: yaml.name ?? "",
    displayName: yaml.displayName ?? "",
    detectPatterns: yaml.detectPatterns ?? [],
    toolTags: new Set(yaml.toolTags ?? []),
    qualityGates: (yaml.qualityGates ?? []).map((g) => ({
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

  const knowledge: PackageKnowledgeConfig | null = yaml.knowledge
    ? {
        ...(yaml.knowledge.examples !== undefined ? { examples: yaml.knowledge.examples } : {}),
        ...(yaml.knowledge.gates !== undefined ? { gates: yaml.knowledge.gates } : {}),
      }
    : null;

  return {
    name: yaml.name ?? "",
    type: "domain",
    version: yaml.version,
    author: yaml.author,
    installPath,
    contentHash: computeContentHash(content),
    config,
    skills: yaml.skills ?? [],
    tools,
    knowledge,
  };
}

/** Parse a YAML string into a SkillPackageManifest */
export function parseSkillPackageYaml(
  content: string,
  installPath: string,
  filePath?: string,
): SkillPackageManifest {
  const data = parse(content) as unknown;
  const errors = validatePackageYaml(data, filePath);
  if (errors.length > 0) throw new PackageYamlError(errors, filePath);

  const yaml = data as PackageYaml;

  if (yaml.type !== "skill") {
    throw new PackageYamlError([{ field: "type", message: 'Expected "skill"' }], filePath);
  }

  const skill: SkillConfig = {
    name: yaml.name ?? "",
    description: yaml.description ?? "",
    tools: [],
    triggers: (yaml.triggers ?? []).map((t) => ({
      event: t.event as EventType,
      ...(t.filter !== undefined ? { filter: t.filter } : {}),
    })),
    tags: (yaml.tags as string[]) ?? [],
    instructions: yaml.instructions ?? "",
    ...(yaml.handler !== undefined ? { handler: yaml.handler } : {}),
  };

  return {
    name: yaml.name ?? "",
    type: "skill",
    version: yaml.version,
    author: yaml.author,
    installPath,
    contentHash: computeContentHash(content),
    skill,
  };
}

/** Load a domain package YAML from disk */
export function loadDomainPackageYaml(
  filePath: string,
  installPath: string,
): DomainPackageManifest {
  const content = readFileSync(filePath, "utf-8");
  return parseDomainPackageYaml(content, installPath, filePath);
}

/** Load a skill package YAML from disk */
export function loadSkillPackageYaml(
  filePath: string,
  installPath: string,
): SkillPackageManifest {
  const content = readFileSync(filePath, "utf-8");
  return parseSkillPackageYaml(content, installPath, filePath);
}
