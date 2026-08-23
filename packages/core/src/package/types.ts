// Package: distribution types for domain and skill packages
// Separate from domain (environment config) -- package handles versioning, bundling, security

import type { DomainConfig } from "../domain/index.js";
import type { SkillConfig } from "../skill/types.js";

/** MCP server tools configuration for a package */
export interface PackageToolsConfig {
  readonly server: string;
}

/** Base manifest for any installable package */
export interface PackageManifest {
  readonly name: string;
  readonly type: "domain" | "skill";
  readonly version: string;
  readonly author: string;
  readonly contentHash: string;
  readonly installPath: string;
}

/** Manifest for an installed domain package */
export interface DomainPackageManifest extends PackageManifest {
  readonly type: "domain";
  readonly config: DomainConfig;
  readonly skills: readonly string[];
  readonly tools: PackageToolsConfig | null;
}

/** Manifest for an installed skill package */
export interface SkillPackageManifest extends PackageManifest {
  readonly type: "skill";
  readonly skill: SkillConfig;
}
