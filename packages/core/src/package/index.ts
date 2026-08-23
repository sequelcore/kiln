// Package: distribution infrastructure for domain and skill packages
// Handles versioning, bundling, security -- separate from domain config

export type {
  PackageManifest,
  SkillPackageManifest,
  PackageToolsConfig,
} from "./types.js";

export type { PackageYaml, PackageToolsYaml } from "./yaml-schema.js";
export { validatePackageYaml } from "./yaml-schema.js";

export {
  PackageYamlError,
  parseSkillPackageYaml,
  loadSkillPackageYaml,
} from "./yaml-parser.js";

export type { SecurityValidationResult } from "./security.js";
export {
  computeContentHash,
  validatePackageSecurity,
  validatePackageFiles,
} from "./security.js";
