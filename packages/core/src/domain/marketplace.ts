import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { DomainConfig } from "./index.js";
import type { DomainYaml, DomainToolsYaml, DomainKnowledgeYaml } from "./yaml-schema.js";
import { validateDomainYaml } from "./yaml-schema.js";
import { DomainYamlError } from "./yaml-parser.js";
import type { CapabilityAnnotations } from "../engine/domain/capability.js";

/** Package metadata for an installed domain package */
export interface DomainPackageManifest {
  readonly config: DomainConfig;
  readonly version: string;
  readonly author: string;
  readonly installPath: string;
  readonly skills: readonly string[];
  readonly tools: DomainToolsYaml | null;
  readonly knowledge: DomainKnowledgeYaml | null;
  readonly contentHash: string;
}

/** Result of security validation on a domain package */
export interface SecurityValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** Compute SHA-256 hash of file contents */
export function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/** Parse domain.yaml content into a full DomainPackageManifest */
export function parseDomainPackageYaml(
  content: string,
  installPath: string,
  filePath?: string,
): DomainPackageManifest {
  const data = parse(content) as unknown;
  const errors = validateDomainYaml(data, filePath);
  if (errors.length > 0) throw new DomainYamlError(errors, filePath);

  const yaml = data as DomainYaml;

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

  return {
    config,
    version: yaml.version ?? "0.0.0",
    author: yaml.author ?? "",
    installPath,
    skills: yaml.skills ?? [],
    tools: yaml.tools ?? null,
    knowledge: yaml.knowledge ?? null,
    contentHash: computeContentHash(content),
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

/** Verify a domain.yaml file has not been tampered with */
export function verifyContentHash(filePath: string, expectedHash: string): boolean {
  const content = readFileSync(filePath, "utf-8");
  return computeContentHash(content) === expectedHash;
}

const FORBIDDEN_SCRIPTS = [
  "preinstall",
  "install",
  "postinstall",
  "preuninstall",
  "uninstall",
  "postuninstall",
  "preprepare",
  "prepare",
  "postprepare",
  "prepublish",
  "prepublishOnly",
  "postpublish",
] as const;

const ALLOWED_EXTENSIONS = new Set([
  ".yaml",
  ".yml",
  ".md",
  ".ts",
  ".json",
  ".txt",
]);

/** Validate a domain package for security compliance */
export function validatePackageSecurity(
  packageJsonContent: string | null,
  fileList: readonly string[],
): SecurityValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check package.json for forbidden lifecycle scripts
  if (packageJsonContent !== null) {
    try {
      const pkg = JSON.parse(packageJsonContent) as Record<string, unknown>;
      const scripts = pkg.scripts as Record<string, unknown> | undefined;
      if (scripts && typeof scripts === "object") {
        for (const script of FORBIDDEN_SCRIPTS) {
          if (script in scripts) {
            errors.push(`Forbidden lifecycle script "${script}" found in package.json`);
          }
        }
      }
    } catch {
      errors.push("Invalid package.json: failed to parse JSON");
    }
  }

  // Check file extensions
  for (const file of fileList) {
    const ext = file.slice(file.lastIndexOf("."));
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      warnings.push(`Non-standard file extension "${ext}" in ${file}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** Apply safe defaults to capability annotations -- unannotated tools default to destructive */
export function applyDefaultAnnotations(annotations?: CapabilityAnnotations | null): CapabilityAnnotations {
  if (!annotations) {
    return { destructive: true, readOnly: false, idempotent: false };
  }
  return {
    destructive: annotations.destructive ?? true,
    readOnly: annotations.readOnly ?? false,
    idempotent: annotations.idempotent ?? false,
  };
}

const PATH_TRAVERSAL_PATTERN = /(^|[\\/])\.\.($|[\\/])/;
const ABSOLUTE_UNIX_PATTERN = /^\//;
const ABSOLUTE_WINDOWS_PATTERN = /^[A-Za-z]:\\/;

/** Validate package file paths for security violations */
export function validatePackageFiles(fileList: readonly string[]): SecurityValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const file of fileList) {
    if (PATH_TRAVERSAL_PATTERN.test(file)) {
      errors.push(`Path traversal detected in "${file}"`);
    }
    if (ABSOLUTE_UNIX_PATTERN.test(file)) {
      errors.push(`Absolute path detected: "${file}"`);
    }
    if (ABSOLUTE_WINDOWS_PATTERN.test(file)) {
      errors.push(`Absolute path detected: "${file}"`);
    }
  }

  // Warn about non-standard extensions
  for (const file of fileList) {
    const ext = file.slice(file.lastIndexOf("."));
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      warnings.push(`Non-standard file extension "${ext}" in ${file}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
