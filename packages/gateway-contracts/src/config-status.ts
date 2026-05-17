import { z } from "zod";

export const KILN_CONFIG_READ_VIEWS = [
  "effective",
  "providers",
  "routes",
  "agents",
  "skills",
  "permissions",
  "memory",
  "projections",
  "setup",
  "health",
] as const;

export type KilnConfigReadView = typeof KILN_CONFIG_READ_VIEWS[number];

export type KilnConfigSourceStatus = "missing" | "valid" | "invalid";

export const KILN_CONFIG_SOURCE_STATUSES = [
  "missing",
  "valid",
  "invalid",
] as const;

export const KILN_PROJECTION_TARGET_STATUSES = [
  "missing",
  "current",
  "stale",
  "managed",
  "drifted",
  "unmanaged",
] as const;

export const KILN_CONFIG_SETUP_ACTIONS = [
  "none",
  "adopt-project-context",
  "review-project-context",
  "sync-repo-shims",
  "sync-native-projections",
  "review-and-force-sync-repo-shims",
  "adopt-or-back-up-native-guidance",
  "review-native-projection-drift",
] as const;

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
  readonly kind: "repo-shim" | "native" | "workflow-snapshot";
  readonly status: KilnProjectionTargetStatus;
  readonly details?: string;
}

export interface KilnRepoShimProjectionSnapshot {
  readonly target: "agents" | "claude";
  readonly targetId: string;
  readonly path: string;
  readonly status: Extract<KilnProjectionTargetStatus, "missing" | "current" | "stale" | "drifted" | "unmanaged">;
  readonly recommendation: KilnConfigSetupAction;
}

export type KilnConfigSetupAction =
  | "none"
  | "adopt-project-context"
  | "review-project-context"
  | "sync-repo-shims"
  | "sync-native-projections"
  | "review-and-force-sync-repo-shims"
  | "adopt-or-back-up-native-guidance"
  | "review-native-projection-drift";

export interface KilnHarnessCapabilitySnapshot {
  readonly harness: string;
  readonly displayName: string;
  readonly runtimeConfigInjection: string;
  readonly nativeProjection: string;
  readonly nativeConfigImport: string;
  readonly mcpRuntimeTools: string;
  readonly hooks: string;
}

export interface KilnConfigSetupSnapshot {
  readonly projectRoot: string;
  readonly projectContext: KilnConfigSourceSnapshot & {
    readonly recommendation: KilnConfigSetupAction;
  };
  readonly repoShims: readonly KilnRepoShimProjectionSnapshot[];
  readonly nativeProjections: readonly KilnProjectionTargetSnapshot[];
  readonly recommendedActions: readonly KilnConfigSetupAction[];
}

export type KilnConfigSetupActionStatus = "applied" | "blocked" | "noop" | "failed";

export interface KilnConfigSetupActionRequest {
  readonly action: KilnConfigSetupAction;
}

export interface KilnConfigSetupActionResult {
  readonly action: KilnConfigSetupAction;
  readonly status: KilnConfigSetupActionStatus;
  readonly message: string;
  readonly errors: readonly string[];
  readonly setup: KilnConfigSetupSnapshot;
}

export interface KilnConfigStatusSnapshot {
  readonly generatedAt: string;
  readonly project: KilnConfigProjectSnapshot;
  readonly global: KilnConfigSourceSnapshot;
  readonly effectiveConfigStatus: KilnConfigSourceStatus;
  readonly effectiveConfig?: Record<string, unknown>;
  readonly errors: readonly string[];
  readonly projections: readonly KilnProjectionTargetSnapshot[];
  readonly setup: KilnConfigSetupSnapshot;
  readonly harnessCapabilities: readonly KilnHarnessCapabilitySnapshot[];
}

export interface KilnConfigReadResult {
  readonly view: KilnConfigReadView;
  readonly snapshot: KilnConfigStatusSnapshot;
  readonly value: unknown;
}

export const KilnConfigSourceSnapshotSchema = z.object({
  path: z.string(),
  status: z.enum(KILN_CONFIG_SOURCE_STATUSES),
  error: z.string().optional(),
});

export const KilnProjectionTargetSnapshotSchema = z.object({
  targetId: z.string(),
  path: z.string(),
  kind: z.enum(["repo-shim", "native", "workflow-snapshot"]),
  status: z.enum(KILN_PROJECTION_TARGET_STATUSES),
  details: z.string().optional(),
});

export const KilnRepoShimProjectionSnapshotSchema = z.object({
  target: z.enum(["agents", "claude"]),
  targetId: z.string(),
  path: z.string(),
  status: z.enum(["missing", "current", "stale", "drifted", "unmanaged"]),
  recommendation: z.enum(KILN_CONFIG_SETUP_ACTIONS),
});

export const KilnConfigSetupSnapshotSchema = z.object({
  projectRoot: z.string(),
  projectContext: KilnConfigSourceSnapshotSchema.extend({
    recommendation: z.enum(KILN_CONFIG_SETUP_ACTIONS),
  }),
  repoShims: z.array(KilnRepoShimProjectionSnapshotSchema),
  nativeProjections: z.array(KilnProjectionTargetSnapshotSchema),
  recommendedActions: z.array(z.enum(KILN_CONFIG_SETUP_ACTIONS)),
});

export const KILN_CONFIG_SETUP_ACTION_STATUSES = [
  "applied",
  "blocked",
  "noop",
  "failed",
] as const;

export const KilnConfigSetupActionRequestSchema = z.object({
  action: z.enum(KILN_CONFIG_SETUP_ACTIONS),
});

export const KilnConfigSetupActionResultSchema = z.object({
  action: z.enum(KILN_CONFIG_SETUP_ACTIONS),
  status: z.enum(KILN_CONFIG_SETUP_ACTION_STATUSES),
  message: z.string(),
  errors: z.array(z.string()),
  setup: KilnConfigSetupSnapshotSchema,
});
