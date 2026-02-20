// Package security: content hashing, lifecycle script validation, path traversal detection
// Moved from domain/marketplace.ts -- package-level concern, not domain config

import { createHash } from "node:crypto";
import type { CapabilityAnnotations } from "../engine/domain/capability.js";

/** Result of security validation on a package */
export interface SecurityValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** Compute SHA-256 hash of file contents */
export function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/** Verify a file has not been tampered with */
export function verifyContentHash(content: string, expectedHash: string): boolean {
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

/** Validate a package for security compliance (lifecycle scripts + file extensions) */
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
