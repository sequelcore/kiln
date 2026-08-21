import { z } from "zod";

/** Version of status evidence that native-harness readers may treat as compatible. */
export const KILN_STATUS_EVIDENCE_VERSION = 3 as const;

/** Breaking revision of the secret-free effective-configuration projection. */
export const KILN_EFFECTIVE_CONFIG_SCHEMA_REVISION = 1 as const;

export const KILN_WORK_GOVERNANCE_TRIGGERS = [
  "architecture",
  "security",
  "ui",
  "runtime",
  "provider-routing",
  "managed-agents",
  "config",
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

const KILN_BOUNDED_WORK_EFFECTS = [
  "inspect",
  "modify_source",
  "modify_tests",
  "modify_documentation",
  "modify_configuration",
  "run_verification",
  "invoke_managed_agent",
  "external_write",
] as const;

const KilnResolvedBoundedWorkCeilingSchema = z.object({
  allowedEffects: z.array(z.enum(KILN_BOUNDED_WORK_EFFECTS)).optional(),
  allowedRoots: z.array(z.string().min(1)).optional(),
  deniedRoots: z.array(z.string().min(1)).optional(),
  maximumLimits: z.object({
    maxExecutionAttempts: z.number().int().positive().optional(),
    maxManagedInvocations: z.number().int().nonnegative().optional(),
    maxConcurrentManagedInvocations: z.number().int().nonnegative().optional(),
    maxChildDepth: z.number().int().nonnegative().optional(),
    maxReviewRounds: z.number().int().nonnegative().optional(),
    maxRemediationRounds: z.number().int().nonnegative().optional(),
    maxToolCalls: z.number().int().nonnegative().optional(),
    maxActiveDurationMs: z.number().int().nonnegative().optional(),
  }).strict().optional(),
  minimumHarnessCapability: z.enum(["authoritative", "partially_enforced", "advisory_only"]).optional(),
}).strict();

/**
 * The fully resolved policy shape consumed by a native-harness inspection.
 * Configuration parsing may accept partial operator input; an inspection never
 * authorizes from partial or unknown policy evidence.
 */
export const KilnResolvedWorkGovernancePolicySchema = z.object({
  defaultPosture: z.enum(["direct", "orchestrate"]),
  requireDelegationFor: z.array(z.enum(KILN_WORK_GOVERNANCE_TRIGGERS)),
  requiredEvidence: z.array(z.enum(KILN_WORK_GOVERNANCE_EVIDENCE)),
  boundedWorkCeiling: KilnResolvedBoundedWorkCeilingSchema.optional(),
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

export type KilnEffectiveConfigHealth = "current" | "stale" | "drifted" | "unknown";
export type KilnEffectiveConfigActivation = "hot" | "next-turn" | "next-session" | "reconcile" | "restart-required";
export type KilnEffectiveConfigSensitivity = "public" | "secret-reference";
export type KilnEffectiveConfigSource = "default" | "global" | "project" | "composed";

export interface KilnEffectiveConfigOverrideStep {
  readonly scope: "default" | "global" | "project";
  readonly sourcePath: string;
  readonly disposition: "default" | "selected" | "contributed" | "overridden";
}

export interface KilnEffectiveConfigFieldSnapshot {
  /** Canonical RFC 6901 JSON pointer in the effective configuration namespace. */
  readonly identity: string;
  readonly value?: unknown;
  readonly redacted?: { readonly present: true };
  readonly scope: "effective";
  readonly source: KilnEffectiveConfigSource;
  readonly sourcePath: string;
  readonly defaultStatus: "default" | "explicit";
  readonly overrideChain: readonly KilnEffectiveConfigOverrideStep[];
  readonly health: KilnEffectiveConfigHealth;
  readonly schemaRevision: number;
  readonly activation: KilnEffectiveConfigActivation;
  readonly sensitivity: KilnEffectiveConfigSensitivity;
}

export interface KilnEffectiveConfigSnapshot {
  readonly schemaRevision: number;
  readonly health: KilnEffectiveConfigHealth;
  readonly fields: readonly KilnEffectiveConfigFieldSnapshot[];
}

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
const TrustedExecutionSemanticLimitationSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
  harness: z.enum(KILN_SETUP_HARNESSES), message: z.string().min(1), sourceUrl: z.string().url(),
  upstreamRevision: z.string().regex(/^[a-f0-9]{40}$/), sourceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  observedAt: z.string().datetime(), reviewAfter: z.string().datetime(),
}).refine((value) => Date.parse(value.reviewAfter) > Date.parse(value.observedAt), "reviewAfter must follow observedAt");
const TrustedExecutionLimitationAcceptanceSchema = z.object({
  limitationId: z.string().min(1), harness: z.enum(KILN_SETUP_HARNESSES), sourceUrl: z.string().url(),
  upstreamRevision: z.string().regex(/^[a-f0-9]{40}$/), sourceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  acceptedBy: z.string().min(1), acceptedAt: z.string().datetime(), reviewAfter: z.string().datetime(), revocable: z.literal(true),
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
  semanticLimitations: z.array(TrustedExecutionSemanticLimitationSchema),
  limitationAcceptances: z.array(TrustedExecutionLimitationAcceptanceSchema),
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
  const acceptedLimitationIds = new Set(value.limitationAcceptances.flatMap((acceptance) => {
    const descriptor = value.semanticLimitations.find((candidate) => candidate.id === acceptance.limitationId);
    return descriptor && descriptor.harness === acceptance.harness && descriptor.sourceUrl === acceptance.sourceUrl
      && descriptor.upstreamRevision === acceptance.upstreamRevision && descriptor.sourceDigest === acceptance.sourceDigest
      && Date.parse(acceptance.reviewAfter) <= Date.parse(descriptor.reviewAfter) ? [acceptance.limitationId] : [];
  }));
  if (value.limitationAcceptances.length !== acceptedLimitationIds.size) context.addIssue({ code: z.ZodIssueCode.custom, path: ["limitationAcceptances"], message: "Limitation acceptance must exactly bind a current descriptor" });
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
    || value.semanticLimitations.length > 0
    || (value.desired.profile === "trusted-full-access" && !trustedAuthorization)
    || (persistedNativeBroadensDesired && !trustedAuthorization)
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["classification"],
      message: "Current verified state requires fresh matching runtime proof and valid trusted authorization",
    });
  }
  if (value.semanticLimitations.length > 0 && !value.remediationRequiresApproval
    && acceptedLimitationIds.size !== value.semanticLimitations.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["remediationRequiresApproval"], message: "Unaccepted, expired, or mismatched limitations require remediation" });
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

export type KilnSkillVisibility = "implicit" | "explicit-only" | "disabled";
export type KilnSkillVisibilityCapability = "exact" | "unsupported";

export interface KilnSkillProjectionTargetSnapshot {
  readonly target: "claude" | "codex" | "opencode";
  readonly displayName: string;
  readonly path: string;
  readonly status: KilnSkillCatalogProjectionStatus;
  readonly effectiveVisibility: KilnSkillVisibility;
  readonly visibilityCapability: KilnSkillVisibilityCapability;
  readonly visibilityReason: string;
}

export interface KilnSkillCatalogSnapshotEntry {
  readonly name: string;
  readonly description: string;
  readonly origin: KilnSkillOriginKind;
  readonly configured: boolean;
  readonly builtIn: boolean;
  readonly sourcePath: string;
  readonly desiredVisibility: KilnSkillVisibility;
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
  readonly inventory?: KilnSkillSourceInventorySnapshot;
}

export type KilnSkillSourceKind = "kiln-user" | "kiln-project" | "builtin" | "shared-agents" | "native-harness" | "system" | "plugin";
export type KilnSkillSourceRelationship = "canonical" | "external" | "managed-projection" | "linked-alias";
export type KilnSkillIdentityClassification = "unique" | "equivalent-duplicate" | "divergent-collision" | "case-collision";

export interface KilnSkillSourceCandidateSnapshot {
  readonly name: string;
  readonly canonicalName: string;
  readonly sourceKind: KilnSkillSourceKind;
  readonly sourceId: string;
  readonly exposureScope: "user" | "project" | "harness" | "builtin";
  readonly sourcePath: string;
  readonly relationship: KilnSkillSourceRelationship;
  readonly relatedCanonicalName?: string;
  readonly relatedSourceId?: string;
  readonly packageDigest: string;
  readonly descriptionBytes: number;
  readonly version?: string;
  readonly compatibility?: string;
  readonly license?: string;
  readonly trust: {
    readonly level: "builtin" | "local-configured" | "external-unverified";
    readonly reason: string;
  };
  readonly freshness: {
    readonly status: "current" | "unknown";
    readonly reason: string;
  };
  readonly dependencies: {
    readonly allowedTools: readonly string[];
    readonly executableResources: number;
  };
  readonly health: {
    readonly status: "healthy" | "warning" | "blocked";
    readonly fileCount: number;
    readonly packageBytes: number;
    readonly brokenResourceCount: number;
    readonly riskSignals: readonly {
      readonly kind: "code-execution" | "network-access" | "credential-pattern" | "outside-filesystem-access";
      readonly path: string;
    }[];
    readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly path?: string }[];
  };
  readonly applicableHarnesses: readonly ("claude" | "codex" | "opencode")[];
  readonly effectiveVisibility: "implicit" | "explicit-only" | "disabled";
}

export interface KilnSkillIdentitySnapshot {
  readonly canonicalName: string;
  readonly names: readonly string[];
  readonly candidateSourceIds: readonly string[];
  readonly classification: KilnSkillIdentityClassification;
}

export interface KilnSkillInventoryDiagnosticSnapshot {
  readonly code: string;
  readonly message: string;
  readonly sourceId?: string;
}

export interface KilnSkillSourceInventorySnapshot {
  readonly complete: boolean;
  readonly candidates: readonly KilnSkillSourceCandidateSnapshot[];
  readonly sources: readonly {
    readonly sourceKind: KilnSkillSourceKind;
    readonly candidateCount: number;
    readonly descriptionBytes: number;
  }[];
  readonly identities: readonly KilnSkillIdentitySnapshot[];
  readonly resolutions: readonly {
    readonly canonicalName: string;
    readonly status: "selected" | "unresolved";
    readonly selectedSourceId?: string;
    readonly candidates: readonly {
      readonly sourceId: string;
      readonly disposition: "selected" | "shadowed" | "diagnostic-only" | "related-copy" | "unresolved";
      readonly reason: string;
    }[];
  }[];
  readonly harnesses: readonly {
    readonly harness: "claude" | "codex" | "opencode";
    readonly candidateCount: number;
    readonly descriptionBytes: number;
    readonly budget: {
      readonly status: "known" | "unknown";
      readonly authority?: string;
      readonly contextRatio?: number;
      readonly fallbackCharacters?: number;
      readonly reason: string;
    };
  }[];
  readonly diagnostics: readonly KilnSkillInventoryDiagnosticSnapshot[];
  readonly externalExposure?: readonly {
    readonly harness: "claude" | "codex" | "opencode";
    readonly status: "not-configured" | "current" | "stale" | "blocked" | "unsupported";
    readonly realizedImplicit: number;
    readonly suppressed: number;
    readonly fingerprint?: string;
    readonly freshness: "current" | "stale" | "unknown";
    readonly reason: string;
  }[];
}

export interface KilnSkillCatalogSummarySnapshot {
  readonly complete: boolean;
  readonly healthyPackages: number;
  readonly warningPackages: number;
  readonly blockedPackages: number;
  readonly equivalentDuplicates: number;
  readonly divergentCollisions: number;
  readonly caseCollisions: number;
  readonly harnesses: KilnSkillSourceInventorySnapshot["harnesses"];
  readonly externalExposure: NonNullable<KilnSkillSourceInventorySnapshot["externalExposure"]>;
  readonly issueCount: number;
  readonly omittedIssueCount: number;
  readonly issues: readonly {
    readonly skillName: string;
    readonly kind: "missing" | "drifted" | "unmanaged" | "capability";
    readonly harness: "claude" | "codex" | "opencode";
    readonly projectionState: KilnSkillCatalogProjectionStatus;
    readonly path: string;
  }[];
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
}

export interface KilnConfigSetupSnapshot {
  readonly projectRoot: string;
  /** Included by interactive setup surfaces; derived by the status owner. */
  readonly effectiveConfig?: KilnEffectiveConfigSnapshot;
  readonly projectContext: KilnConfigSourceSnapshot & {
    readonly recommendation: KilnConfigSetupAction;
  };
  readonly repoShims: readonly KilnRepoShimProjectionSnapshot[];
  readonly globalInstructionShims: readonly KilnGlobalInstructionShimSetupSnapshot[];
  readonly nativeProjections: readonly KilnProjectionTargetSnapshot[];
  readonly permissionIntegrity: readonly TrustedExecutionIntegrity[];
  readonly skills?: KilnSkillCatalogSummarySnapshot;
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
  readonly evidenceVersion: typeof KILN_STATUS_EVIDENCE_VERSION;
  readonly generatedAt: string;
  readonly project: KilnConfigProjectSnapshot;
  readonly global: KilnConfigSourceSnapshot;
  readonly effectiveConfigStatus: KilnConfigSourceStatus;
  readonly effectiveConfig?: KilnEffectiveConfigSnapshot;
  readonly errors: readonly string[];
  readonly mcp: KilnMcpStatusSnapshot;
  readonly projections: readonly KilnProjectionTargetSnapshot[];
  readonly permissionIntegrity: readonly TrustedExecutionIntegrity[];
  readonly skills?: KilnSkillCatalogSummarySnapshot;
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

export const KilnEffectiveConfigOverrideStepSchema = z.object({
  scope: z.enum(["default", "global", "project"]),
  sourcePath: z.string().min(1),
  disposition: z.enum(["default", "selected", "contributed", "overridden"]),
}).strict();

export const KilnEffectiveConfigFieldSnapshotSchema = z.object({
  identity: z.string().regex(/^\/(?:[^/~]|~[01])+(?:\/(?:[^/~]|~[01])+)*$/),
  value: z.unknown().optional(),
  redacted: z.object({ present: z.literal(true) }).strict().optional(),
  scope: z.literal("effective"),
  source: z.enum(["default", "global", "project", "composed"]),
  sourcePath: z.string().min(1),
  defaultStatus: z.enum(["default", "explicit"]),
  overrideChain: z.array(KilnEffectiveConfigOverrideStepSchema).min(1),
  health: z.enum(["current", "stale", "drifted", "unknown"]),
  schemaRevision: z.number().int().positive(),
  activation: z.enum(["hot", "next-turn", "next-session", "reconcile", "restart-required"]),
  sensitivity: z.enum(["public", "secret-reference"]),
}).strict().superRefine((field, context) => {
  const hasValue = Object.prototype.hasOwnProperty.call(field, "value");
  if (field.sensitivity === "secret-reference" && (hasValue || !field.redacted)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["redacted"],
      message: "Secret-reference fields must expose redacted presence instead of a value",
    });
  }
  if (field.sensitivity === "public" && (!hasValue || field.redacted)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["value"],
      message: "Public fields must expose a value and cannot be marked redacted",
    });
  }
});

export const KilnEffectiveConfigSnapshotSchema = z.object({
  schemaRevision: z.literal(KILN_EFFECTIVE_CONFIG_SCHEMA_REVISION),
  health: z.enum(["current", "stale", "drifted", "unknown"]),
  fields: z.array(KilnEffectiveConfigFieldSnapshotSchema),
}).strict().superRefine((snapshot, context) => {
  const identities = new Set<string>();
  for (const [index, field] of snapshot.fields.entries()) {
    if (identities.has(field.identity)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "identity"], message: "Field identities must be unique" });
    }
    identities.add(field.identity);
    if (field.schemaRevision !== snapshot.schemaRevision) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "schemaRevision"], message: "Field schema revision must match the projection" });
    }
    if (field.health !== snapshot.health) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "health"], message: "Field health must match the projection" });
    }
  }
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
  effectiveVisibility: z.enum(["implicit", "explicit-only", "disabled"]).default("implicit"),
  visibilityCapability: z.enum(["exact", "unsupported"]).default("unsupported"),
  visibilityReason: z.string().default("Legacy snapshot does not carry governed visibility evidence."),
});

export const KilnSkillCatalogSnapshotEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  origin: z.enum(["builtin", "user", "project", "plugin", "native-harness"]),
  configured: z.boolean(),
  builtIn: z.boolean(),
  sourcePath: z.string(),
  desiredVisibility: z.enum(["implicit", "explicit-only", "disabled"]).default("implicit"),
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
  inventory: z.object({
    complete: z.boolean(),
    candidates: z.array(z.object({
      name: z.string(), canonicalName: z.string(),
      sourceKind: z.enum(["kiln-user", "kiln-project", "builtin", "shared-agents", "native-harness", "system", "plugin"]),
      sourceId: z.string(), sourcePath: z.string(),
      exposureScope: z.enum(["user", "project", "harness", "builtin"]),
      relationship: z.enum(["canonical", "external", "managed-projection", "linked-alias"]),
      relatedCanonicalName: z.string().optional(), relatedSourceId: z.string().optional(), packageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      descriptionBytes: z.number().int().nonnegative(),
      version: z.string().optional(), compatibility: z.string().optional(), license: z.string().optional(),
      trust: z.object({
        level: z.enum(["builtin", "local-configured", "external-unverified"]), reason: z.string().min(1),
      }),
      freshness: z.object({ status: z.enum(["current", "unknown"]), reason: z.string().min(1) }),
      dependencies: z.object({
        allowedTools: z.array(z.string()), executableResources: z.number().int().nonnegative(),
      }),
      health: z.object({
        status: z.enum(["healthy", "warning", "blocked"]), fileCount: z.number().int().nonnegative(),
        packageBytes: z.number().int().nonnegative(), brokenResourceCount: z.number().int().nonnegative(),
        riskSignals: z.array(z.object({ kind: z.enum(["code-execution", "network-access", "credential-pattern", "outside-filesystem-access"]), path: z.string() })),
        diagnostics: z.array(z.object({ code: z.string(), message: z.string(), path: z.string().optional() })),
      }),
      applicableHarnesses: z.array(z.enum(["claude", "codex", "opencode"])).default([]),
      effectiveVisibility: z.enum(["implicit", "explicit-only", "disabled"]).default("implicit"),
    })),
    sources: z.array(z.object({
      sourceKind: z.enum(["kiln-user", "kiln-project", "builtin", "shared-agents", "native-harness", "system", "plugin"]),
      candidateCount: z.number().int().nonnegative(), descriptionBytes: z.number().int().nonnegative(),
    })).default([]),
    identities: z.array(z.object({
      canonicalName: z.string(), names: z.array(z.string()), candidateSourceIds: z.array(z.string()),
      classification: z.enum(["unique", "equivalent-duplicate", "divergent-collision", "case-collision"]),
    })),
    resolutions: z.array(z.object({
      canonicalName: z.string(), status: z.enum(["selected", "unresolved"]), selectedSourceId: z.string().optional(),
      candidates: z.array(z.object({ sourceId: z.string(), disposition: z.enum(["selected", "shadowed", "diagnostic-only", "related-copy", "unresolved"]), reason: z.string() })),
    })).default([]),
    harnesses: z.array(z.object({
      harness: z.enum(["claude", "codex", "opencode"]), candidateCount: z.number().int().nonnegative(),
      descriptionBytes: z.number().int().nonnegative(), budget: z.object({ status: z.enum(["known", "unknown"]), authority: z.string().optional(), contextRatio: z.number().positive().optional(), fallbackCharacters: z.number().int().positive().optional(), reason: z.string() }),
    })).default([]),
    diagnostics: z.array(z.object({ code: z.string(), message: z.string(), sourceId: z.string().optional() })),
    externalExposure: z.array(z.object({
      harness: z.enum(["claude", "codex", "opencode"]),
      status: z.enum(["not-configured", "current", "stale", "blocked", "unsupported"]),
      realizedImplicit: z.number().int().nonnegative(), suppressed: z.number().int().nonnegative(),
      fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
      freshness: z.enum(["current", "stale", "unknown"]), reason: z.string(),
    })).optional(),
  }).optional(),
});

export const KilnSkillCatalogSummarySnapshotSchema = z.object({
  complete: z.boolean(), healthyPackages: z.number().int().nonnegative(), warningPackages: z.number().int().nonnegative(), blockedPackages: z.number().int().nonnegative(), equivalentDuplicates: z.number().int().nonnegative(),
  divergentCollisions: z.number().int().nonnegative(), caseCollisions: z.number().int().nonnegative(),
  harnesses: z.array(z.object({
    harness: z.enum(["claude", "codex", "opencode"]), candidateCount: z.number().int().nonnegative(),
    descriptionBytes: z.number().int().nonnegative(), budget: z.object({ status: z.enum(["known", "unknown"]), authority: z.string().optional(), contextRatio: z.number().positive().optional(), fallbackCharacters: z.number().int().positive().optional(), reason: z.string() }),
  })),
  externalExposure: z.array(z.object({
    harness: z.enum(["claude", "codex", "opencode"]),
    status: z.enum(["not-configured", "current", "stale", "blocked", "unsupported"]),
    realizedImplicit: z.number().int().nonnegative(), suppressed: z.number().int().nonnegative(),
    fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
    freshness: z.enum(["current", "stale", "unknown"]), reason: z.string(),
  })).default([]),
  issueCount: z.number().int().nonnegative(),
  omittedIssueCount: z.number().int().nonnegative(),
  issues: z.array(z.object({
    skillName: z.string(), kind: z.enum(["missing", "drifted", "unmanaged", "capability"]),
    harness: z.enum(["claude", "codex", "opencode"]),
    projectionState: z.enum(["missing", "projected", "drifted", "unmanaged-native"]), path: z.string(),
  })).max(12).default([]),
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
  effectiveConfig: KilnEffectiveConfigSnapshotSchema.optional(),
  projectContext: KilnConfigSourceSnapshotSchema.extend({
    recommendation: z.enum(KILN_CONFIG_SETUP_ACTIONS),
  }),
  repoShims: z.array(KilnRepoShimProjectionSnapshotSchema),
  globalInstructionShims: z.array(KilnGlobalInstructionShimSetupSnapshotSchema),
  nativeProjections: z.array(KilnProjectionTargetSnapshotSchema),
  permissionIntegrity: z.array(TrustedExecutionIntegritySchema),
  skills: KilnSkillCatalogSummarySnapshotSchema.optional(),
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
  evidenceVersion: z.number().int().positive(),
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
  effectiveConfig: KilnEffectiveConfigSnapshotSchema.optional(),
  errors: z.array(z.string()),
  mcp: KilnMcpStatusSnapshotSchema,
  projections: z.array(KilnProjectionTargetSnapshotSchema),
  permissionIntegrity: z.array(TrustedExecutionIntegritySchema),
  skills: KilnSkillCatalogSummarySnapshotSchema.optional(),
  setup: KilnConfigSetupSnapshotSchema,
  harnessCapabilities: z.array(z.object({
    harness: z.enum(["claude", "codex", "opencode"]),
    displayName: z.enum(["Claude Code", "Codex", "OpenCode"]),
    runtimeConfigInjection: z.enum(["supported", "not-proven", "CODEX_HOME + CLI config overrides", "OPENCODE_CONFIG_CONTENT"]),
    nativeProjection: z.enum(["install-state", "unsupported"]),
    nativeConfigImport: z.enum(["supported", "unsupported"]),
    mcpRuntimeTools: z.enum(["supported", "unsupported"]),
    hooks: z.enum(["supported", "unsupported"]),
  })),
});
