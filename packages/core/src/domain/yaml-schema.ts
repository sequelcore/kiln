// YAML representation of a domain config
// Mirrors DomainConfig but uses arrays instead of Sets for YAML compatibility

/** Quality gate as expressed in YAML */
export interface QualityGateYaml {
  readonly name: string;
  readonly command: string;
  readonly description: string;
  readonly required?: boolean; // defaults to true
}

/** MCP server tools configuration as expressed in YAML */
export interface DomainToolsYaml {
  readonly server: string;
}

/** Knowledge file references as expressed in YAML */
export interface DomainKnowledgeYaml {
  readonly examples?: string;
  readonly gates?: string;
}

/** Domain config as expressed in YAML */
export interface DomainYaml {
  readonly name: string;
  readonly displayName: string;
  readonly detectPatterns: readonly string[];
  readonly toolTags: readonly string[];
  readonly qualityGates: readonly QualityGateYaml[];
  readonly multishotExamples?: string; // defaults to ""
  readonly phaseExamples?: string; // defaults to ""
  // Marketplace package fields (optional)
  readonly version?: string;
  readonly author?: string;
  readonly skills?: readonly string[];
  readonly tools?: DomainToolsYaml;
  readonly knowledge?: DomainKnowledgeYaml;
}

/** Validation error from YAML parsing */
export interface YamlValidationError {
  readonly field: string;
  readonly message: string;
  readonly filePath?: string;
}

const REQUIRED_FIELDS = [
  "name",
  "displayName",
  "detectPatterns",
  "toolTags",
  "qualityGates",
] as const;

const GATE_REQUIRED_FIELDS = ["name", "command", "description"] as const;

/** Validate a parsed YAML object against the DomainYaml schema */
export function validateDomainYaml(
  data: unknown,
  filePath?: string,
): YamlValidationError[] {
  const errors: YamlValidationError[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push({ field: "(root)", message: "Expected an object", filePath });
    return errors;
  }

  const obj = data as Record<string, unknown>;

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in obj)) {
      errors.push({ field, message: `Missing required field "${field}"`, filePath });
    }
  }

  // Type checks for present fields
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
  if ("multishotExamples" in obj && typeof obj.multishotExamples !== "string") {
    errors.push({ field: "multishotExamples", message: `Expected string, got ${typeof obj.multishotExamples}`, filePath });
  }
  if ("phaseExamples" in obj && typeof obj.phaseExamples !== "string") {
    errors.push({ field: "phaseExamples", message: `Expected string, got ${typeof obj.phaseExamples}`, filePath });
  }

  // Marketplace optional fields
  if ("version" in obj && typeof obj.version !== "string") {
    errors.push({ field: "version", message: `Expected string, got ${typeof obj.version}`, filePath });
  }
  if ("author" in obj && typeof obj.author !== "string") {
    errors.push({ field: "author", message: `Expected string, got ${typeof obj.author}`, filePath });
  }
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

  // Quality gates validation
  if ("qualityGates" in obj) {
    if (!Array.isArray(obj.qualityGates)) {
      errors.push({ field: "qualityGates", message: `Expected array, got ${typeof obj.qualityGates}`, filePath });
    } else {
      for (let i = 0; i < obj.qualityGates.length; i++) {
        const gate = obj.qualityGates[i] as Record<string, unknown>;
        for (const gateField of GATE_REQUIRED_FIELDS) {
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

  return errors;
}
