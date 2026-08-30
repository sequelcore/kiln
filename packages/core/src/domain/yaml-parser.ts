import { parse } from "yaml";
import { KilnError } from "../engine/errors.js";
import type { DomainConfig } from "./index.js";
import type { DomainYaml } from "./yaml-schema.js";
import { validateDomainYaml } from "./yaml-schema.js";

export class DomainYamlError extends KilnError {
  readonly errors: readonly { field: string; message: string }[];
  readonly filePath?: string;

  constructor(
    errors: readonly { field: string; message: string }[],
    filePath?: string,
  ) {
    const msg = errors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
    super("DOMAIN_YAML_INVALID", `Invalid domain YAML${filePath ? ` (${filePath})` : ""}:\n${msg}`, {
      context: { errors, filePath },
      retryable: false,
    });
    this.name = "DomainYamlError";
    this.errors = errors;
    this.filePath = filePath;
  }
}

/** Parse a YAML string into a validated DomainConfig */
export function parseDomainYaml(content: string, filePath?: string): DomainConfig {
  const data = parse(content) as unknown;
  const errors = validateDomainYaml(data, filePath);
  if (errors.length > 0) throw new DomainYamlError(errors, filePath);

  // Safe cast: validation above confirmed the required shape
  const yaml = data as DomainYaml;

  return {
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
}
