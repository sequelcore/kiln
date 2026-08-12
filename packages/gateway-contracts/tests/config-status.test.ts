import { describe, expect, it } from "vitest";
import {
  KILN_STATUS_EVIDENCE_VERSION,
  TRUSTED_EXECUTION_CLASSIFICATIONS,
  TRUSTED_EXECUTION_EVIDENCE_FRESHNESS,
  TRUSTED_EXECUTION_PROOF_STATUSES,
  KilnConfigSetupSnapshotSchema,
  KilnConfigStatusSnapshotSchema,
  KilnProjectionTargetSnapshotSchema,
  KilnSkillCatalogSnapshotSchema,
  TrustedExecutionIntegritySchema,
  type TrustedExecutionIntegrity,
} from "../src/config-status.js";

describe("KilnSkillCatalogSnapshotSchema", () => {
  it("publishes the summary-based status contract as evidence version 2", () => {
    expect(KILN_STATUS_EVIDENCE_VERSION).toBe(2);
  });
  it("publishes exact source inventory and unknown budget evidence", () => {
    const parsed = KilnSkillCatalogSnapshotSchema.parse({
      entries: [],
      inventory: {
        complete: true,
        candidates: [{
          name: "Planner", canonicalName: "planner", sourceKind: "shared-agents",
          sourceId: "shared-agents:planner", sourcePath: "skills/planner/SKILL.md",
          relationship: "external", packageDigest: `sha256:${"a".repeat(64)}`,
          descriptionBytes: 9,
        }],
        sources: [{ sourceKind: "shared-agents", candidateCount: 1, descriptionBytes: 9 }],
        identities: [{ canonicalName: "planner", names: ["Planner"], candidateSourceIds: ["shared-agents:planner"], classification: "unique" }],
        diagnostics: [],
      },
    });
    expect(parsed.inventory?.sources).toEqual([{ sourceKind: "shared-agents", candidateCount: 1, descriptionBytes: 9 }]);
  });

  it("round-trips desired and effective per-harness visibility evidence", () => {
    const parsed = KilnSkillCatalogSnapshotSchema.parse({
      entries: [{
        name: "planner",
        description: "Plan work.",
        origin: "user",
        configured: true,
        builtIn: false,
        sourcePath: "C:/test/.kiln/skills/planner/SKILL.md",
        desiredVisibility: "explicit-only",
        projections: [{
          target: "opencode",
          displayName: "OpenCode",
          path: "C:/test/.config/opencode/skills/planner/SKILL.md",
          status: "missing",
          effectiveVisibility: "disabled",
          visibilityCapability: "unsupported",
          visibilityReason: "Projection fails closed.",
        }],
        admission: { state: "available", reason: "Configured." },
      }],
    });

    expect(parsed.entries[0]).toMatchObject({
      desiredVisibility: "explicit-only",
      projections: [{ effectiveVisibility: "disabled", visibilityCapability: "unsupported" }],
    });
  });
});

function trustedIntegrity(overrides: Partial<TrustedExecutionIntegrity> = {}): TrustedExecutionIntegrity {
  return {
    harness: "codex",
    desired: {
      profile: "trusted-full-access",
      source: "operator-local-config",
      observedAt: "2026-07-01T15:00:00.000Z",
      verifiedAt: "2026-07-01T15:00:01.000Z",
      freshness: "current",
      proof: "proven",
    },
    persistedNative: {
      profile: "restricted",
      source: "native-config",
      observedAt: "2026-07-01T15:01:00.000Z",
      verifiedAt: "2026-07-01T15:01:01.000Z",
      freshness: "current",
      proof: "proven",
      projectionOwnership: "kiln-managed",
    },
    sessionOverride: {
      profile: "trusted-full-access",
      source: "desktop-ui-selection",
      observedAt: "2026-07-01T15:02:00.000Z",
      freshness: "current",
      proof: "inferred",
    },
    effectiveRuntime: {
      profile: "workspace-write",
      source: "runtime-observation",
      observedAt: "2026-07-01T15:03:00.000Z",
      verifiedAt: "2026-07-01T15:03:01.000Z",
      freshness: "current",
      proof: "proven",
    },
    enforcement: {
      approvalControl: "enforced",
      filesystemSandbox: "enforced",
      networkBoundary: "enforced",
      strength: "strong",
    },
    authorization: {
      status: "authorized",
      scope: "operator-local",
      authorizedBy: "operator",
      authorizedAt: "2026-07-01T14:59:00.000Z",
      revocable: true,
    },
    semanticLoss: [],
    classification: "runtime-policy-mismatch",
    recommendation: "Reconcile Codex runtime authority with the operator-selected trusted profile before unattended execution.",
    remediationRequiresApproval: true,
    lastVerifiedAt: "2026-07-01T15:03:01.000Z",
    ...overrides,
  };
}

describe("KilnProjectionTargetSnapshotSchema", () => {
  it("preserves structured native projection metadata for operator surfaces", () => {
    expect(KilnProjectionTargetSnapshotSchema.parse({
      targetId: "codex-agent:planner",
      path: "C:/Users/test/.codex/agents/planner.toml",
      kind: "native",
      status: "managed",
      managedFieldCount: 1,
      updatedAt: "2026-06-27T12:29:50.875Z",
    })).toMatchObject({
      managedFieldCount: 1,
      updatedAt: "2026-06-27T12:29:50.875Z",
    });
  });

  it("preserves native route-integrity metadata for setup and doctor surfaces", () => {
    expect(KilnProjectionTargetSnapshotSchema.parse({
      targetId: "opencode-config",
      path: "C:/Users/test/.config/opencode/opencode.json",
      kind: "native",
      status: "drifted",
      managedFieldCount: 2,
      routeIntegrity: {
        canonicalRoute: { providerId: "opencode-go", model: "deepseek-v4-flash" },
        nativeConfiguredDefault: { providerId: "opencode-go", model: "deepseek-v4-flash-free" },
        selectedRuntimeRoute: { providerId: "opencode-go", model: "deepseek-v4-flash-free" },
        catalogStatus: { status: "unknown-model", providerId: "opencode-go", model: "deepseek-v4-flash-free" },
        explicitProbeStatus: "succeeded",
        credentialSource: "kiln-auth-store",
        bareProofSupported: true,
        routeStatus: "drifted",
        credentialStatus: "unknown",
        classification: "projection-drift",
      },
    })).toMatchObject({
      routeIntegrity: {
        canonicalRoute: { providerId: "opencode-go", model: "deepseek-v4-flash" },
        nativeConfiguredDefault: { providerId: "opencode-go", model: "deepseek-v4-flash-free" },
        explicitProbeStatus: "succeeded",
        credentialSource: "kiln-auth-store",
        routeStatus: "drifted",
        credentialStatus: "unknown",
        classification: "projection-drift",
      },
    });
  });

  it("preserves native permission-integrity evidence for setup and doctor surfaces", () => {
    const parsed = KilnProjectionTargetSnapshotSchema.parse({
      targetId: "codex-config",
      path: "C:/Users/test/.codex/config.toml",
      kind: "native",
      status: "managed",
      managedFieldCount: 3,
      updatedAt: "2026-07-01T15:02:01.000Z",
      permissionIntegrity: {
        harness: "codex",
        desired: {
          profile: "trusted-full-access",
          source: "operator-local-config",
          observedAt: "2026-07-01T15:00:00.000Z",
          verifiedAt: "2026-07-01T15:00:01.000Z",
          freshness: "current",
          proof: "proven",
        },
        persistedNative: {
          profile: "trusted-full-access",
          source: "native-config",
          observedAt: "2026-07-01T15:01:00.000Z",
          verifiedAt: "2026-07-01T15:01:01.000Z",
          freshness: "current",
          proof: "proven",
          projectionOwnership: "kiln-managed",
        },
        enforcement: {
          approvalControl: "enforced",
          filesystemSandbox: "enforced",
          networkBoundary: "enforced",
          strength: "strong",
        },
        authorization: { status: "unavailable", revocable: true },
        semanticLoss: [],
        classification: "effective-policy-unproven",
        recommendation: "Verify effective runtime authority.",
        remediationRequiresApproval: true,
        lastVerifiedAt: "2026-07-01T15:01:01.000Z",
      },
    });

    expect(parsed.permissionIntegrity).toMatchObject({
      harness: "codex",
      classification: "effective-policy-unproven",
    });
  });

  it("rejects invalid structured projection metadata", () => {
    expect(() => KilnProjectionTargetSnapshotSchema.parse({
      targetId: "codex-agent:planner",
      path: "C:/Users/test/.codex/agents/planner.toml",
      kind: "native",
      status: "managed",
      managedFieldCount: -1,
      updatedAt: "not-a-date",
    })).toThrow();
  });
});

describe("KilnConfig setup and status permission integrity", () => {
  it("exposes provider-neutral permission integrity at setup level without mining native projections", () => {
    const integrity = trustedIntegrity();
    const parsed = KilnConfigSetupSnapshotSchema.parse({
      projectRoot: "C:/repo/kiln",
      projectContext: {
        path: "C:/repo/kiln/.kiln/project-context.md",
        status: "valid",
        recommendation: "none",
      },
      repoShims: [],
      globalInstructionShims: [{
        targetId: "codex-global-instructions",
        harness: "codex",
        path: "C:/Users/test/.codex/AGENTS.md",
        kind: "global-instruction-shim",
        status: "missing",
        recommendation: "sync-global-instruction-shims",
      }],
      nativeProjections: [{
        targetId: "codex-config",
        path: "C:/Users/test/.codex/config.toml",
        kind: "native",
        status: "managed",
        permissionIntegrity: integrity,
      }],
      permissionIntegrity: [integrity],
      recommendedActions: [],
    });

    expect(parsed.permissionIntegrity).toEqual([integrity]);
    expect(parsed.globalInstructionShims[0]).toMatchObject({ harness: "codex" });
  });

  it("requires the canonical harness identity on every global instruction shim", () => {
    const shim = {
      targetId: "claude-global-instructions",
      path: "C:/Users/test/.claude/CLAUDE.md",
      kind: "global-instruction-shim",
      status: "stale",
      recommendation: "sync-global-instruction-shims",
    };

    expect(() => KilnConfigSetupSnapshotSchema.parse({
      projectRoot: "C:/repo/kiln",
      projectContext: { path: "C:/repo/kiln/.kiln/project-context.md", status: "valid", recommendation: "none" },
      repoShims: [],
      globalInstructionShims: [shim],
      nativeProjections: [],
      permissionIntegrity: [],
      recommendedActions: ["sync-global-instruction-shims"],
    })).toThrow();
  });

  it("exposes the same permission integrity aggregate at status level for every operator surface", () => {
    const integrity = trustedIntegrity();
    const setup = {
      projectRoot: "C:/repo/kiln",
      projectContext: {
        path: "C:/repo/kiln/.kiln/project-context.md",
        status: "valid",
        recommendation: "none",
      },
      repoShims: [],
      globalInstructionShims: [],
      nativeProjections: [],
      permissionIntegrity: [integrity],
      recommendedActions: [],
    };

    const parsed = KilnConfigStatusSnapshotSchema.parse({
      generatedAt: "2026-07-01T15:05:00.000Z",
      project: {
        rootPath: "C:/repo/kiln",
        projectName: "kiln",
        hasGitRoot: true,
        hasKilnYaml: true,
        kilnYaml: { path: "C:/repo/kiln/.kiln/kiln.yaml", status: "valid" },
        projectContext: { path: "C:/repo/kiln/.kiln/project-context.md", status: "valid" },
      },
      global: { path: "C:/Users/test/.kiln/config.yaml", status: "valid" },
      effectiveConfigStatus: "valid",
      errors: [],
      mcp: {
        servers: [{
          id: "studio",
          enabled: true,
          source: "project",
          transport: "stdio",
          admission: "admitted",
          trust: "untrusted",
          provenance: {
            command: { scope: "project", sourcePath: "C:/repo/kiln/.kiln/kiln.yaml", field: "command" },
          },
          runtimeCompatibility: { status: "compatible" },
          projectionCompatibility: [
            { harness: "codex", status: "compatible" },
            { harness: "claude", status: "compatible" },
            { harness: "opencode", status: "compatible" },
          ],
          health: { state: "not-tested" },
          discovery: { state: "not-tested", tools: 0, resources: 0, prompts: 0, admitted: 0, capabilities: [] },
          projection: { state: "not-synchronized" },
        }],
        diagnostics: [],
      },
      projections: [],
      permissionIntegrity: [integrity],
      setup,
      harnessCapabilities: [],
    });

    expect(parsed.permissionIntegrity).toEqual(parsed.setup.permissionIntegrity);
    expect(parsed.mcp.servers[0]).toMatchObject({ id: "studio", transport: "stdio" });
  });
});

describe("TrustedExecutionIntegritySchema", () => {
  it("publishes the canonical security vocabulary consumed by Core", () => {
    expect(TRUSTED_EXECUTION_CLASSIFICATIONS).toEqual([
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
    ]);
    expect(TRUSTED_EXECUTION_EVIDENCE_FRESHNESS).toEqual(["current", "stale", "unknown"]);
    expect(TRUSTED_EXECUTION_PROOF_STATUSES).toEqual(["proven", "inferred", "unavailable", "contradictory"]);
  });

  it("round-trips distinct desired, persisted, selected, and effective evidence", () => {
    const integrity = {
      harness: "codex",
      desired: {
        profile: "trusted-full-access",
        source: "operator-local-config",
        observedAt: "2026-07-01T15:00:00.000Z",
        freshness: "current",
        proof: "proven",
        verifiedAt: "2026-07-01T15:00:01.000Z",
      },
      persistedNative: {
        profile: "restricted",
        source: "native-config",
        observedAt: "2026-07-01T15:01:00.000Z",
        freshness: "current",
        proof: "proven",
        verifiedAt: "2026-07-01T15:01:01.000Z",
        projectionOwnership: "kiln-managed",
      },
      sessionOverride: {
        profile: "trusted-full-access",
        source: "desktop-ui-selection",
        observedAt: "2026-07-01T15:02:00.000Z",
        freshness: "current",
        proof: "inferred",
      },
      effectiveRuntime: {
        profile: "workspace-write",
        source: "runtime-observation",
        observedAt: "2026-07-01T15:03:00.000Z",
        verifiedAt: "2026-07-01T15:03:01.000Z",
        freshness: "current",
        proof: "proven",
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "enforced",
        networkBoundary: "enforced",
        strength: "strong",
      },
      authorization: {
        status: "authorized",
        scope: "operator-local",
        authorizedBy: "operator",
        authorizedAt: "2026-07-01T14:59:00.000Z",
        revocable: true,
      },
      semanticLoss: [],
      classification: "runtime-policy-mismatch",
      recommendation: "Start a new Codex session with Full Access and verify its effective runtime policy.",
      remediationRequiresApproval: true,
      lastVerifiedAt: "2026-07-01T15:03:01.000Z",
    };

    expect(TrustedExecutionIntegritySchema.parse(integrity)).toEqual(integrity);
  });

  it("rejects a UI selection presented as proven runtime authority", () => {
    expect(() => TrustedExecutionIntegritySchema.parse({
      harness: "codex",
      desired: {
        profile: "trusted-full-access",
        source: "operator-local-config",
        observedAt: "2026-07-01T15:00:00.000Z",
        freshness: "current",
        proof: "proven",
      },
      sessionOverride: {
        profile: "trusted-full-access",
        source: "desktop-ui-selection",
        observedAt: "2026-07-01T15:02:00.000Z",
        freshness: "current",
        proof: "proven",
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "enforced",
        networkBoundary: "enforced",
        strength: "strong",
      },
      authorization: { status: "unavailable", revocable: true },
      semanticLoss: [],
      classification: "current-verified",
      recommendation: "none",
      remediationRequiresApproval: false,
    })).toThrow();
  });

  it("rejects OpenCode permission resolution represented as sandbox enforcement", () => {
    expect(() => TrustedExecutionIntegritySchema.parse({
      harness: "opencode",
      desired: {
        profile: "trusted-full-access",
        source: "operator-local-config",
        observedAt: "2026-07-01T15:00:00.000Z",
        freshness: "current",
        proof: "proven",
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "enforced",
        networkBoundary: "not-enforced",
        strength: "strong",
      },
      authorization: { status: "authorized", scope: "operator-local", revocable: true },
      semanticLoss: [],
      classification: "current-verified",
      recommendation: "none",
      remediationRequiresApproval: false,
    })).toThrow();
  });

  it.each(["desired", "persistedNative", "sessionOverride", "effectiveRuntime"] as const)(
    "rejects UI-selected evidence presented as proven in %s",
    (slot) => {
      const evidence = {
        profile: "trusted-full-access",
        source: "desktop-ui-selection",
        observedAt: "2026-07-01T15:00:00.000Z",
        verifiedAt: "2026-07-01T15:00:01.000Z",
        freshness: "current",
        proof: "proven",
      };

      expect(() => TrustedExecutionIntegritySchema.parse({
        harness: "codex",
        desired: slot === "desired"
          ? evidence
          : { ...evidence, source: "operator-local-config" },
        [slot]: evidence,
        enforcement: {
          approvalControl: "enforced",
          filesystemSandbox: "enforced",
          networkBoundary: "enforced",
          strength: "strong",
        },
        authorization: {
          status: "authorized",
          scope: "operator-local",
          authorizedBy: "operator:test",
          authorizedAt: "2026-07-01T14:59:00.000Z",
          revocable: true,
        },
        semanticLoss: [],
        classification: "effective-policy-unproven",
        recommendation: "Verify effective runtime authority.",
        remediationRequiresApproval: false,
      })).toThrow();
    },
  );

  it("requires verifiedAt whenever evidence claims proven authority", () => {
    expect(() => TrustedExecutionIntegritySchema.parse({
      harness: "claude-code",
      desired: {
        profile: "trusted-full-access",
        source: "operator-local-config",
        observedAt: "2026-07-01T15:00:00.000Z",
        freshness: "current",
        proof: "proven",
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "not-enforced",
        networkBoundary: "not-enforced",
        strength: "rules-only",
      },
      authorization: {
        status: "authorized",
        scope: "operator-local",
        authorizedBy: "operator:test",
        authorizedAt: "2026-07-01T14:59:00.000Z",
        revocable: true,
      },
      semanticLoss: [],
      classification: "effective-policy-unproven",
      recommendation: "Verify effective runtime authority.",
      remediationRequiresApproval: false,
    })).toThrow();
  });

  it.each(["desired", "persistedNative", "sessionOverride", "effectiveRuntime"] as const)(
    "requires %s to carry its own verifiedAt when proof is proven",
    (slot) => {
      const evidence = {
        profile: "workspace-write",
        source: slot === "effectiveRuntime" ? "runtime-observation" : "native-config",
        observedAt: "2026-07-01T15:00:00.000Z",
        freshness: "current",
        proof: "proven",
        ...(slot === "persistedNative" ? { projectionOwnership: "kiln-managed" } : {}),
      };
      const desired = {
        profile: "workspace-write",
        source: "operator-local-config",
        observedAt: "2026-07-01T14:59:00.000Z",
        verifiedAt: "2026-07-01T14:59:01.000Z",
        freshness: "current",
        proof: "proven",
      };

      expect(() => TrustedExecutionIntegritySchema.parse({
        harness: "codex",
        desired: slot === "desired" ? { ...evidence, source: "operator-local-config" } : desired,
        [slot]: evidence,
        enforcement: {
          approvalControl: "enforced",
          filesystemSandbox: "enforced",
          networkBoundary: "enforced",
          strength: "strong",
        },
        authorization: { status: "unavailable", revocable: true },
        semanticLoss: [],
        classification: "effective-policy-unproven",
        recommendation: "Verify evidence.",
        remediationRequiresApproval: false,
        lastVerifiedAt: "2026-07-01T15:30:00.000Z",
      })).toThrow();
    },
  );

  it("rejects current-verified when persisted native authority is broader without fresh operator authorization", () => {
    expect(() => TrustedExecutionIntegritySchema.parse({
      harness: "codex",
      desired: {
        profile: "workspace-write",
        source: "operator-local-config",
        observedAt: "2026-07-01T15:00:00.000Z",
        verifiedAt: "2026-07-01T15:00:01.000Z",
        freshness: "current",
        proof: "proven",
      },
      persistedNative: {
        profile: "trusted-full-access",
        source: "native-config",
        observedAt: "2026-07-01T15:01:00.000Z",
        verifiedAt: "2026-07-01T15:01:01.000Z",
        freshness: "current",
        proof: "proven",
        projectionOwnership: "operator-owned",
      },
      effectiveRuntime: {
        profile: "workspace-write",
        source: "runtime-observation",
        observedAt: "2026-07-01T15:02:00.000Z",
        verifiedAt: "2026-07-01T15:02:01.000Z",
        freshness: "current",
        proof: "proven",
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "enforced",
        networkBoundary: "enforced",
        strength: "strong",
      },
      authorization: { status: "unavailable", revocable: true },
      semanticLoss: [],
      classification: "current-verified",
      recommendation: "none",
      remediationRequiresApproval: false,
      lastVerifiedAt: "2026-07-01T15:02:01.000Z",
    })).toThrow();
  });

  it("rejects current-verified when any present evidence is stale or unknown", () => {
    expect(() => TrustedExecutionIntegritySchema.parse({
      harness: "codex",
      desired: {
        profile: "workspace-write",
        source: "operator-local-config",
        observedAt: "2026-07-01T15:00:00.000Z",
        verifiedAt: "2026-07-01T15:00:01.000Z",
        freshness: "current",
        proof: "proven",
      },
      persistedNative: {
        profile: "workspace-write",
        source: "native-config",
        observedAt: "2026-07-01T15:01:00.000Z",
        verifiedAt: "2026-07-01T15:01:01.000Z",
        freshness: "stale",
        proof: "proven",
        projectionOwnership: "kiln-managed",
      },
      effectiveRuntime: {
        profile: "workspace-write",
        source: "runtime-observation",
        observedAt: "2026-07-01T15:02:00.000Z",
        verifiedAt: "2026-07-01T15:02:01.000Z",
        freshness: "current",
        proof: "proven",
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "enforced",
        networkBoundary: "enforced",
        strength: "strong",
      },
      authorization: { status: "unavailable", revocable: true },
      semanticLoss: [],
      classification: "current-verified",
      recommendation: "none",
      remediationRequiresApproval: false,
    })).toThrow();
  });

  it("rejects current-verified when persisted native policy differs from desired policy", () => {
    expect(() => TrustedExecutionIntegritySchema.parse({
      harness: "codex",
      desired: {
        profile: "trusted-full-access",
        source: "operator-local-config",
        observedAt: "2026-07-01T15:00:00.000Z",
        verifiedAt: "2026-07-01T15:00:01.000Z",
        freshness: "current",
        proof: "proven",
      },
      persistedNative: {
        profile: "workspace-write",
        source: "native-config",
        observedAt: "2026-07-01T15:01:00.000Z",
        verifiedAt: "2026-07-01T15:01:01.000Z",
        freshness: "current",
        proof: "proven",
        projectionOwnership: "kiln-managed",
      },
      effectiveRuntime: {
        profile: "trusted-full-access",
        source: "runtime-observation",
        observedAt: "2026-07-01T15:02:00.000Z",
        verifiedAt: "2026-07-01T15:02:01.000Z",
        freshness: "current",
        proof: "proven",
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "enforced",
        networkBoundary: "enforced",
        strength: "strong",
      },
      authorization: {
        status: "authorized",
        scope: "operator-local",
        authorizedBy: "operator:test",
        authorizedAt: "2026-07-01T14:59:00.000Z",
        revocable: true,
      },
      semanticLoss: [],
      classification: "current-verified",
      recommendation: "none",
      remediationRequiresApproval: false,
    })).toThrow();
  });

  it.each([
    { scope: "repository", authorizedBy: "operator:test", authorizedAt: "2026-07-01T14:59:00.000Z", revocable: true },
    { scope: "operator-local", authorizedAt: "2026-07-01T14:59:00.000Z", revocable: true },
    { scope: "operator-local", authorizedBy: "operator:test", revocable: true },
    { scope: "operator-local", authorizedBy: "operator:test", authorizedAt: "2026-07-01T14:59:00.000Z", revocable: false },
  ])("rejects incomplete or non-local trusted authorization %#", (authorization) => {
    expect(() => TrustedExecutionIntegritySchema.parse({
      harness: "codex",
      desired: {
        profile: "trusted-full-access",
        source: "operator-local-config",
        observedAt: "2026-07-01T15:00:00.000Z",
        freshness: "current",
        proof: "inferred",
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "enforced",
        networkBoundary: "enforced",
        strength: "strong",
      },
      authorization: { status: "authorized", ...authorization },
      semanticLoss: [],
      classification: "effective-policy-unproven",
      recommendation: "Verify effective runtime authority.",
      remediationRequiresApproval: false,
    })).toThrow();
  });
});
