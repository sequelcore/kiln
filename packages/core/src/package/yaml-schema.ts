// Package YAML schema: type-discriminated validation for domain and skill packages

import type { YamlValidationError } from "../domain/yaml-schema.js";

/** MCP server tools as expressed in package YAML */
export interface PackageToolsYaml {
  readonly server: string;
}

/** Knowledge references as expressed in package YAML */
export interface PackageKnowledgeYaml {
  readonly examples?: string;
  readonly gates?: string;
}

/** Package YAML: wraps either a domain.yaml or skill.yaml with distribution metadata */
export interface PackageYaml {
  readonly type: "domain" | "skill";
  readonly version: string;
  readonly author: string;
  // Domain package fields
  readonly name?: string;
  readonly displayName?: string;
  readonly detectPatterns?: readonly string[];
  readonly toolTags?: readonly string[];
  readonly qualityGates?: readonly { name: string; command: string; description: string; required?: boolean }[];
  readonly multishotExamples?: string;
  readonly phaseExamples?: string;
  readonly skills?: readonly string[];
  readonly tools?: PackageToolsYaml;
  readonly knowledge?: PackageKnowledgeYaml;
  // Skill package fields
  readonly description?: string;
  readonly instructions?: string;
  readonly triggers?: readonly { event: string; filter?: Record<string, unknown> }[];
  readonly tags?: readonly string[];
  readonly handler?: string;
}

const VALID_TYPES = ["domain", "skill"] as const;

/** Validate a parsed YAML object against the PackageYaml schema */
export function validatePackageYaml(
  data: unknown,
  filePath?: string,
): YamlValidationError[] {
  const errors: YamlValidationError[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push({ field: "(root)", message: "Expected an object", filePath });
    return errors;
  }

  const obj = data as Record<string, unknown>;

  // Required: type
  if (!("type" in obj)) {
    errors.push({ field: "type", message: 'Missing required field "type"', filePath });
  } else if (typeof obj.type !== "string" || !VALID_TYPES.includes(obj.type as "domain" | "skill")) {
    errors.push({ field: "type", message: 'Must be "domain" or "skill"', filePath });
  }

  // Required: version
  if (!("version" in obj)) {
    errors.push({ field: "version", message: 'Missing required field "version"', filePath });
  } else if (typeof obj.version !== "string") {
    errors.push({ field: "version", message: `Expected string, got ${typeof obj.version}`, filePath });
  }

  // Required: author
  if (!("author" in obj)) {
    errors.push({ field: "author", message: 'Missing required field "author"', filePath });
  } else if (typeof obj.author !== "string") {
    errors.push({ field: "author", message: `Expected string, got ${typeof obj.author}`, filePath });
  }

  // Type-specific validation
  if (obj.type === "domain") {
    validateDomainPackageFields(obj, errors, filePath);
  } else if (obj.type === "skill") {
    validateSkillPackageFields(obj, errors, filePath);
  }

  return errors;
}

function validateDomainPackageFields(
  obj: Record<string, unknown>,
  errors: YamlValidationError[],
  filePath?: string,
): void {
  // Domain packages require domain config fields
  const required = ["name", "displayName", "detectPatterns", "toolTags", "qualityGates"] as const;
  for (const field of required) {
    if (!(field in obj)) {
      errors.push({ field, message: `Missing required field "${field}" for domain package`, filePath });
    }
  }

  if ("name" in obj && typeof obj.name !== "string") {
    errors.push({ field: "name", message: `Expected string, got ${typeof obj.name}`, filePath });
  }
  if ("displayName" in obj && typeof obj.displayName !== "string") {
    errors.push({ field: "displayName", message: `Expected string, got ${typeof obj.displayName}`, filePath });
  }
  if ("detectPatterns" in obj && !Array.isArray(obj.detectPatterns)) {
    errors.push({ field: "detectPatterns", message: `Expected array, got ${typeof obj.detectPatterns}`, filePath });
  }
  if ("toolTags" in obj && !Array.isArray(obj.toolTags)) {
    errors.push({ field: "toolTags", message: `Expected array, got ${typeof obj.toolTags}`, filePath });
  }

  // skills: optional string array
  if ("skills" in obj) {
    if (!Array.isArray(obj.skills)) {
      errors.push({ field: "skills", message: `Expected array, got ${typeof obj.skills}`, filePath });
    } else {
      for (let i = 0; i < obj.skills.length; i++) {
        if (typeof obj.skills[i] !== "string") {
          errors.push({ field: `skills[${i}]`, message: `Expected string, got ${typeof obj.skills[i]}`, filePath });
        }
      }
    }
  }

  // tools: optional object with server field
  if ("tools" in obj) {
    if (typeof obj.tools !== "object" || obj.tools === null || Array.isArray(obj.tools)) {
      errors.push({ field: "tools", message: "Expected object with 'server' field", filePath });
    } else {
      const tools = obj.tools as Record<string, unknown>;
      if (!("server" in tools) || typeof tools.server !== "string") {
        errors.push({ field: "tools.server", message: "Required string field 'server' missing or invalid", filePath });
      }
    }
  }

  // knowledge: optional object
  if ("knowledge" in obj) {
    if (typeof obj.knowledge !== "object" || obj.knowledge === null || Array.isArray(obj.knowledge)) {
      errors.push({ field: "knowledge", message: "Expected object", filePath });
    } else {
      const knowledge = obj.knowledge as Record<string, unknown>;
      if ("examples" in knowledge && typeof knowledge.examples !== "string") {
        errors.push({ field: "knowledge.examples", message: `Expected string, got ${typeof knowledge.examples}`, filePath });
      }
      if ("gates" in knowledge && typeof knowledge.gates !== "string") {
        errors.push({ field: "knowledge.gates", message: `Expected string, got ${typeof knowledge.gates}`, filePath });
      }
    }
  }

  // qualityGates validation
  if ("qualityGates" in obj) {
    if (!Array.isArray(obj.qualityGates)) {
      errors.push({ field: "qualityGates", message: `Expected array, got ${typeof obj.qualityGates}`, filePath });
    } else {
      const gateFields = ["name", "command", "description"] as const;
      for (let i = 0; i < obj.qualityGates.length; i++) {
        const gate = obj.qualityGates[i] as Record<string, unknown>;
        for (const gateField of gateFields) {
          if (!(gateField in gate)) {
            errors.push({
              field: `qualityGates[${i}].${gateField}`,
              message: `Missing required field "${gateField}" in quality gate`,
              filePath,
            });
          }
        }
      }
    }
  }
}

function validateSkillPackageFields(
  obj: Record<string, unknown>,
  errors: YamlValidationError[],
  filePath?: string,
): void {
  // Skill packages require skill config fields
  const required = ["name", "description", "instructions"] as const;
  for (const field of required) {
    if (!(field in obj)) {
      errors.push({ field, message: `Missing required field "${field}" for skill package`, filePath });
    }
  }

  if ("name" in obj && typeof obj.name !== "string") {
    errors.push({ field: "name", message: `Expected string, got ${typeof obj.name}`, filePath });
  }
  if ("description" in obj && typeof obj.description !== "string") {
    errors.push({ field: "description", message: `Expected string, got ${typeof obj.description}`, filePath });
  }
  if ("instructions" in obj && typeof obj.instructions !== "string") {
    errors.push({ field: "instructions", message: `Expected string, got ${typeof obj.instructions}`, filePath });
  }
}
