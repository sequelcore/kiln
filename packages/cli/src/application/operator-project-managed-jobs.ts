import { join } from "node:path";
import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  createSessionBuiltinToolOptions,
  defineManagedAgentInvocationRequest,
} from "@kilnai/core";
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
  createManagedEconomicDispatchComposition,
  projectManagedEconomicJobAdoption,
  type ManagedAgentRouteConfigSource,
  type ManagedInvocationRouteResolution,
} from "../config/managed-agent-routes.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "../config/managed-agent-provider-models.js";
import { resolveNativeHarnessProjectRoot } from "./native-harness-project-root.js";
import { readConfigStatusSnapshot } from "./config-status.js";
import {
  KILN_STATUS_EVIDENCE_VERSION,
  KilnConfigStatusSnapshotSchema,
  KilnResolvedWorkGovernancePolicySchema,
  type KilnResolvedWorkGovernancePolicy,
} from "@kilnai/gateway-contracts";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
import { deriveEffectiveKilnYaml, loadResolvedKilnMcpConfiguration } from "../config/config-merger.js";
import { readGlobalConfig } from "../config/global-config.js";
import { readKilnYaml } from "../kiln-yaml.js";

const MAX_GOVERNANCE_EVIDENCE_AGE_MS = 5 * 60 * 1_000;
const MAX_GOVERNANCE_FUTURE_CLOCK_SKEW_MS = 60 * 1_000;
const OPERATOR_MANAGED_JOB_ADMISSION_ID = "operator-managed-agent-delegation";
const OPERATOR_MANAGED_JOB_SOURCE = "operator-managed-job";

/**
 * `modelGateway`, `engines`, `routing`, and `models` are global Runtime
 * route authority; none of them are project `KilnYaml` fields, so
 * `globalToKilnYaml` (and therefore the effective-`KilnYaml` projection)
 * never carries them. Read canonical global config and canonical project
 * config exactly once each, derive the effective project-authorized config
 * from those exact values, and attach the global-only authority from the
 * same global read -- so a project `kiln.yaml` can never define or override
 * it, and no two reads of global config can observe different snapshots.
 */
function loadOperatorProjectManagedRouteConfig(
  rootPath: string,
): ManagedAgentRouteConfigSource | undefined {
  const globalConfig = readGlobalConfig();
  const projectConfig = readKilnYaml(join(rootPath, ".kiln"));
  const effectiveConfig = deriveEffectiveKilnYaml(globalConfig, projectConfig);
  if (!effectiveConfig) return undefined;
  return {
    ...effectiveConfig,
    modelGateway: globalConfig?.modelGateway,
    engines: globalConfig?.engines,
    routing: globalConfig?.routing,
    models: globalConfig?.models,
  };
}

/** Slice 3 admits read-only planning only; the route must explicitly support it. */
const REQUIRED_ADMISSION_PROFILE_ID = "foundation-readonly-plan";

/**
 * Production composition for one operator-supervised project Runtime.
 * Configuration and Runtime retain route and provider authority; this owner
 * serves every admitted native-harness caller without adopting harness identity.
 */
export interface CreateOperatorProjectManagedJobApplicationCompositionOptions {
  readonly discoverProviderModels?: () => Promise<ManagedAgentProviderModelCatalogDiagnostics>;
  readonly onRefreshError?: (error: unknown) => void;
  readonly projectPath: string;
}

interface OperatorProjectGovernanceEvidence {
  readonly policy: KilnResolvedWorkGovernancePolicy;
}

/**
 * Reads project-neutral governance authority from the canonical config-status
 * owner. Harness-facing inspection remains a separate per-request concern.
 */
function createOperatorProjectGovernanceReader(rootPath: string): {
  read(): Promise<OperatorProjectGovernanceEvidence>;
} {
  return {
    async read() {
      let candidate: unknown;
      try {
        candidate = await readConfigStatusSnapshot({ projectPath: rootPath });
      } catch {
        throw new ManagedJobApplicationError("governance_unavailable", "Restore authoritative Kiln governance evidence.");
      }
      const snapshot = KilnConfigStatusSnapshotSchema.safeParse(candidate);
      if (
        !snapshot.success
        || snapshot.data.evidenceVersion !== KILN_STATUS_EVIDENCE_VERSION
        || !sameCanonicalProjectRoot(snapshot.data.project.rootPath, rootPath)
        || snapshot.data.effectiveConfigStatus !== "valid"
      ) {
        throw new ManagedJobApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");
      }
      const observedAt = Date.parse(snapshot.data.generatedAt);
      const now = Date.now();
      if (
        !Number.isFinite(observedAt)
        || observedAt > now + MAX_GOVERNANCE_FUTURE_CLOCK_SKEW_MS
        || now - observedAt > MAX_GOVERNANCE_EVIDENCE_AGE_MS
      ) {
        throw new ManagedJobApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");
      }
      const policy = KilnResolvedWorkGovernancePolicySchema.safeParse(
        snapshot.data.effectiveConfig?.workGovernance,
      );
      if (!policy.success) {
        throw new ManagedJobApplicationError("governance_not_authoritative", "Refresh authoritative Kiln governance evidence.");
      }
      return { policy: policy.data };
    },
  };
}

function sameCanonicalProjectRoot(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
}

export async function createOperatorProjectManagedJobApplicationService(
  options: CreateOperatorProjectManagedJobApplicationCompositionOptions,
): Promise<ManagedJobApplicationService> {
  return (await createOperatorProjectManagedJobApplicationComposition(options)).service;
}

export interface OperatorProjectManagedAgentSummary {
  readonly configuredAgentProfileId: string;
  readonly displayName?: string;
  readonly role?: string;
  readonly availability: "admitted" | "unavailable" | "unresolved";
  readonly providerFamily?: string;
  readonly admissionProfileId: string;
  readonly diagnostic?: "route_unavailable" | "eligibility_unresolved";
  readonly operatorAction?: string;
}

export interface OperatorProjectManagedJobApplicationComposition {
  readonly service: ManagedJobApplicationService;
  readonly application: OperatorProjectManagedJobApplicationPort;
  readonly configuredAgents: readonly OperatorProjectManagedAgentSummary[];
  /** Releases the process-owned economic authority so a restart can reclaim it immediately. */
  close(): void;
}

/** Project identity comes from this trusted composition, never from MCP input. */
export interface OperatorProjectManagedJobApplicationPort {
  submit(input: unknown): Promise<ManagedJobRecord>;
  getStatus(input: { readonly callerId: string }, jobId: string): Promise<ManagedJobRecord>;
  getResult(input: { readonly callerId: string }, jobId: string): Promise<ManagedJobResultQuery>;
  cancel(input: { readonly callerId: string }, jobId: string): Promise<ManagedJobRecord>;
  getReplay(input: { readonly callerId: string }, jobId: string): Promise<ManagedJobReplayQuery>;
}

export async function createOperatorProjectManagedJobApplicationComposition(
  options: CreateOperatorProjectManagedJobApplicationCompositionOptions,
): Promise<OperatorProjectManagedJobApplicationComposition> {
  if (!options || typeof options.projectPath !== "string" || options.projectPath.trim().length === 0) {
    throw new ManagedJobApplicationError("project_identity_unavailable", "Use a trusted project composition boundary.");
  }
  const root = resolveNativeHarnessProjectRoot(options.projectPath);
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
  const governance = createOperatorProjectGovernanceReader(root.rootPath);
  const freshManagedInvocation = async (): Promise<NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>> => {
    let config: ManagedAgentRouteConfigSource | undefined;
    try {
      config = loadOperatorProjectManagedRouteConfig(root.rootPath);
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
  const initialConfig = loadOperatorProjectManagedRouteConfig(root.rootPath);
  if (!initialConfig) {
    throw new ManagedJobApplicationError("route_unavailable", "Refresh current canonical managed economic configuration.");
  }
  const managedAccountComposition = createManagedAccountRuntimeComposition(initialConfig, root.rootPath);
  if (!managedAccountComposition) {
    throw new ManagedJobApplicationError("route_unavailable", "Configure the managed economic account authority.");
  }
  const economicDispatch = createManagedEconomicDispatchComposition(
    initialConfig,
    root.rootPath,
    managedInvocation.routes,
    managedAccountComposition,
  );
  const commitmentRecovery = managedAccountComposition.authority.createManagedJobCommitmentRecoveryPort();
  const economicReplay = managedAccountComposition.authority.createManagedJobReplayInspectionPort();
  const configuredAgents = await loadAgentDefinitions(root.rootPath);
  const project = { id: `project-${createHash("sha256").update(root.rootPath).digest("hex").slice(0, 32)}` };
  const managedJobStore = new FilesystemManagedJobStore(join(root.rootPath, ".kiln", "managed-jobs"));
  const service = new ManagedJobApplicationService({
    project: { resolve: async () => project },
    governance: {
      resolve: async () => {
        await governance.read();
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
        const { policy } = await governance.read();
        // This surface is delegation, never direct execution. The configured
        // policy must explicitly govern managed-agent work before it is admitted.
        if (!policy.requireDelegationFor.includes("managed-agents")) {
          return { admitted: false };
        }
        return { admitted: true, admissionId: OPERATOR_MANAGED_JOB_ADMISSION_ID, source: "kiln-work-governance" };
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
        const currentConfig = loadOperatorProjectManagedRouteConfig(root.rootPath);
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
    economicReplay,
    economicDispatch: economicDispatch.coordinator,
    economicExecution: {
      execute: async ({ job, preparation }) => {
        const selected = preparation.commitment.reservation.selectedIdentity.route;
        const route = managedInvocation.routes.find((candidate) =>
          candidate.routeId === selected.routeId
          && candidate.providerId === selected.providerId
          && candidate.model === selected.modelId);
        const profile = route?.profiles[job.admissionProfileId];
        const invocationService = managedInvocation.invocationService;
        if (!route || !profile || !invocationService) {
          throw new ManagedJobApplicationError("route_unavailable", "Restore the exact committed managed Runtime route.");
        }
        const request = defineManagedAgentInvocationRequest({
          invocationId: `managed-job:${job.id}`,
          agentId: job.configuredAgentProfileId,
          parentSessionId: job.parent?.invocationId ?? job.id,
          parentTurnId: job.parent?.turnId ?? job.id,
          profile: job.admissionProfileId,
          requestedBy: job.callerId,
          requestSource: OPERATOR_MANAGED_JOB_SOURCE,
          providerRoute: {
            providerId: selected.providerId,
            surface: route.surface ?? "direct-provider",
            model: selected.modelId,
          },
          adapterKind: preparation.adapter.descriptor.adapterKind,
          executionMode: preparation.adapter.descriptor.supportedExecutionModes[0] ?? "direct-provider",
          requestedAuthority: "read_only",
          authority: {
            authorityProfileId: profile.authorityProfileId,
            permissionProfile: profile.permissionProfile,
            toolAuthority: {
              allowedToolNames: profile.allowedToolNames,
              writeAllowed: profile.writeAllowed ?? false,
              networkAllowed: profile.networkAllowed ?? false,
            },
            workingDirectory: profile.workingDirectory,
            timeoutMs: profile.timeoutMs,
            credentialRoute: profile.credentialRoute,
            memoryScope: profile.memoryScope,
            ...(profile.readAuthority ? { readAuthority: profile.readAuthority } : {}),
            ...(profile.writeAuthority ? { writeAuthority: profile.writeAuthority } : {}),
          },
          input: { summary: job.objective },
        });
        const started = await invocationService.start(request, preparation.adapter, {
          capturedAt: new Date().toISOString(),
          routeId: route.routeId,
          routeSource: route.routeSource,
          callerIdentity: {
            kind: "kiln-runtime",
            surface: OPERATOR_MANAGED_JOB_SOURCE,
            attachmentId: `managed-job:${job.id}`,
          },
          ...(route.providerModelProof ? { providerModelProof: route.providerModelProof } : {}),
        }, {
          abortSignal: preparation.abortSignal,
          economicDispatch: {
            commitment: preparation.commitment,
            dispatchFenceId: preparation.dispatchFenceId,
            recordExecutionSettlementPending: preparation.recordExecutionSettlementPending,
            createExecutionSettlement: preparation.createExecutionSettlement,
            registerEconomicSettlement: preparation.registerEconomicSettlement,
          },
        });
        if (started.status !== "started") {
          throw new ManagedJobApplicationError("admission_denied", "Review the exact committed managed Runtime authority.");
        }
        const joined = await invocationService.join(request.invocationId);
        if (joined.status !== "completed" || joined.record.lifecycleState !== "completed" || !joined.record.resultHandoff) {
          throw new ManagedJobApplicationError("invocation_failed", "Inspect durable managed Runtime terminal evidence.");
        }
        return {
          runtimeInvocationId: joined.record.invocationId,
          completedAt: new Date().toISOString(),
          resultHandoff: joined.record.resultHandoff,
        };
      },
    },
    commitmentRecovery,
    store: managedJobStore,
  });
  await service.recoverInterrupted();
  const application: OperatorProjectManagedJobApplicationPort = {
    submit: (input) => service.start(input),
    getStatus: (input, jobId) => service.getStatus({ project, callerId: input.callerId }, jobId),
    getResult: (input, jobId) => service.getResult({ project, callerId: input.callerId }, jobId),
    cancel: (input, jobId) => service.cancel({ project, callerId: input.callerId }, jobId),
    getReplay: (input, jobId) => service.getReplay({ project, callerId: input.callerId }, jobId),
  };
  return {
    service,
    application,
    configuredAgents: summarizeOperatorProjectManagedAgents(configuredAgents, managedInvocation),
    close: () => { closeManagedAccountRuntimeComposition(root.rootPath); },
  };
}

function selectAdmissionProfile(
  route: NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>["routes"][number],
): typeof REQUIRED_ADMISSION_PROFILE_ID | undefined {
  return route.profiles[REQUIRED_ADMISSION_PROFILE_ID] ? REQUIRED_ADMISSION_PROFILE_ID : undefined;
}

export function summarizeOperatorProjectManagedAgents(
  configuredAgents: readonly KilnAgentDefinition[],
  resolution: ManagedInvocationRouteResolution["managedInvocation"],
): readonly OperatorProjectManagedAgentSummary[] {
  return configuredAgents.flatMap((agent): readonly OperatorProjectManagedAgentSummary[] => {
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
