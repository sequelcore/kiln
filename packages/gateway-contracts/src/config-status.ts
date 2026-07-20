import { z } from "zod";

/** Version of status evidence that native-harness readers may treat as compatible. */
export const KILN_STATUS_EVIDENCE_VERSION = 1 as const;

export const KILN_WORK_GOVERNANCE_TRIGGERS = [
  "architecture",
  "security",
  "ui",
  "runtime",
  "provider-routing",
  "managed-agents",
  "config",
  "multi-file",
  "cross-surface",
  "long-running",
  "verification-heavy",
  "formal-proof-candidate",
] as const;

export const KILN_WORK_GOVERNANCE_EVIDENCE = [
  "surface-map",
  "risk-hypothesis",
  "spec",
  "plan",
  "tests",
  "typecheck",
  "visual-reference-research",
  "browser-qa",
  "managed-agent-review",
  "managed-orchestration:result-handoff",
  "managed-orchestration:completion-signal",
  "managed-orchestration:comparison-summary",
  "managed-orchestration:route-outcome",
  "managed-orchestration:adoption-gate",
  "managed-orchestration:diff",
  "managed-orchestration:verification",
  "managed-orchestration:review",
  "managed-orchestration:merge:compare-and-select",
  "managed-orchestration:merge:collect-all",
  "managed-orchestration:merge:first-success",
  "managed-orchestration:merge:manual-review-required",
  "managed-orchestration:merge:none",
  "formal-proof",
  "residual-risk",
] as const;

/**
 * The fully resolved policy shape consumed by a native-harness inspection.
 * Configuration parsing may accept partial operator input; an inspection never
 * authorizes from partial or unknown policy evidence.
 */
export const KilnResolvedWorkGovernancePolicySchema = z.object({
  defaultPosture: z.enum(["direct", "orchestrate"]),
  directExecution: z.object({
    maxFiles: z.number().int().positive(),
    maxRisk: z.enum(["low", "medium", "high"]),
  }).strict(),
  requireDelegationFor: z.array(z.enum(KILN_WORK_GOVERNANCE_TRIGGERS)),
  requiredEvidence: z.array(z.enum(KILN_WORK_GOVERNANCE_EVIDENCE)),
}).strict().superRefine((value, context) => {
  if (new Set(value.requireDelegationFor).size !== value.requireDelegationFor.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["requireDelegationFor"], message: "Delegation triggers must not be duplicated" });
  }
  if (new Set(value.requiredEvidence).size !== value.requiredEvidence.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["requiredEvidence"], message: "Required evidence entries must not be duplicated" });
  }
});

export type KilnResolvedWorkGovernancePolicy = z.infer<typeof KilnResolvedWorkGovernancePolicySchema>;

export const KILN_CONFIG_READ_VIEWS = [
  "effective",
  "providers",
  "routes",
  "agents",
  "skills",
  "permissions",
  "mcp",
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
  "sync-global-instruction-shims",
  "review-and-force-sync-repo-shims",
  "adopt-or-back-up-native-guidance",
  "adopt-or-back-up-global-instructions",
  "review-native-projection-drift",
  "review-global-instruction-drift",
] as const;

export const TRUSTED_EXECUTION_PROFILES = [
  "restricted",
  "workspace-write",
  "trusted-full-access",
] as const;

export const TRUSTED_EXECUTION_CLASSIFICATIONS = [
  "current-verified",
  "intentional-operator-override",
  "native-projection-drift",
  "runtime-policy-mismatch",
  "effective-policy-unproven",
  "unsupported-semantic-translation",
  "dangerous-unapproved-broadening",
  "stale-evidence",
  "partial-observation",
  "observation-failed",
] as const;

export const TRUSTED_EXECUTION_EVIDENCE_FRESHNESS = ["current", "stale", "unknown"] as const;
export const TRUSTED_EXECUTION_PROOF_STATUSES = ["proven", "inferred", "unavailable", "contradictory"] as const;
export const TRUSTED_EXECUTION_EVIDENCE_SOURCES = [
  "operator-local-config",
  "repository-config",
  "native-config",
  "desktop-ui-selection",
  "session-metadata",
  "runtime-observation",
  "managed-child-observation",
] as const;

export const KILN_SETUP_HARNESSES = ["codex", "claude-code", "opencode"] as const;

export type KilnSetupHarness = typeof KILN_SETUP_HARNESSES[number];

const TRUSTED_EXECUTION_PROFILE_AUTHORITY: Readonly<Record<typeof TRUSTED_EXECUTION_PROFILES[number], number>> = {
  restricted: 0,
  "workspace-write": 1,
  "trusted-full-access": 2,
};

function trustedExecutionAuthorizationIsComplete(
  authorization: {
    readonly status: "authorized" | "rejected" | "narrowed" | "unavailable";
    readonly scope?: "operator-local" | "repository";
    readonly authorizedBy?: string;
    readonly authorizedAt?: string;
    readonly revocable: boolean;
  },
): boolean {
  return authorization.status === "authorized"
    && authorization.scope === "operator-local"
    && authorization.authorizedBy !== undefined
    && authorization.authorizedAt !== undefined
    && authorization.revocable;
}

const TrustedExecutionEvidenceSchema = z.object({
  profile: z.enum(TRUSTED_EXECUTION_PROFILES),
  source: z.enum(TRUSTED_EXECUTION_EVIDENCE_SOURCES),
  observedAt: z.string().datetime(),
  verifiedAt: z.string().datetime().optional(),
  freshness: z.enum(TRUSTED_EXECUTION_EVIDENCE_FRESHNESS),
  proof: z.enum(TRUSTED_EXECUTION_PROOF_STATUSES),
  projectionOwnership: z.enum(["kiln-managed", "operator-owned", "unmanaged"]).optional(),
});

export const TrustedExecutionIntegritySchema = z.object({
  harness: z.enum(KILN_SETUP_HARNESSES),
  desired: TrustedExecutionEvidenceSchema,
  persistedNative: TrustedExecutionEvidenceSchema.optional(),
  sessionOverride: TrustedExecutionEvidenceSchema.optional(),
  effectiveRuntime: TrustedExecutionEvidenceSchema.optional(),
  enforcement: z.object({
    approvalControl: z.enum(["enforced", "not-enforced", "unknown"]),
    filesystemSandbox: z.enum(["enforced", "not-enforced", "unknown"]),
    networkBoundary: z.enum(["enforced", "not-enforced", "unknown"]),
    strength: z.enum(["strong", "rules-only", "weak", "none", "unknown"]),
  }),
  authorization: z.object({
    status: z.enum(["authorized", "rejected", "narrowed", "unavailable"]),
    scope: z.enum(["operator-local", "repository"]).optional(),
    authorizedBy: z.string().min(1).optional(),
    authorizedAt: z.string().datetime().optional(),
    revocable: z.boolean(),
    reason: z.string().optional(),
  }),
  semanticLoss: z.array(z.string()),
  classification: z.enum(TRUSTED_EXECUTION_CLASSIFICATIONS),
  recommendation: z.string(),
  remediationRequiresApproval: z.boolean(),
  lastVerifiedAt: z.string().datetime().optional(),
}).superRefine((value, context) => {
  const evidenceSlots = ["desired", "persistedNative", "sessionOverride", "effectiveRuntime"] as const;
  for (const slot of evidenceSlots) {
    const evidence = value[slot];
    if (evidence?.source === "desktop-ui-selection" && evidence.proof === "proven") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [slot, "proof"],
        message: "A desktop UI selection is not proof of effective runtime authority",
      });
    }
    if (evidence?.proof === "proven" && evidence.verifiedAt === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [slot, "verifiedAt"],
        message: "Proven evidence requires slot-local verification provenance",
      });
    }
  }
  if (value.harness === "opencode" && value.enforcement.filesystemSandbox === "enforced") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["enforcement", "filesystemSandbox"],
      message: "OpenCode permission resolution does not enforce a filesystem sandbox",
    });
  }
  const trustedAuthorization = trustedExecutionAuthorizationIsComplete(value.authorization);
  if (value.authorization.status === "authorized" && !trustedAuthorization) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["authorization"],
      message: "Trusted authorization requires complete, revocable operator-local provenance",
    });
  }
  const persistedNativeBroadensDesired = value.persistedNative !== undefined
    && TRUSTED_EXECUTION_PROFILE_AUTHORITY[value.persistedNative.profile]
      > TRUSTED_EXECUTION_PROFILE_AUTHORITY[value.desired.profile];
  const currentVerifiedEvidenceIsFresh = evidenceSlots.every((slot) => {
    const evidence = value[slot];
    return evidence === undefined || evidence.freshness === "current";
  });
  const currentVerifiedEvidenceIsNotContradictoryOrUnavailable = evidenceSlots.every((slot) => {
    const evidence = value[slot];
    return evidence === undefined || !["contradictory", "unavailable"].includes(evidence.proof);
  });
  const persistedNativeMatchesDesired = value.persistedNative === undefined
    || value.persistedNative.profile === value.desired.profile;
  const sessionOverrideMatchesDesired = value.sessionOverride === undefined
    || value.sessionOverride.profile === value.desired.profile;
  if (value.classification === "current-verified" && (
    value.desired.proof !== "proven"
    || value.desired.freshness !== "current"
    || value.desired.source === "desktop-ui-selection"
    || value.effectiveRuntime?.proof !== "proven"
    || value.effectiveRuntime.freshness !== "current"
    || !["runtime-observation", "managed-child-observation"].includes(value.effectiveRuntime.source)
    || value.effectiveRuntime.profile !== value.desired.profile
    || !currentVerifiedEvidenceIsFresh
    || !currentVerifiedEvidenceIsNotContradictoryOrUnavailable
    || !persistedNativeMatchesDesired
    || !sessionOverrideMatchesDesired
    || value.semanticLoss.length > 0
    || (value.desired.profile === "trusted-full-access" && !trustedAuthorization)
    || (persistedNativeBroadensDesired && !trustedAuthorization)
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["classification"],
      message: "Current verified state requires fresh matching runtime proof and valid trusted authorization",
    });
  }
});

export type TrustedExecutionIntegrity = z.infer<typeof TrustedExecutionIntegritySchema>;

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

export type KilnSkillOriginKind =
  | "builtin"
  | "user"
  | "project"
  | "plugin"
  | "native-harness";

export type KilnSkillCatalogProjectionStatus =
  | "missing"
  | "projected"
  | "drifted"
  | "unmanaged-native";

export type KilnSkillAdmissionState =
  | "available"
  | "admitted"
  | "omitted"
  | "blocked"
  | "unavailable";

export interface KilnSkillProjectionTargetSnapshot {
  readonly target: "claude" | "codex" | "opencode";
  readonly displayName: string;
  readonly path: string;
  readonly status: KilnSkillCatalogProjectionStatus;
}

export interface KilnSkillCatalogSnapshotEntry {
  readonly name: string;
  readonly description: string;
  readonly origin: KilnSkillOriginKind;
  readonly configured: boolean;
  readonly builtIn: boolean;
  readonly sourcePath: string;
  readonly tools?: readonly string[];
  readonly tags?: readonly string[];
  readonly projections: readonly KilnSkillProjectionTargetSnapshot[];
  readonly admission: {
    readonly state: KilnSkillAdmissionState;
    readonly reason: string;
  };
  readonly omissionReason?: string;
}

export interface KilnSkillCatalogSnapshot {
  readonly entries: readonly KilnSkillCatalogSnapshotEntry[];
}

export interface KilnProjectionTargetSnapshot {
  readonly targetId: string;
  readonly path: string;
  readonly kind: "repo-shim" | "native" | "global-instruction-shim" | "workflow-snapshot";
  readonly status: KilnProjectionTargetStatus;
  readonly details?: string;
  readonly managedFieldCount?: number;
  readonly updatedAt?: string;
  readonly permissionIntegrity?: TrustedExecutionIntegrity;
  readonly routeIntegrity?: {
    readonly canonicalRoute?: {
      readonly providerId: string;
      readonly model: string;
    };
    readonly nativeConfiguredDefault?: {
      readonly providerId: string;
      readonly model: string;
    };
    readonly selectedRuntimeRoute?: {
      readonly providerId: string;
      readonly model: string;
    };
    readonly catalogStatus: {
      readonly status: string;
      readonly providerId?: string;
      readonly model?: string;
      readonly reason?: string;
    };
    readonly explicitProbeStatus: string;
    readonly credentialSource: string;
    readonly bareProofSupported: boolean;
    readonly routeStatus:
      | "matches-canonical"
      | "native-default-invalid"
      | "missing-default"
      | "unavailable"
      | "unknown-model"
      | "stale-catalog"
      | "drifted"
      | "unsupported-proof"
      | "unknown";
    readonly credentialStatus: "valid" | "invalid" | "unauthorized" | "not-tested" | "unknown";
    readonly classification: string;
  };
}

export interface KilnGlobalInstructionShimSetupSnapshot extends KilnProjectionTargetSnapshot {
  readonly kind: "global-instruction-shim";
  readonly harness: KilnSetupHarness;
  readonly recommendation: KilnConfigSetupAction;
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
  | "sync-global-instruction-shims"
  | "review-and-force-sync-repo-shims"
  | "adopt-or-back-up-native-guidance"
  | "adopt-or-back-up-global-instructions"
  | "review-native-projection-drift"
  | "review-global-instruction-drift";

export const GUI_EXECUTABLE_CONFIG_SETUP_ACTIONS = [
  "adopt-project-context",
  "sync-repo-shims",
  "sync-native-projections",
  "sync-global-instruction-shims",
] as const satisfies readonly KilnConfigSetupAction[];

export function isGuiExecutableConfigSetupAction(
  action: KilnConfigSetupAction,
): action is typeof GUI_EXECUTABLE_CONFIG_SETUP_ACTIONS[number] {
  return GUI_EXECUTABLE_CONFIG_SETUP_ACTIONS.includes(
    action as typeof GUI_EXECUTABLE_CONFIG_SETUP_ACTIONS[number],
  );
}

export interface KilnHarnessCapabilitySnapshot {
  readonly harness: string;
  readonly displayName: string;
  readonly runtimeConfigInjection: string;
  readonly nativeProjection: string;
  readonly nativeConfigImport: string;
  readonly mcpRuntimeTools: string;
  readonly hooks: string;
  readonly crossHarnessManagedInvocation: {
    readonly adapterId: string;
    readonly supportedProviderIds: readonly string[];
  };
}

export interface KilnConfigSetupSnapshot {
  readonly projectRoot: string;
  readonly projectContext: KilnConfigSourceSnapshot & {
    readonly recommendation: KilnConfigSetupAction;
  };
  readonly repoShims: readonly KilnRepoShimProjectionSnapshot[];
  readonly globalInstructionShims: readonly KilnGlobalInstructionShimSetupSnapshot[];
  readonly nativeProjections: readonly KilnProjectionTargetSnapshot[];
  readonly permissionIntegrity: readonly TrustedExecutionIntegrity[];
  readonly skills?: KilnSkillCatalogSnapshot;
  readonly mcp?: KilnMcpStatusSnapshot;
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

export interface KilnMcpConfigurationDiagnosticSnapshot {
  readonly code: string;
  readonly message: string;
  readonly serverId: string;
  readonly scope: "global" | "project";
  readonly field?: string;
  readonly sourcePath: string;
  readonly reference?: string;
}

export interface KilnMcpServerStatusSnapshot {
  readonly id: string;
  readonly enabled: boolean;
  readonly source: "global" | "project" | "overridden" | "disabled-by-project";
  readonly transport: "stdio" | "streamable-http";
  readonly admission: "admitted" | "denied";
  readonly trust: "untrusted" | "local" | "verified";
  readonly provenance: Readonly<Record<string, {
    readonly scope: "global" | "project";
    readonly sourcePath: string;
    readonly field: string;
  }>>;
  readonly runtimeCompatibility: {
    readonly status: "compatible" | "incompatible" | "not-evaluated";
    readonly reason?: string;
  };
  readonly projectionCompatibility: readonly {
    readonly harness: "claude" | "codex" | "opencode";
    readonly status: "compatible" | "incompatible" | "not-evaluated";
    readonly reason?: string;
  }[];
  readonly health: {
    readonly state: "not-tested" | "healthy" | "degraded" | "unavailable" | "disabled";
    readonly lastFailure?: string;
  };
  readonly discovery: {
    readonly state: "not-tested" | "current" | "changed" | "failed" | "disabled";
    readonly tools: number;
    readonly resources: number;
    readonly prompts: number;
    readonly admitted: number;
    readonly capabilities: readonly {
      readonly selector: string;
      readonly kind: "tool" | "resource" | "prompt";
      readonly name: string;
      readonly admitted: boolean;
    }[];
  };
  readonly projection: {
    readonly state: "not-synchronized" | "current" | "drifted" | "incompatible" | "disabled";
  };
}

export interface KilnMcpStatusSnapshot {
  readonly servers: readonly KilnMcpServerStatusSnapshot[];
  readonly diagnostics: readonly KilnMcpConfigurationDiagnosticSnapshot[];
}

export interface KilnConfigStatusSnapshot {
  /** Optional for backwards-compatible transport decoding; consumers require it before authorization. */
  readonly evidenceVersion?: number;
  readonly generatedAt: string;
  readonly project: KilnConfigProjectSnapshot;
  readonly global: KilnConfigSourceSnapshot;
  readonly effectiveConfigStatus: KilnConfigSourceStatus;
  readonly effectiveConfig?: Record<string, unknown>;
  readonly errors: readonly string[];
  readonly mcp: KilnMcpStatusSnapshot;
  readonly projections: readonly KilnProjectionTargetSnapshot[];
  readonly permissionIntegrity: readonly TrustedExecutionIntegrity[];
  readonly skills?: KilnSkillCatalogSnapshot;
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

const NativeRouteCatalogStatusSchema = z.enum([
  "available",
  "authentication-failed",
  "authorization-failed",
  "unknown-model",
  "unavailable-route",
  "stale-catalog",
  "disabled-provider",
  "missing-default",
  "not-observable",
]);

const NativeRouteProbeStatusSchema = z.enum([
  "succeeded",
  "authentication-failed",
  "authorization-failed",
  "unknown-model",
  "unavailable-route",
  "timeout",
  "not-run",
]);

const NativeRouteIntegrityClassificationSchema = z.enum([
  "ok",
  "authentication-failure",
  "authorization-failure",
  "unknown-model",
  "unavailable-route",
  "stale-catalog",
  "projection-drift",
  "ambient-fallback-mismatch",
  "missing-default",
  "unsupported-proof",
  "transient",
]);

export const KilnProjectionTargetSnapshotSchema = z.object({
  targetId: z.string(),
  path: z.string(),
  kind: z.enum(["repo-shim", "native", "global-instruction-shim", "workflow-snapshot"]),
  status: z.enum(KILN_PROJECTION_TARGET_STATUSES),
  details: z.string().optional(),
  managedFieldCount: z.number().int().nonnegative().optional(),
  updatedAt: z.string().datetime().optional(),
  permissionIntegrity: TrustedExecutionIntegritySchema.optional(),
  routeIntegrity: z.object({
    canonicalRoute: z.object({
      providerId: z.string(),
      model: z.string(),
    }).optional(),
    nativeConfiguredDefault: z.object({
      providerId: z.string(),
      model: z.string(),
    }).optional(),
    selectedRuntimeRoute: z.object({
      providerId: z.string(),
      model: z.string(),
    }).optional(),
    catalogStatus: z.object({
      status: NativeRouteCatalogStatusSchema,
      providerId: z.string().optional(),
      model: z.string().optional(),
      reason: z.string().optional(),
    }),
    explicitProbeStatus: NativeRouteProbeStatusSchema,
    credentialSource: z.enum(["env", "kiln-auth-store", "native-auth-store", "none", "unknown"]),
    bareProofSupported: z.boolean(),
    routeStatus: z.enum([
      "matches-canonical",
      "native-default-invalid",
      "missing-default",
      "unavailable",
      "unknown-model",
      "stale-catalog",
      "drifted",
      "unsupported-proof",
      "unknown",
    ]),
    credentialStatus: z.enum(["valid", "invalid", "unauthorized", "not-tested", "unknown"]),
    classification: NativeRouteIntegrityClassificationSchema,
  }).optional(),
});

export const KilnGlobalInstructionShimSetupSnapshotSchema = KilnProjectionTargetSnapshotSchema.extend({
  kind: z.literal("global-instruction-shim"),
  harness: z.enum(KILN_SETUP_HARNESSES),
  recommendation: z.enum(KILN_CONFIG_SETUP_ACTIONS),
});

export const KilnRepoShimProjectionSnapshotSchema = z.object({
  target: z.enum(["agents", "claude"]),
  targetId: z.string(),
  path: z.string(),
  status: z.enum(["missing", "current", "stale", "drifted", "unmanaged"]),
  recommendation: z.enum(KILN_CONFIG_SETUP_ACTIONS),
});

export const KilnSkillProjectionTargetSnapshotSchema = z.object({
  target: z.enum(["claude", "codex", "opencode"]),
  displayName: z.string(),
  path: z.string(),
  status: z.enum(["missing", "projected", "drifted", "unmanaged-native"]),
});

export const KilnSkillCatalogSnapshotEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  origin: z.enum(["builtin", "user", "project", "plugin", "native-harness"]),
  configured: z.boolean(),
  builtIn: z.boolean(),
  sourcePath: z.string(),
  tools: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  projections: z.array(KilnSkillProjectionTargetSnapshotSchema),
  admission: z.object({
    state: z.enum(["available", "admitted", "omitted", "blocked", "unavailable"]),
    reason: z.string(),
  }),
  omissionReason: z.string().optional(),
});

export const KilnSkillCatalogSnapshotSchema = z.object({
  entries: z.array(KilnSkillCatalogSnapshotEntrySchema),
});

export const KilnMcpStatusSnapshotSchema = z.object({
  servers: z.array(z.object({
    id: z.string(), enabled: z.boolean(), source: z.enum(["global", "project", "overridden", "disabled-by-project"]),
    transport: z.enum(["stdio", "streamable-http"]), admission: z.enum(["admitted", "denied"]),
    trust: z.enum(["untrusted", "local", "verified"]),
    provenance: z.record(z.string(), z.object({ scope: z.enum(["global", "project"]), sourcePath: z.string(), field: z.string() })),
    runtimeCompatibility: z.object({ status: z.enum(["compatible", "incompatible", "not-evaluated"]), reason: z.string().optional() }),
    projectionCompatibility: z.array(z.object({ harness: z.enum(["claude", "codex", "opencode"]), status: z.enum(["compatible", "incompatible", "not-evaluated"]), reason: z.string().optional() })),
    health: z.object({ state: z.enum(["not-tested", "healthy", "degraded", "unavailable", "disabled"]), lastFailure: z.string().optional() }),
    discovery: z.object({
      state: z.enum(["not-tested", "current", "changed", "failed", "disabled"]),
      tools: z.number().int().nonnegative(), resources: z.number().int().nonnegative(), prompts: z.number().int().nonnegative(), admitted: z.number().int().nonnegative(),
      capabilities: z.array(z.object({ selector: z.string(), kind: z.enum(["tool", "resource", "prompt"]), name: z.string(), admitted: z.boolean() })),
    }),
    projection: z.object({ state: z.enum(["not-synchronized", "current", "drifted", "incompatible", "disabled"]) }),
  })),
  diagnostics: z.array(z.object({
    code: z.string(), message: z.string(), serverId: z.string(), scope: z.enum(["global", "project"]),
    field: z.string().optional(), sourcePath: z.string(), reference: z.string().optional(),
  })),
});

export const KilnConfigSetupSnapshotSchema = z.object({
  projectRoot: z.string(),
  projectContext: KilnConfigSourceSnapshotSchema.extend({
    recommendation: z.enum(KILN_CONFIG_SETUP_ACTIONS),
  }),
  repoShims: z.array(KilnRepoShimProjectionSnapshotSchema),
  globalInstructionShims: z.array(KilnGlobalInstructionShimSetupSnapshotSchema),
  nativeProjections: z.array(KilnProjectionTargetSnapshotSchema),
  permissionIntegrity: z.array(TrustedExecutionIntegritySchema),
  skills: KilnSkillCatalogSnapshotSchema.optional(),
  mcp: KilnMcpStatusSnapshotSchema.optional(),
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

export const KilnConfigStatusSnapshotSchema = z.object({
  evidenceVersion: z.number().int().positive().optional(),
  generatedAt: z.string().datetime(),
  project: z.object({
    rootPath: z.string(),
    projectName: z.string(),
    hasGitRoot: z.boolean(),
    hasKilnYaml: z.boolean(),
    kilnYaml: KilnConfigSourceSnapshotSchema,
    projectContext: KilnConfigSourceSnapshotSchema,
  }),
  global: KilnConfigSourceSnapshotSchema,
  effectiveConfigStatus: z.enum(KILN_CONFIG_SOURCE_STATUSES),
  effectiveConfig: z.record(z.string(), z.unknown()).optional(),
  errors: z.array(z.string()),
  mcp: KilnMcpStatusSnapshotSchema,
  projections: z.array(KilnProjectionTargetSnapshotSchema),
  permissionIntegrity: z.array(TrustedExecutionIntegritySchema),
  skills: KilnSkillCatalogSnapshotSchema.optional(),
  setup: KilnConfigSetupSnapshotSchema,
  harnessCapabilities: z.array(z.object({
    harness: z.enum(["claude", "codex", "opencode"]),
    displayName: z.enum(["Claude Code", "Codex", "OpenCode"]),
    runtimeConfigInjection: z.enum(["supported", "not-proven", "CODEX_HOME + CLI config overrides", "OPENCODE_CONFIG_CONTENT"]),
    nativeProjection: z.enum(["install-state", "unsupported"]),
    nativeConfigImport: z.enum(["supported", "unsupported"]),
    mcpRuntimeTools: z.enum(["supported", "unsupported"]),
    hooks: z.enum(["supported", "unsupported"]),
    crossHarnessManagedInvocation: z.object({
      adapterId: z.string(),
      supportedProviderIds: z.array(z.string()),
    }),
  })),
});
