import { join } from "node:path";
import { createHash } from "node:crypto";
import { createSessionBuiltinToolOptions } from "@kilnai/core";
import {
  collectManagedEconomicCandidates,
  FilesystemManagedJobStore,
  ManagedJobApplicationError,
  ManagedJobApplicationService,
  type ManagedJobRecord,
  type ManagedJobReplayQuery,
  type ManagedJobResultQuery,
} from "@kilnai/runtime";
import { findAgent, loadAgentDefinitions, type KilnAgentDefinition } from "./agent-loader.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { createStagedManagedInvocationRouteCatalog } from "../config/managed-agent-route-catalog.js";
import {
  closeManagedAccountRuntimeComposition,
  createManagedAccountRuntimeComposition,
  projectManagedEconomicJobAdoption,
  type ManagedInvocationRouteResolution,
} from "../config/managed-agent-routes.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "../config/managed-agent-provider-models.js";
import { readConfigStatusSnapshot } from "./config-status.js";
import { discoverNativeHarnessProjectRoot, resolveNativeHarnessProjectRoot } from "./native-harness-project-root.js";
import { createNativeHarnessInspectionService } from "./native-harness-inspection.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
import { loadResolvedKilnMcpConfiguration } from "../config/config-merger.js";
import type { KilnYaml } from "../kiln-yaml-types.js";

/** Slice 3 admits read-only planning only; the route must explicitly support it. */
const REQUIRED_ADMISSION_PROFILE_ID = "foundation-readonly-plan";

/**
 * Production composition for a project-local native-harness bridge. Configuration
 * and Runtime retain route and provider authority; this adapter only connects
 * their already-admitted values to the persistent application owner.
 */
export type NativeHarnessId = "codex" | "claude" | "opencode";

export interface CreateNativeHarnessManagedJobApplicationCompositionOptions {
  readonly harness: NativeHarnessId;
  readonly discoverProviderModels?: () => Promise<ManagedAgentProviderModelCatalogDiagnostics>;
  readonly onRefreshError?: (error: unknown) => void;
  readonly projectPath?: string;
}

export async function createNativeHarnessManagedJobApplicationService(
  options: CreateNativeHarnessManagedJobApplicationCompositionOptions,
): Promise<ManagedJobApplicationService> {
  return (await createNativeHarnessManagedJobApplicationComposition(options)).service;
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

export interface NativeHarnessManagedJobApplicationComposition {
  readonly service: ManagedJobApplicationService;
  readonly application: NativeHarnessManagedJobApplicationPort;
  readonly configuredAgents: readonly NativeHarnessManagedAgentSummary[];
  /** Releases the process-owned economic authority so a restart can reclaim it immediately. */
  close(): void;
}

/** Project identity comes from this trusted composition, never from MCP input. */
export interface NativeHarnessManagedJobApplicationPort {
  submit(input: unknown): Promise<ManagedJobRecord>;
  getStatus(input: { readonly callerId: string }, jobId: string): Promise<ManagedJobRecord>;
  getResult(input: { readonly callerId: string }, jobId: string): Promise<ManagedJobResultQuery>;
  cancel(input: { readonly callerId: string }, jobId: string): Promise<ManagedJobRecord>;
  getReplay(input: { readonly callerId: string }, jobId: string): Promise<ManagedJobReplayQuery>;
}

export async function createNativeHarnessManagedJobApplicationComposition(
  options: CreateNativeHarnessManagedJobApplicationCompositionOptions,
): Promise<NativeHarnessManagedJobApplicationComposition> {
  const root = options.projectPath
    ? resolveNativeHarnessProjectRoot(options.projectPath)
    : discoverNativeHarnessProjectRoot();
  if (root.status !== "resolved") {
    throw new ManagedJobApplicationError("project_identity_unavailable", "Use a trusted project composition boundary.");
  }
  const mcpResolution = loadResolvedKilnMcpConfiguration(root.rootPath);
  if (mcpResolution.diagnostics.length > 0) {
    throw new ManagedJobApplicationError("route_unavailable", "Repair canonical MCP configuration before using managed-agent routes.");
  }
  const admittedMcpServers = Object.values(mcpResolution.servers).filter((server) =>
    server.enabled && server.admission?.state === "admitted");
  const { registry } = createDefaultRegistry({ canonicalMcpServers: admittedMcpServers });
  const inspection = createNativeHarnessInspectionService({ harness: options.harness, readProjectRoot: async () => root });
  const freshManagedInvocation = async (): Promise<NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>> => {
    let config: KilnYaml | undefined;
    try {
      config = (await readConfigStatusSnapshot({ projectPath: root.rootPath })).effectiveConfig as KilnYaml | undefined;
    } catch {
      throw new ManagedJobApplicationError("route_unavailable", "Refresh current canonical managed-route eligibility evidence.");
    }
    if (!config) throw new ManagedJobApplicationError("route_unavailable", "Refresh current canonical managed-route eligibility evidence.");
    let refreshFailure: unknown;
    const catalog = await createStagedManagedInvocationRouteCatalog(config, {
      cwd: root.rootPath,
      registry,
      surface: "operator",
      compositionMode: "candidate-admission",
      directAdapterFactory: createManagedDirectProviderAdapterFactory({
        builtinToolOptions: createSessionBuiltinToolOptions(),
        canonicalMcpServers: admittedMcpServers,
      }),
      builtinToolOptions: createSessionBuiltinToolOptions(),
    }, {
      ...options,
      onRefreshError: (error) => {
        refreshFailure = error;
        options.onRefreshError?.(error);
      },
    });
    await catalog.refreshNow();
    const current = catalog.managedInvocation;
    if (refreshFailure !== undefined || !current) throw new ManagedJobApplicationError("route_unavailable", "Refresh current canonical managed-route eligibility evidence.");
    return current;
  };
  const managedInvocation = await freshManagedInvocation();
  const initialConfig = (await readConfigStatusSnapshot({ projectPath: root.rootPath })).effectiveConfig as KilnYaml | undefined;
  if (!initialConfig) {
    throw new ManagedJobApplicationError("route_unavailable", "Refresh current canonical managed economic configuration.");
  }
  const managedAccountComposition = createManagedAccountRuntimeComposition(initialConfig, root.rootPath);
  if (!managedAccountComposition) {
    throw new ManagedJobApplicationError("route_unavailable", "Configure the managed economic account authority.");
  }
  const commitmentRecovery = managedAccountComposition.authority.createManagedJobCommitmentRecoveryPort();
  const configuredAgents = await loadAgentDefinitions(root.rootPath);
  const project = { id: `project-${createHash("sha256").update(root.rootPath).digest("hex").slice(0, 32)}` };
  const managedJobStore = new FilesystemManagedJobStore(join(root.rootPath, ".kiln", "managed-jobs"));
  const service = new ManagedJobApplicationService({
    project: { resolve: async () => project },
    governance: {
      resolve: async () => {
        const governance = await inspection.inspectWorkGovernance();
        if (governance.authority !== "authoritative") {
          throw new ManagedJobApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");
        }
        const now = new Date();
        return {
          version: 1,
          authority: "authoritative",
          source: "kiln-config-status",
          issuedAt: now.toISOString(),
          validUntil: new Date(now.getTime() + 60_000).toISOString(),
        };
      },
      admit: async () => {
        const governance = await inspection.inspectWorkGovernance();
        if (governance.authority !== "authoritative" || !governance.policy) {
          throw new ManagedJobApplicationError("governance_unavailable", "Restore authoritative Kiln governance evidence.");
        }
        // This surface is delegation, never direct execution. The configured
        // policy must explicitly govern managed-agent work before it is admitted.
        if (!governance.policy.requireDelegationFor.includes("managed-agents")) {
          return { admitted: false };
        }
        return { admitted: true, admissionId: `${options.harness}-managed-agent-delegation`, source: "kiln-work-governance" };
      },
    },
    profiles: {
      resolve: async (id) => {
        const agent = findAgent(await loadAgentDefinitions(root.rootPath), id);
        if (!agent?.economicPolicyId) return undefined;
        const current = await freshManagedInvocation();
        const catalogEntry = current.agentCatalog?.find(
          (candidate) => candidate.name === agent.name,
        );
        if (
          !catalogEntry?.economicPolicyId
          || !catalogEntry.economicPolicyRevision
        ) {
          return undefined;
        }
        return {
          id: agent.name,
          economicPolicyId: catalogEntry.economicPolicyId,
          economicPolicyRevision: catalogEntry.economicPolicyRevision,
          admissionProfileId: agent.authorityProfile ?? REQUIRED_ADMISSION_PROFILE_ID,
          constraints: {
            ...(agent.routeId ? { routeId: agent.routeId } : {}),
            ...(agent.providerRoute?.providerId
              ? { providerId: agent.providerRoute.providerId }
              : {}),
            ...(agent.providerRoute?.model ? { model: agent.providerRoute.model } : {}),
          },
        };
      },
    },
    routes: {
      resolve: async (profile) => {
        const current = await freshManagedInvocation();
        return collectManagedEconomicCandidates({
          economicPolicyId: profile.economicPolicyId,
          economicPolicyRevision: profile.economicPolicyRevision,
          configuredAgentProfileId: profile.id,
          admissionProfileId: profile.admissionProfileId,
          ...(profile.constraints?.routeId
            ? { routeId: profile.constraints.routeId }
            : {}),
          ...(profile.constraints?.providerId
            ? {
                providerRoute: {
                  providerId: profile.constraints.providerId,
                  surface: "configured",
                  ...(profile.constraints.model
                    ? { model: profile.constraints.model }
                    : {}),
                },
              }
            : {}),
        }, current.routes, current.unavailableRoutes);
      },
    },
    economicAdoption: {
      adopt: async (job) => {
        const currentConfig = (await readConfigStatusSnapshot({ projectPath: root.rootPath })).effectiveConfig as KilnYaml | undefined;
        if (!currentConfig) {
          throw new ManagedJobApplicationError("route_unavailable", "Refresh current canonical managed economic configuration.");
        }
        const currentComposition = createManagedAccountRuntimeComposition(currentConfig, root.rootPath);
        if (!currentComposition || currentComposition.authority !== managedAccountComposition.authority) {
          throw new ManagedJobApplicationError("route_unavailable", "Restore the process-owned managed economic authority.");
        }
        return projectManagedEconomicJobAdoption(currentConfig, job, currentComposition.routing);
      },
    },
    economicCommitment: {
      query: (input) => commitmentRecovery.query(input),
      acquire: (input) => managedAccountComposition.authority.acquireCommitment(input),
      releasePreFence: (jobId, economicAttemptId) => {
        managedAccountComposition.authority.releaseCommitmentPreFence(jobId, economicAttemptId);
      },
      recordReleaseFailure: (input) => {
        managedAccountComposition.authority.recordCommitmentReleaseFailure(input);
      },
    },
    commitmentRecovery,
    store: managedJobStore,
  });
  managedAccountComposition.authority.recoverCommitments();
  await service.recoverInterrupted();
  const application: NativeHarnessManagedJobApplicationPort = {
    submit: (input) => service.start(input),
    getStatus: (input, jobId) => service.getStatus({ project, callerId: input.callerId }, jobId),
    getResult: (input, jobId) => service.getResult({ project, callerId: input.callerId }, jobId),
    cancel: (input, jobId) => service.cancel({ project, callerId: input.callerId }, jobId),
    getReplay: (input, jobId) => service.getReplay({ project, callerId: input.callerId }, jobId),
  };
  return {
    service,
    application,
    configuredAgents: summarizeNativeHarnessManagedAgents(configuredAgents, managedInvocation),
    close: () => { closeManagedAccountRuntimeComposition(root.rootPath); },
  };
}

function selectAdmissionProfile(
  route: NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>["routes"][number],
): typeof REQUIRED_ADMISSION_PROFILE_ID | undefined {
  return route.profiles[REQUIRED_ADMISSION_PROFILE_ID] ? REQUIRED_ADMISSION_PROFILE_ID : undefined;
}

export function summarizeNativeHarnessManagedAgents(
  configuredAgents: readonly KilnAgentDefinition[],
  resolution: ManagedInvocationRouteResolution["managedInvocation"],
): readonly NativeHarnessManagedAgentSummary[] {
  return configuredAgents.flatMap((agent): readonly NativeHarnessManagedAgentSummary[] => {
    if (!agent.economicPolicyId) return [];
    const base = {
      configuredAgentProfileId: agent.name,
      ...(agent.displayName ? { displayName: agent.displayName } : {}),
      ...(agent.role ? { role: agent.role } : {}),
      admissionProfileId: REQUIRED_ADMISSION_PROFILE_ID,
    };
    const catalogEntry = resolution?.agentCatalog?.find(
      (candidate) =>
        candidate.name === agent.name
        && candidate.economicPolicyId === agent.economicPolicyId,
    );
    const policyRouteIds = new Set(
      catalogEntry?.economicPolicyCandidateRouteIds ?? [],
    );
    const admittedRoutes = (resolution?.routes ?? []).filter(
      (route) =>
        policyRouteIds.has(route.routeId)
        && (!agent.routeId || route.routeId === agent.routeId)
        && (
          !agent.providerRoute
          || (
            route.providerId === agent.providerRoute.providerId
            && (
              !agent.providerRoute.model
              || route.model === agent.providerRoute.model
            )
          )
        )
        && selectAdmissionProfile(route) !== undefined
        && route.economicCapability?.status === "verified",
    );
    if (admittedRoutes.length > 0) {
      const providers = [...new Set(admittedRoutes.map((route) => route.providerId))];
      return [{
        ...base,
        availability: "admitted",
        ...(providers.length === 1 ? { providerFamily: providers[0] } : {}),
      }];
    }
    const unavailable = resolution?.unavailableRoutes?.find((candidate) =>
      policyRouteIds.has(candidate.routeId)
      && candidate.profiles.includes(REQUIRED_ADMISSION_PROFILE_ID));
    if (unavailable) {
      return [{
        ...base,
        availability: "unresolved",
        providerFamily: unavailable.providerId,
        diagnostic: "eligibility_unresolved",
        operatorAction: "Refresh canonical managed-route eligibility evidence before invoking this configured agent.",
      }];
    }
    return [{
      ...base,
      availability: "unavailable",
      diagnostic: "route_unavailable",
      operatorAction: "Restore at least one non-economically admitted route in the configured economic policy.",
    }];
  });
}
