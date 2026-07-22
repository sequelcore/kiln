import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { stripJsonComments } from "../config/json-comments.js";
import type { HarnessIntegrationId } from "../config/harness-integration-capabilities.js";
import {
  KILN_STATUS_EVIDENCE_VERSION,
  KilnConfigStatusSnapshotSchema,
  KilnResolvedWorkGovernancePolicySchema,
  type KilnConfigStatusSnapshot,
  type KilnResolvedWorkGovernancePolicy,
} from "@kilnai/gateway-contracts";
import { readConfigStatusSnapshot, type ReadConfigStatusOptions } from "./config-status.js";
import {
  discoverNativeHarnessProjectRoot,
  type NativeHarnessProjectRootResolution,
} from "./native-harness-project-root.js";

const MAX_EVIDENCE_AGE_MS = 5 * 60 * 1_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 60 * 1_000;

type BridgeProjectionState = "current" | "missing" | "invalid";
type ObservableConfigStatus = KilnConfigStatusSnapshot["global"]["status"] | "unresolved";

export interface NativeHarnessInspectionPort {
  readonly harness: HarnessIntegrationId;
  /** null is reserved for tests and represents an unavailable canonical owner. */
  readStatus?: ((options?: ReadConfigStatusOptions) => Promise<KilnConfigStatusSnapshot>) | null;
  readBridgeProjection?: (projectRoot: string) => Promise<BridgeProjectionState>;
  readProjectRoot?: () => Promise<NativeHarnessProjectRootResolution>;
  now?: () => Date;
  managedAgents?: readonly NativeHarnessManagedAgentSummary[];
}

export interface NativeHarnessManagedAgentSummary {
  readonly configuredAgentProfileId: string;
  readonly displayName?: string;
  readonly role?: string;
  readonly availability: "admitted" | "unavailable" | "unresolved";
  readonly providerFamily?: string;
  readonly admissionProfileId: string;
  readonly diagnostic?: "route_unavailable" | "eligibility_unresolved";
  readonly operatorAction?: string;
}

export interface NativeHarnessDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly operatorAction: string;
  readonly targetId?: string;
}

export interface NativeHarnessInspectionEvidence {
  readonly harness: {
    readonly kind: "native-harness";
    readonly harness: HarnessIntegrationId;
    readonly channel: "control-plane";
    readonly adapterId: "kiln-control-plane-mcp";
  };
  readonly authoritySource: "kiln-config-status";
  readonly capabilitySource: "kiln-harness-integration-capabilities";
  readonly directProviderAuthority: "kiln-runtime";
  readonly nativeHarnessPermissionAuthority: "native-harness-only";
  readonly observedAt: string;
}

export interface NativeHarnessStatusResult {
  readonly operation: "status";
  readonly evidence: NativeHarnessInspectionEvidence;
  readonly status: {
    readonly completeness: "complete" | "degraded" | "unresolved";
    readonly projectName: string;
    readonly hasGitRoot: boolean;
    readonly hasKilnYaml: boolean;
    readonly globalConfigStatus: ObservableConfigStatus;
    readonly projectConfigStatus: ObservableConfigStatus;
    readonly projectContextStatus: ObservableConfigStatus;
    readonly effectiveConfigStatus: ObservableConfigStatus;
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
  readonly diagnostics: readonly NativeHarnessDiagnostic[];
}

export interface NativeHarnessGovernanceResult {
  readonly operation: "work-governance";
  readonly evidence: NativeHarnessInspectionEvidence;
  readonly authority: "authoritative" | "unresolved";
  readonly policy?: KilnResolvedWorkGovernancePolicy;
  readonly diagnostics: readonly NativeHarnessDiagnostic[];
}

export interface NativeHarnessCapabilityResult {
  readonly operation: "capability";
  readonly evidence: NativeHarnessInspectionEvidence;
  readonly capability: {
    readonly availability: "available" | "unresolved";
    readonly capabilitySource: "kiln-harness-integration-capabilities";
    readonly mcpRuntimeTools: string;
    readonly nativeProjection: string;
    readonly nativeConfigImport: string;
    readonly hooks: string;
    readonly crossHarnessManagedInvocation: {
      readonly adapterId: string;
      readonly supportedProviderIds: readonly string[];
    };
    readonly bridgeProjection: BridgeProjectionState | "unresolved";
    readonly managedAgents: readonly NativeHarnessManagedAgentSummary[];
  };
  readonly diagnostics: readonly NativeHarnessDiagnostic[];
}

export interface NativeHarnessInspectionService {
  inspectStatus(): Promise<NativeHarnessStatusResult>;
  inspectWorkGovernance(): Promise<NativeHarnessGovernanceResult>;
  inspectCapability(): Promise<NativeHarnessCapabilityResult>;
}

type SnapshotRead =
  | { readonly snapshot: KilnConfigStatusSnapshot; readonly projectRoot: string }
  | { readonly diagnostic: NativeHarnessDiagnostic };

export function createNativeHarnessInspectionService(
  port: NativeHarnessInspectionPort,
): NativeHarnessInspectionService {
  const readStatus = port.readStatus === undefined ? readConfigStatusSnapshot : port.readStatus;
  const readBridgeProjection = port.readBridgeProjection ?? ((projectRoot) => readNativeHarnessBridgeProjection(projectRoot, port.harness));
  const readProjectRoot = port.readProjectRoot ?? (async () => discoverNativeHarnessProjectRoot());
  const now = port.now ?? (() => new Date());

  async function read(): Promise<SnapshotRead> {
    let root: NativeHarnessProjectRootResolution;
    try {
      root = await readProjectRoot();
    } catch {
      return { diagnostic: diagnosticFor("KILN_INTERNAL_ADAPTER_FAILURE") };
    }
    if (root.status !== "resolved") {
      return { diagnostic: diagnosticFor(root.status === "missing" ? "KILN_PROJECT_ROOT_UNRESOLVED" : "KILN_PROJECT_ROOT_AMBIGUOUS") };
    }
    if (!readStatus) return { diagnostic: diagnosticFor("KILN_RUNTIME_OWNER_MISSING") };

    let candidate: KilnConfigStatusSnapshot;
    try {
      candidate = await readStatus({ projectPath: root.rootPath });
    } catch {
      return { diagnostic: diagnosticFor("KILN_CONFIGURATION_READ_FAILED") };
    }

    const parsed = KilnConfigStatusSnapshotSchema.safeParse(candidate);
    if (!parsed.success) return { diagnostic: diagnosticFor("KILN_EVIDENCE_MALFORMED") };
    if (parsed.data.evidenceVersion === undefined) return { diagnostic: diagnosticFor("KILN_EVIDENCE_MALFORMED") };
    if (parsed.data.evidenceVersion !== KILN_STATUS_EVIDENCE_VERSION) {
      return { diagnostic: diagnosticFor("KILN_EVIDENCE_VERSION_UNSUPPORTED") };
    }

    const observedAt = Date.parse(parsed.data.generatedAt);
    if (!Number.isFinite(observedAt)) return { diagnostic: diagnosticFor("KILN_EVIDENCE_MALFORMED") };
    const currentTime = now().getTime();
    if (observedAt > currentTime + MAX_FUTURE_CLOCK_SKEW_MS) return { diagnostic: diagnosticFor("KILN_EVIDENCE_FUTURE") };
    if (currentTime - observedAt > MAX_EVIDENCE_AGE_MS) return { diagnostic: diagnosticFor("KILN_EVIDENCE_STALE") };
    return { snapshot: parsed.data, projectRoot: root.rootPath };
  }

  return {
    async inspectStatus() {
      const result = await read();
      if ("diagnostic" in result) return unresolvedStatus(result.diagnostic, now(), port.harness);
      const diagnostics = diagnosticsFor(result.snapshot);
      return {
        operation: "status",
        evidence: evidence(result.snapshot, port.harness),
        status: {
          completeness: diagnostics.length === 0 ? "complete" : "degraded",
          projectName: result.snapshot.project.projectName,
          hasGitRoot: result.snapshot.project.hasGitRoot,
          hasKilnYaml: result.snapshot.project.hasKilnYaml,
          globalConfigStatus: result.snapshot.global.status,
          projectConfigStatus: result.snapshot.project.kilnYaml.status,
          projectContextStatus: result.snapshot.project.projectContext.status,
          effectiveConfigStatus: result.snapshot.effectiveConfigStatus,
          recommendedActions: result.snapshot.setup.recommendedActions,
          projections: result.snapshot.projections.map((projection) => ({
            targetId: projection.targetId,
            kind: projection.kind,
            status: projection.status,
          })),
          routes: result.snapshot.projections.flatMap((projection) => projection.routeIntegrity ? [{
            targetId: projection.targetId,
            routeStatus: projection.routeIntegrity.routeStatus,
            credentialStatus: projection.routeIntegrity.credentialStatus,
            classification: projection.routeIntegrity.classification,
          }] : []),
        },
        diagnostics,
      };
    },

    async inspectWorkGovernance() {
      const result = await read();
      if ("diagnostic" in result) return unresolvedGovernance(result.diagnostic, now(), port.harness);
      const diagnostics = diagnosticsFor(result.snapshot);
      const candidate = result.snapshot.effectiveConfig?.workGovernance;
      const policy = result.snapshot.effectiveConfigStatus === "valid"
        ? KilnResolvedWorkGovernancePolicySchema.safeParse(candidate)
        : undefined;
      if (!policy?.success) {
        return unresolvedGovernance(diagnosticFor("KILN_GOVERNANCE_EVIDENCE_MALFORMED"), now(), port.harness, diagnostics, result.snapshot);
      }
      return {
        operation: "work-governance",
        evidence: evidence(result.snapshot, port.harness),
        authority: "authoritative",
        policy: policy.data,
        diagnostics,
      };
    },

    async inspectCapability() {
      const result = await read();
      if ("diagnostic" in result) return unresolvedCapability(result.diagnostic, now(), port.harness);
      const diagnostics = diagnosticsFor(result.snapshot);
      const capabilityDiagnostics: NativeHarnessDiagnostic[] = [];
      const capability = result.snapshot.harnessCapabilities.find((entry) => entry.harness === port.harness);
      let bridgeProjection: BridgeProjectionState | "unresolved" = "unresolved";
      try {
        bridgeProjection = await readBridgeProjection(result.projectRoot);
      } catch {
        capabilityDiagnostics.push(diagnosticFor("KILN_BRIDGE_READ_FAILED"));
      }
      if (!capability || capability.mcpRuntimeTools !== "supported" || bridgeProjection !== "current") {
        capabilityDiagnostics.push(diagnosticFor("KILN_BRIDGE_PROJECTION_UNRESOLVED"));
      }
      return {
        operation: "capability",
        evidence: evidence(result.snapshot, port.harness),
        capability: {
          availability: capabilityDiagnostics.length === 0 ? "available" : "unresolved",
          capabilitySource: "kiln-harness-integration-capabilities",
          mcpRuntimeTools: capability?.mcpRuntimeTools ?? "unresolved",
          nativeProjection: capability?.nativeProjection ?? "unresolved",
          nativeConfigImport: capability?.nativeConfigImport ?? "unresolved",
          hooks: capability?.hooks ?? "unresolved",
          crossHarnessManagedInvocation: capability?.crossHarnessManagedInvocation ?? { adapterId: "unresolved", supportedProviderIds: [] },
          bridgeProjection,
          managedAgents: projectManagedAgents(port.managedAgents ?? []),
        },
        diagnostics: [...diagnostics, ...capabilityDiagnostics],
      };
    },
  };
}

function projectManagedAgents(agents: readonly NativeHarnessManagedAgentSummary[]): readonly NativeHarnessManagedAgentSummary[] {
  return agents.filter((agent) => isIdentifier(agent.configuredAgentProfileId)
    && agent.admissionProfileId === "foundation-readonly-plan"
    && (agent.providerFamily === undefined || isIdentifier(agent.providerFamily))
    && (agent.availability === "admitted" || agent.availability === "unavailable" || agent.availability === "unresolved")
    && (agent.diagnostic === undefined || agent.diagnostic === "route_unavailable" || agent.diagnostic === "eligibility_unresolved"))
    .map((agent) => ({
      configuredAgentProfileId: agent.configuredAgentProfileId,
      ...(agent.displayName ? { displayName: agent.displayName } : {}),
      ...(agent.role ? { role: agent.role } : {}),
      availability: agent.availability,
      admissionProfileId: agent.admissionProfileId,
      ...(agent.providerFamily ? { providerFamily: agent.providerFamily } : {}),
      ...(agent.diagnostic ? { diagnostic: agent.diagnostic } : {}),
      ...(agent.operatorAction ? { operatorAction: agent.operatorAction } : {}),
    }));
}

function unresolvedStatus(diagnostic: NativeHarnessDiagnostic, now: Date, harness: HarnessIntegrationId): NativeHarnessStatusResult {
  return {
    operation: "status",
    evidence: unresolvedEvidence(now, harness),
    status: {
      completeness: "unresolved",
      projectName: "unresolved",
      hasGitRoot: false,
      hasKilnYaml: false,
      globalConfigStatus: "unresolved",
      projectConfigStatus: "unresolved",
      projectContextStatus: "unresolved",
      effectiveConfigStatus: "unresolved",
      recommendedActions: [],
      projections: [],
      routes: [],
    },
    diagnostics: [diagnostic],
  };
}

function unresolvedGovernance(
  diagnostic: NativeHarnessDiagnostic,
  now: Date,
  harness: HarnessIntegrationId,
  diagnostics: readonly NativeHarnessDiagnostic[] = [],
  snapshot?: KilnConfigStatusSnapshot,
): NativeHarnessGovernanceResult {
  return {
    operation: "work-governance",
    evidence: snapshot ? evidence(snapshot, harness) : unresolvedEvidence(now, harness),
    authority: "unresolved",
    diagnostics: [diagnostic, ...diagnostics],
  };
}

function unresolvedCapability(diagnostic: NativeHarnessDiagnostic, now: Date, harness: HarnessIntegrationId): NativeHarnessCapabilityResult {
  return {
    operation: "capability",
    evidence: unresolvedEvidence(now, harness),
    capability: {
      availability: "unresolved",
      capabilitySource: "kiln-harness-integration-capabilities",
      mcpRuntimeTools: "unresolved",
      nativeProjection: "unresolved",
      nativeConfigImport: "unresolved",
      hooks: "unresolved",
      crossHarnessManagedInvocation: { adapterId: "unresolved", supportedProviderIds: [] },
      bridgeProjection: "unresolved",
      managedAgents: [],
    },
    diagnostics: [diagnostic],
  };
}

function diagnosticsFor(snapshot: KilnConfigStatusSnapshot): NativeHarnessDiagnostic[] {
  const diagnostics: NativeHarnessDiagnostic[] = [];
  if (snapshot.effectiveConfigStatus !== "valid") diagnostics.push(diagnosticFor("KILN_CONFIG_EVIDENCE_INCOMPLETE"));
  if (snapshot.errors.length > 0) diagnostics.push(diagnosticFor("KILN_STATUS_EVIDENCE_INCOMPLETE"));
  for (const projection of snapshot.projections) {
    if (projection.status === "stale") diagnostics.push(diagnosticFor("KILN_PROJECTION_STALE", projection.targetId));
    if (projection.status === "drifted") diagnostics.push(diagnosticFor("KILN_PROJECTION_DRIFTED", projection.targetId));
  }
  return diagnostics;
}

function evidence(snapshot: KilnConfigStatusSnapshot, harness: HarnessIntegrationId): NativeHarnessInspectionEvidence {
  return { ...unresolvedEvidence(new Date(snapshot.generatedAt), harness), observedAt: snapshot.generatedAt };
}

function unresolvedEvidence(now: Date, harness: HarnessIntegrationId): NativeHarnessInspectionEvidence {
  return {
    harness: { kind: "native-harness", harness, channel: "control-plane", adapterId: "kiln-control-plane-mcp" },
    authoritySource: "kiln-config-status",
    capabilitySource: "kiln-harness-integration-capabilities",
    directProviderAuthority: "kiln-runtime",
    nativeHarnessPermissionAuthority: "native-harness-only",
    observedAt: now.toISOString(),
  };
}

function diagnosticFor(code: string, targetId?: string): NativeHarnessDiagnostic {
  const diagnostics: Record<string, Omit<NativeHarnessDiagnostic, "code" | "targetId">> = {
    KILN_RUNTIME_OWNER_MISSING: { message: "Kiln's canonical status owner is unavailable.", operatorAction: "Start the Kiln installation that owns this workspace, then retry the read-only inspection." },
    KILN_PROJECT_ROOT_UNRESOLVED: { message: "The project-local native bridge could not resolve its checkout.", operatorAction: "Open the harness from a checkout containing the generated project-local MCP declaration, then retry." },
    KILN_PROJECT_ROOT_AMBIGUOUS: { message: "The bridge source does not identify one compatible Kiln checkout.", operatorAction: "Repair the checkout's package and Kiln project identity, then retry." },
    KILN_CONFIGURATION_READ_FAILED: { message: "Canonical Kiln configuration could not be read safely.", operatorAction: "Verify the local Kiln configuration and setup state, then retry the read-only inspection." },
    KILN_EVIDENCE_MALFORMED: { message: "Canonical status evidence is malformed or incomplete.", operatorAction: "Repair the canonical status owner before relying on this harness inspection." },
    KILN_EVIDENCE_VERSION_UNSUPPORTED: { message: "Canonical status evidence uses an unsupported version.", operatorAction: "Update the Kiln status owner and bridge to compatible versions, then retry." },
    KILN_EVIDENCE_FUTURE: { message: "Canonical status evidence has a future observation time.", operatorAction: "Correct the system clock or regenerate canonical status evidence, then retry." },
    KILN_EVIDENCE_STALE: { message: "Canonical status evidence is stale.", operatorAction: "Regenerate canonical status evidence before relying on an authority decision." },
    KILN_GOVERNANCE_EVIDENCE_MALFORMED: { message: "Resolved work-governance policy is unavailable or malformed.", operatorAction: "Repair the canonical Kiln configuration before making a governed decision." },
    KILN_CONFIG_EVIDENCE_INCOMPLETE: { message: "Canonical effective configuration is incomplete.", operatorAction: "Review Kiln configuration health before governed decisions." },
    KILN_STATUS_EVIDENCE_INCOMPLETE: { message: "Canonical status contains incomplete setup diagnostics.", operatorAction: "Inspect Kiln setup diagnostics before governed decisions." },
    KILN_PROJECTION_STALE: { message: "A Kiln projection is stale.", operatorAction: "Review the reported setup recommendation before trusting that projection." },
    KILN_PROJECTION_DRIFTED: { message: "A Kiln projection has drifted.", operatorAction: "Review the reported setup recommendation before trusting that projection." },
    KILN_BRIDGE_READ_FAILED: { message: "The native bridge declaration could not be read safely.", operatorAction: "Verify the generated project-local MCP declaration, then retry." },
    KILN_BRIDGE_PROJECTION_UNRESOLVED: { message: "Native bridge capability is not fully provable from observed projection evidence.", operatorAction: "Verify the project-local MCP declaration and harness capability before relying on it." },
    KILN_INTERNAL_ADAPTER_FAILURE: { message: "Native-harness inspection could not initialize safely.", operatorAction: "Restart the read-only bridge after reviewing Kiln setup diagnostics." },
  };
  const base = diagnostics[code] ?? { message: "Native-harness inspection failed safely.", operatorAction: "Retry the read-only inspection after reviewing Kiln setup diagnostics." };
  return { code, ...base, ...(targetId ? { targetId } : {}) };
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value);
}

async function readNativeHarnessBridgeProjection(projectRoot: string, harness: HarnessIntegrationId): Promise<BridgeProjectionState> {
  const path = harness === "codex"
    ? join(projectRoot, ".codex", "config.toml")
    : harness === "claude"
      ? join(projectRoot, ".mcp.json")
      : join(projectRoot, "opencode.json");
  if (!existsSync(path)) return "missing";
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = (harness === "codex" ? parseToml(raw) : JSON.parse(stripJsonComments(raw))) as Record<string, unknown>;
    const rootKey = harness === "codex" ? "mcp_servers" : harness === "claude" ? "mcpServers" : "mcp";
    const root = parsed[rootKey] as Record<string, unknown> | undefined;
    const server = root?.["kiln-control-plane"] as { command?: unknown; args?: unknown; enabled?: unknown } | undefined;
    const command = harness === "opencode" && Array.isArray(server?.command) ? server.command : undefined;
    const executable = command ? command[0] : server?.command;
    const args = command ? command.slice(1) : server?.args;
    const expected = ["native-harness", "control-plane-mcp", "--harness", harness, "--project-root", projectRoot];
    return executable === "kiln"
      && Array.isArray(args)
      && args.length === expected.length
      && args.every((value, index) => index === expected.length - 1
        ? typeof value === "string" && resolve(value) === resolve(projectRoot)
        : value === expected[index])
      && (harness === "claude" || server?.enabled === true) ? "current" : "invalid";
  } catch {
    throw new Error("Native harness bridge declaration could not be read");
  }
}
