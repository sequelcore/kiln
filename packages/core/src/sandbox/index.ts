/** Filesystem access policy */
export type FsPolicy = "read-only" | "read-write" | "none";

/** Network access policy */
export type NetPolicy = "none" | "package-managers" | "documentation" | "full";

/** Sandbox configuration per agent */
export interface SandboxConfig {
  readonly fsPolicy: FsPolicy;
  readonly netPolicy: NetPolicy;
  readonly allowedPaths: readonly string[];
  readonly deniedPaths: readonly string[];
  readonly allowedDomains: readonly string[];
}

export { SandboxPolicy, createPolicy, createTenantSandbox, ROLE_PRESETS } from "./policies.js";
export { PathValidator, isSubPath } from "./path-validator.js";
export type { ValidationResult } from "./path-validator.js";
export {
  assertBoundHostToolSandbox,
  createBoundHostToolSandbox,
} from "./host-tool-sandbox.js";
export type {
  BoundHostToolSandbox,
  BoundHostToolSandboxAdmission,
} from "./host-tool-sandbox.js";
export {
  NetworkFilter,
  PACKAGE_MANAGER_DOMAINS,
  DOCUMENTATION_DOMAINS,
} from "./network-filter.js";
