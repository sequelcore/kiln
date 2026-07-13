import type { KilnConfigStatusSnapshot } from "@kilnai/gateway-contracts";
import type { ReadConfigStatusOptions } from "./config-status.js";

export interface NativeHarnessInspectionPort {
  readStatus?(options?: ReadConfigStatusOptions): Promise<KilnConfigStatusSnapshot>;
  readBridgeProjection?(): Promise<"current" | "missing" | "invalid">;
}

export type NativeHarnessInspectionErrorCode =
  | "KILN_RUNTIME_OWNER_MISSING"
  | "KILN_STATUS_EVIDENCE_INCOMPLETE"
  | "KILN_CAPABILITY_UNAVAILABLE";

export interface NativeHarnessInspectionEvidence {
  readonly harness: {
    readonly kind: "native-harness";
    readonly harness: "codex";
    readonly channel: "app";
    readonly adapterId: "kiln-codex-app-mcp";
  };
  readonly authoritySource: "kiln-config-status";
  readonly capabilitySource: "kiln-harness-integration-capabilities";
  readonly directProviderAuthority: "kiln-runtime";
  readonly nativeHarnessPermissionAuthority: "native-harness-only";
  readonly observedAt: string;
}

export interface NativeHarnessInspectionFailure {
  readonly error: {
    readonly code: NativeHarnessInspectionErrorCode;
    readonly message: string;
    readonly operatorAction: string;
  };
}

export interface NativeHarnessInspectionService {
  inspectStatus(): Promise<NativeHarnessStatusResult | NativeHarnessInspectionFailure>;
  inspectWorkGovernance(): Promise<NativeHarnessGovernanceResult | NativeHarnessInspectionFailure>;
  inspectCapability(): Promise<NativeHarnessCapabilityResult | NativeHarnessInspectionFailure>;
}

export interface NativeHarnessStatusResult {
  readonly operation: "status";
  readonly evidence: NativeHarnessInspectionEvidence;
  readonly status: {
    readonly projectName: string;
    readonly hasGitRoot: boolean;
    readonly hasKilnYaml: boolean;
    readonly globalConfigStatus: KilnConfigStatusSnapshot["global"]["status"];
    readonly projectConfigStatus: KilnConfigStatusSnapshot["project"]["kilnYaml"]["status"];
    readonly projectContextStatus: KilnConfigStatusSnapshot["project"]["projectContext"]["status"];
    readonly effectiveConfigStatus: KilnConfigStatusSnapshot["effectiveConfigStatus"];
    readonly recommendedActions: readonly string[];
    readonly projections: readonly {
      readonly targetId: string;
      readonly kind: string;
      readonly status: string;
    }[];
    readonly routes: readonly {
      readonly targetId: string;
      readonly routeStatus: string;
      readonly credentialStatus: string;
      readonly classification: string;
    }[];
  };
}

export interface NativeHarnessGovernanceResult {
  readonly operation: "work-governance";
  readonly evidence: NativeHarnessInspectionEvidence;
  readonly policy: {
    readonly defaultPosture: "direct" | "orchestrate";
    readonly directExecution: { readonly maxFiles?: number; readonly maxRisk?: "low" | "medium" | "high" };
    readonly requireDelegationFor: readonly string[];
    readonly requiredEvidence: readonly string[];
  };
}

export interface NativeHarnessCapabilityResult {
  readonly operation: "capability";
  readonly evidence: NativeHarnessInspectionEvidence;
  readonly capability: {
    readonly availability: "available";
    readonly capabilitySource: "kiln-harness-integration-capabilities";
    readonly mcpRuntimeTools: string;
    readonly nativeProjection: string;
    readonly nativeConfigImport: string;
    readonly hooks: string;
    readonly crossHarnessManagedInvocation: {
      readonly adapterId: string;
      readonly supportedProviderIds: readonly string[];
    };
    readonly bridgeProjection: "current";
  };
}

export function createNativeHarnessInspectionService(
  port: NativeHarnessInspectionPort = {},
): NativeHarnessInspectionService {
  const readStatus = port.readStatus;
  const readBridgeProjection = port.readBridgeProjection;

  async function read(): Promise<KilnConfigStatusSnapshot | NativeHarnessInspectionFailure> {
    if (!readStatus) {
      return failure(
        "KILN_RUNTIME_OWNER_MISSING",
        "Kiln's status inspection service is unavailable.",
        "Start the Kiln installation that owns this workspace, then retry the read-only inspection.",
      );
    }
    try {
      const snapshot = await readStatus({ projectPath: process.cwd() });
      if (snapshot.effectiveConfigStatus !== "valid" || snapshot.errors.length > 0 || snapshot.projections.some((projection) => projection.status === "stale" || projection.status === "drifted")) {
        return failure(
          "KILN_STATUS_EVIDENCE_INCOMPLETE",
          "Kiln status evidence is incomplete and cannot be trusted for a governed decision.",
          "Inspect Kiln setup and resolve configuration or projection diagnostics before retrying.",
        );
      }
      return snapshot;
    } catch {
      return failure(
        "KILN_STATUS_EVIDENCE_INCOMPLETE",
        "Kiln status could not be read safely.",
        "Verify the local Kiln configuration and setup state, then retry the read-only inspection.",
      );
    }
  }

  return {
    async inspectStatus() {
      const snapshot = await read();
      if (isFailure(snapshot)) return snapshot;
      return {
        operation: "status",
        evidence: evidence(snapshot),
        status: {
          projectName: snapshot.project.projectName,
          hasGitRoot: snapshot.project.hasGitRoot,
          hasKilnYaml: snapshot.project.hasKilnYaml,
          globalConfigStatus: snapshot.global.status,
          projectConfigStatus: snapshot.project.kilnYaml.status,
          projectContextStatus: snapshot.project.projectContext.status,
          effectiveConfigStatus: snapshot.effectiveConfigStatus,
          recommendedActions: snapshot.setup.recommendedActions,
          projections: snapshot.projections.map((projection) => ({
            targetId: projection.targetId,
            kind: projection.kind,
            status: projection.status,
          })),
          routes: snapshot.projections.flatMap((projection) => projection.routeIntegrity ? [{
            targetId: projection.targetId,
            routeStatus: projection.routeIntegrity.routeStatus,
            credentialStatus: projection.routeIntegrity.credentialStatus,
            classification: projection.routeIntegrity.classification,
          }] : []),
        },
      };
    },
    async inspectWorkGovernance() {
      const snapshot = await read();
      if (isFailure(snapshot)) return snapshot;
      const config = snapshot.effectiveConfig as { workGovernance?: NativeHarnessGovernanceResult["policy"] } | undefined;
      const policy = config?.workGovernance;
      if (!policy) {
        return failure(
          "KILN_CAPABILITY_UNAVAILABLE",
          "Resolved work-governance policy is unavailable.",
          "Configure workGovernance in Kiln before requesting governance inspection.",
        );
      }
      return { operation: "work-governance", evidence: evidence(snapshot), policy };
    },
    async inspectCapability() {
      const snapshot = await read();
      if (isFailure(snapshot)) return snapshot;
      const capability = snapshot.harnessCapabilities.find((entry) => entry.harness === "codex");
      if (!capability || capability.mcpRuntimeTools !== "supported") {
        return failure(
          "KILN_CAPABILITY_UNAVAILABLE",
          "Codex MCP runtime-tool capability is unavailable.",
          "Review Kiln harness capability diagnostics before attempting this integration.",
        );
      }
      const bridgeProjection = await readBridgeProjection?.();
      if (bridgeProjection !== "current") {
        return failure(
          "KILN_CAPABILITY_UNAVAILABLE",
          "The Codex App MCP bridge projection is unavailable or stale.",
          "Restore the project-local .codex MCP declaration in this trusted workspace, then retry.",
        );
      }
      return {
        operation: "capability",
        evidence: evidence(snapshot),
        capability: {
          availability: "available",
          capabilitySource: "kiln-harness-integration-capabilities",
          mcpRuntimeTools: capability.mcpRuntimeTools,
          nativeProjection: capability.nativeProjection,
          nativeConfigImport: capability.nativeConfigImport,
          hooks: capability.hooks,
          crossHarnessManagedInvocation: capability.crossHarnessManagedInvocation,
          bridgeProjection,
        },
      };
    },
  };
}

function evidence(snapshot: KilnConfigStatusSnapshot): NativeHarnessInspectionEvidence {
  return {
    harness: { kind: "native-harness", harness: "codex", channel: "app", adapterId: "kiln-codex-app-mcp" },
    authoritySource: "kiln-config-status",
    capabilitySource: "kiln-harness-integration-capabilities",
    directProviderAuthority: "kiln-runtime",
    nativeHarnessPermissionAuthority: "native-harness-only",
    observedAt: snapshot.generatedAt,
  };
}

function failure(
  code: NativeHarnessInspectionErrorCode,
  message: string,
  operatorAction: string,
): NativeHarnessInspectionFailure {
  return { error: { code, message, operatorAction } };
}

function isFailure(
  value: KilnConfigStatusSnapshot | NativeHarnessInspectionFailure,
): value is NativeHarnessInspectionFailure {
  return "error" in value;
}
