export const KILN_CONFIG_READ_VIEWS = [
  "effective",
  "providers",
  "routes",
  "agents",
  "skills",
  "permissions",
  "memory",
  "projections",
  "health",
] as const;

export type KilnConfigReadView = typeof KILN_CONFIG_READ_VIEWS[number];

export type KilnConfigSourceStatus = "missing" | "valid" | "invalid";

export interface KilnConfigSourceSnapshot {
  readonly path: string;
  readonly status: KilnConfigSourceStatus;
  readonly error?: string;
}

export interface KilnConfigProjectSnapshot {
  readonly rootPath: string;
  readonly projectName: string;
  readonly hasGitRoot: boolean;
  readonly hasKilnYaml: boolean;
  readonly kilnYaml: KilnConfigSourceSnapshot;
  readonly projectContext: KilnConfigSourceSnapshot;
}

export type KilnProjectionTargetStatus =
  | "missing"
  | "current"
  | "stale"
  | "managed"
  | "drifted"
  | "unmanaged";

export interface KilnProjectionTargetSnapshot {
  readonly targetId: string;
  readonly path: string;
  readonly kind: "repo-shim" | "native";
  readonly status: KilnProjectionTargetStatus;
  readonly details?: string;
}

export interface KilnHarnessCapabilitySnapshot {
  readonly harness: string;
  readonly displayName: string;
  readonly runtimeConfigInjection: string;
  readonly nativeProjection: string;
  readonly nativeConfigImport: string;
  readonly mcpRuntimeTools: string;
  readonly hooks: string;
}

export interface KilnConfigStatusSnapshot {
  readonly generatedAt: string;
  readonly project: KilnConfigProjectSnapshot;
  readonly global: KilnConfigSourceSnapshot;
  readonly effectiveConfigStatus: KilnConfigSourceStatus;
  readonly effectiveConfig?: Record<string, unknown>;
  readonly errors: readonly string[];
  readonly projections: readonly KilnProjectionTargetSnapshot[];
  readonly harnessCapabilities: readonly KilnHarnessCapabilitySnapshot[];
}

export interface KilnConfigReadResult {
  readonly view: KilnConfigReadView;
  readonly snapshot: KilnConfigStatusSnapshot;
  readonly value: unknown;
}
