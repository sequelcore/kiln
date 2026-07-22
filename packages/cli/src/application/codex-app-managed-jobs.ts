import { join } from "node:path";
import { createHash } from "node:crypto";
import { createSessionBuiltinToolOptions, defineManagedAgentInvocationRequest, type ManagedAgentAdmissionProfile } from "@kilnai/core";
import {
  FilesystemManagedJobStore,
  ManagedJobApplicationError,
  ManagedJobApplicationService,
  createRuntimeManagedJobInvocationPort,
  type ManagedJobRecord,
  type ManagedJobReplayQuery,
  type ManagedJobResultQuery,
  type ManagedJobProfile,
  type ManagedJobRoute,
  type ManagedJobRuntimeInvocationResolver,
} from "@kilnai/runtime";
import { findAgent, loadAgentDefinitions, type KilnAgentDefinition } from "./agent-loader.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { createStagedManagedInvocationRouteCatalog } from "../config/managed-agent-route-catalog.js";
import type { ManagedInvocationRouteResolution } from "../config/managed-agent-routes.js";
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
  const configuredAgents = await loadAgentDefinitions(root.rootPath);
  const admittedRoutes = new Map<string, {
    readonly route: NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>["routes"][number];
    readonly invocationService: NonNullable<NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>["invocationService"]>;
  }>();
  const activeInvocationServices = new Map<string, NonNullable<NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>["invocationService"]>>();

  const project = { id: `project-${createHash("sha256").update(root.rootPath).digest("hex").slice(0, 32)}` };
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
        return agent?.routeId ? { id: agent.name, routeId: agent.routeId } : undefined;
      },
    },
    routes: {
      resolve: async (profile) => {
        const current = await freshManagedInvocation();
        const route = routeForProfile(current, profile);
        if (route) {
          const selected = current.routes.find((candidate) => candidate.routeId === route.id);
          if (selected && current.invocationService) admittedRoutes.set(`${profile.id}:${route.id}`, { route: selected, invocationService: current.invocationService });
        }
        return route;
      },
    },
    runtime: {
      invoke: async (input) => {
        const admitted = admittedRoutes.get(`${input.profile.id}:${input.route.id}`);
        if (!admitted) {
          throw new ManagedJobApplicationError("route_unavailable", "Configure an admitted managed-agent route.");
        }
        const port = createRuntimeManagedJobInvocationPort({ service: admitted.invocationService, resolver: runtimeResolver(admitted.route, options.harness) });
        activeInvocationServices.set(input.jobId, admitted.invocationService);
        try {
          return await port.invoke(input);
        } finally {
          activeInvocationServices.delete(input.jobId);
        }
      },
      cancel: async ({ jobId, reason }) => {
        const invocationService = activeInvocationServices.get(jobId);
        if (!invocationService) throw new ManagedJobApplicationError("invocation_failed", "Cancel only an active Runtime-owned managed invocation.");
        await invocationService.cancel(jobId, reason);
      },
    },
    store: new FilesystemManagedJobStore(join(root.rootPath, ".kiln", "managed-jobs")),
  });
  await service.recoverInterrupted();
  const application: NativeHarnessManagedJobApplicationPort = {
    submit: (input) => service.start(input),
    getStatus: (input, jobId) => service.getStatus({ project, callerId: input.callerId }, jobId),
    getResult: (input, jobId) => service.getResult({ project, callerId: input.callerId }, jobId),
    cancel: (input, jobId) => service.cancel({ project, callerId: input.callerId }, jobId),
    getReplay: (input, jobId) => service.getReplay({ project, callerId: input.callerId }, jobId),
  };
  return { service, application, configuredAgents: summarizeNativeHarnessManagedAgents(configuredAgents, managedInvocation) };
}

function routeForProfile(resolution: ManagedInvocationRouteResolution["managedInvocation"], profile: ManagedJobProfile): ManagedJobRoute | undefined {
  const routes = resolution?.routes.filter((candidate) => candidate.routeId === profile.routeId) ?? [];
  if (routes.length !== 1) return undefined;
  const route = routes[0];
  if (!route) return undefined;
  const admissionProfileId = selectAdmissionProfile(route);
  if (!admissionProfileId) return undefined;
  const routeProfile = route.profiles[admissionProfileId];
  if (!routeProfile) return undefined;
  const observedAt = new Date();
  return {
    id: route.routeId,
    admissionProfileId,
    supportedAdmissionProfileIds: Object.keys(route.profiles),
    providerId: route.providerId,
    timeoutSource: routeProfile.timeoutSource ?? "default",
    scope: { project: "validated", read: "validated", tools: "validated", network: "validated", write: "validated" },
    eligibility: { authority: "authoritative", observedAt: observedAt.toISOString(), validUntil: new Date(observedAt.getTime() + 60_000).toISOString() },
    authority: managedJobAuthority(routeProfile),
  };
}

function runtimeResolver(
  route: NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>["routes"][number],
  harness: NativeHarnessId,
): ManagedJobRuntimeInvocationResolver {
  return {
    async resolve(input) {
      const profile = route?.profiles[input.route.admissionProfileId as ManagedAgentAdmissionProfile];
      if (!profile || route.routeId !== input.route.id || !input.route.supportedAdmissionProfileIds.includes(input.route.admissionProfileId)) {
        throw new ManagedJobApplicationError("route_unavailable", "Configure the configured agent's admitted managed-agent route.");
      }
      const request = defineManagedAgentInvocationRequest({
        invocationId: input.jobId,
        agentId: `${route.routeId}:${input.profile.id}`,
        parentSessionId: `${harness}-native-harness`,
        parentTurnId: input.jobId,
        profile: input.route.admissionProfileId as ManagedAgentAdmissionProfile,
        requestedBy: `${harness}-native-harness`,
        requestSource: `${harness}-control-plane-mcp`,
        providerRoute: { providerId: route.providerId, surface: "direct-provider", ...(route.model ? { model: route.model } : {}) },
        adapterKind: route.adapter.descriptor.adapterKind,
        executionMode: "direct-provider",
        authority: input.route.authority,
        input: { summary: input.objective.slice(0, 512), prompt: input.objective, context: { mode: "isolated" } },
      });
      return {
        request,
        adapter: route.adapter,
        capabilitySnapshot: {
          routeId: route.routeId,
          routeSource: route.routeSource,
          callerIdentity: { kind: "external-harness", harness, attachmentId: "kiln-control-plane-mcp", evidenceId: `${harness}-control-plane-mcp` },
          routeHealth: { status: "healthy", reason: `Configured ${harness} managed-job route.` },
          providerModelProof: { status: "configured", source: "configured-managed-route", requiresToolCalls: true },
          resourcePlane: { available: true, resourceUris: [] },
          childIdentity: { agentId: request.agentId, requestedAgentProfile: input.profile.id },
        },
      };
    },
  };
}

function selectAdmissionProfile(
  route: NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>["routes"][number],
): ManagedAgentAdmissionProfile | undefined {
  return route.profiles[REQUIRED_ADMISSION_PROFILE_ID] ? REQUIRED_ADMISSION_PROFILE_ID : undefined;
}

function managedJobAuthority(
  profile: NonNullable<NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>["routes"][number]["profiles"][ManagedAgentAdmissionProfile]>,
): ManagedJobRoute["authority"] {
  return {
    authorityProfileId: profile.authorityProfileId,
    permissionProfile: profile.permissionProfile,
    toolAuthority: { allowedToolNames: profile.allowedToolNames, writeAllowed: profile.writeAllowed === true, networkAllowed: profile.networkAllowed === true },
    workingDirectory: profile.workingDirectory,
    timeoutMs: profile.timeoutMs,
    ...(profile.timeoutSource ? { timeoutSource: profile.timeoutSource } : {}),
    credentialRoute: profile.credentialRoute,
    memoryScope: profile.memoryScope,
    ...(profile.readAuthority ? { readAuthority: profile.readAuthority } : {}),
    ...(profile.writeAuthority ? { writeAuthority: profile.writeAuthority } : {}),
  };
}

export function summarizeNativeHarnessManagedAgents(
  configuredAgents: readonly KilnAgentDefinition[],
  resolution: ManagedInvocationRouteResolution["managedInvocation"],
): readonly NativeHarnessManagedAgentSummary[] {
  return configuredAgents.flatMap((agent): readonly NativeHarnessManagedAgentSummary[] => {
    if (!agent.routeId) return [];
    const base = {
      configuredAgentProfileId: agent.name,
      ...(agent.displayName ? { displayName: agent.displayName } : {}),
      ...(agent.role ? { role: agent.role } : {}),
      admissionProfileId: REQUIRED_ADMISSION_PROFILE_ID,
    };
    const routes = resolution?.routes.filter((route) => route.routeId === agent.routeId) ?? [];
    const route = routes.length === 1 ? routes[0] : undefined;
    const admissionProfileId = route ? selectAdmissionProfile(route) : undefined;
    if (route && admissionProfileId) {
      return [{ ...base, availability: "admitted", providerFamily: route.providerId }];
    }
    const unavailable = resolution?.unavailableRoutes?.find((candidate) =>
      candidate.routeId === agent.routeId && candidate.profiles.includes(REQUIRED_ADMISSION_PROFILE_ID));
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
      operatorAction: "Restore the configured route hint and its admitted managed-agent route.",
    }];
  });
}
