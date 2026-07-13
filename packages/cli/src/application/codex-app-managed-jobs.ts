import { join } from "node:path";
import { createHash } from "node:crypto";
import { createSessionBuiltinToolOptions, defineManagedAgentInvocationRequest, type ManagedAgentAdmissionProfile } from "@kilnai/core";
import {
  FilesystemManagedJobStore,
  ManagedJobApplicationError,
  ManagedJobApplicationService,
  createRuntimeManagedJobInvocationPort,
  type ManagedJobProfile,
  type ManagedJobRoute,
  type ManagedJobRuntimeInvocationResolver,
} from "@kilnai/runtime";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { createStagedManagedInvocationRouteCatalog } from "../config/managed-agent-route-catalog.js";
import type { ManagedInvocationRouteResolution } from "../config/managed-agent-routes.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "../config/managed-agent-provider-models.js";
import { readConfigStatusSnapshot } from "./config-status.js";
import { discoverNativeHarnessProjectRoot } from "./native-harness-project-root.js";
import { createNativeHarnessInspectionService } from "./native-harness-inspection.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
import type { KilnYaml } from "../kiln-yaml-types.js";

const CODEX_APP_CALLER_ID = "codex-app";
const ADMITTED_PROVIDER_ID = "opencode-go";
const ADMITTED_PROFILE_ID = "foundation-readonly-plan";

/**
 * Production composition for the project-local Codex App bridge. Configuration
 * and Runtime retain route and provider authority; this adapter only connects
 * their already-admitted values to the persistent application owner.
 */
export interface CreateCodexAppManagedJobApplicationCompositionOptions {
  readonly discoverProviderModels?: () => Promise<ManagedAgentProviderModelCatalogDiagnostics>;
}

export async function createCodexAppManagedJobApplicationService(
  options?: CreateCodexAppManagedJobApplicationCompositionOptions,
): Promise<ManagedJobApplicationService> {
  return (await createCodexAppManagedJobApplicationComposition(options)).service;
}

export interface CodexAppManagedProfileSummary {
  readonly id: string;
  readonly availability: "admitted" | "unavailable" | "unresolved";
  readonly providerId: "opencode-go";
  readonly diagnostic?: "profile_unavailable" | "route_unavailable" | "eligibility_unresolved";
  readonly operatorAction?: string;
}

export interface CodexAppManagedJobApplicationComposition {
  readonly service: ManagedJobApplicationService;
  readonly profiles: readonly CodexAppManagedProfileSummary[];
}

export async function createCodexAppManagedJobApplicationComposition(
  options: CreateCodexAppManagedJobApplicationCompositionOptions = {},
): Promise<CodexAppManagedJobApplicationComposition> {
  const root = discoverNativeHarnessProjectRoot();
  if (root.status !== "resolved") {
    throw new ManagedJobApplicationError("project_identity_unavailable", "Use a trusted project composition boundary.");
  }
  const snapshot = await readConfigStatusSnapshot({ projectPath: root.rootPath });
  const config = snapshot.effectiveConfig as KilnYaml | undefined;
  const { registry } = createDefaultRegistry();
  const catalog = config
    ? await createStagedManagedInvocationRouteCatalog(config, {
      cwd: root.rootPath,
      registry,
      surface: "operator",
      directAdapterFactory: createManagedDirectProviderAdapterFactory({
        builtinToolOptions: createSessionBuiltinToolOptions(),
      }),
      builtinToolOptions: createSessionBuiltinToolOptions(),
    }, options)
    : undefined;
  await catalog?.refreshNow();
  const managedInvocation = catalog?.managedInvocation;

  const service = new ManagedJobApplicationService({
    project: { resolve: async () => ({ id: `project-${createHash("sha256").update(root.rootPath).digest("hex").slice(0, 32)}` }) },
    governance: {
      resolve: async () => {
        const governance = await createNativeHarnessInspectionService().inspectWorkGovernance();
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
        const governance = await createNativeHarnessInspectionService().inspectWorkGovernance();
        if (governance.authority !== "authoritative" || !governance.policy) {
          throw new ManagedJobApplicationError("governance_unavailable", "Restore authoritative Kiln governance evidence.");
        }
        // This surface is delegation, never direct execution. The configured
        // policy must explicitly govern managed-agent work before it is admitted.
        if (!governance.policy.requireDelegationFor.includes("managed-agents")) {
          return { admitted: false };
        }
        return { admitted: true, admissionId: "codex-app-managed-agent-delegation", source: "kiln-work-governance" };
      },
    },
    profiles: {
      resolve: async (id) => isConfiguredProfile(managedInvocation, id) ? { id } : undefined,
    },
    routes: {
      resolve: async (profile) => routeForProfile(managedInvocation, profile),
    },
    runtime: managedInvocation?.invocationService
      ? createRuntimeManagedJobInvocationPort({ service: managedInvocation.invocationService, resolver: runtimeResolver(managedInvocation) })
      : { invoke: async () => { throw new ManagedJobApplicationError("route_unavailable", "Configure an admitted managed-agent route."); } },
    store: new FilesystemManagedJobStore(join(root.rootPath, ".kiln", "managed-jobs")),
  });
  return { service, profiles: summarizeCodexAppManagedProfiles(managedInvocation) };
}

function isConfiguredProfile(resolution: ManagedInvocationRouteResolution["managedInvocation"], id: string): boolean {
  return id === ADMITTED_PROFILE_ID
    && (resolution?.routes.some((route) => route.providerId === ADMITTED_PROVIDER_ID && route.profiles[ADMITTED_PROFILE_ID] !== undefined) ?? false);
}

function routeForProfile(resolution: ManagedInvocationRouteResolution["managedInvocation"], profile: ManagedJobProfile): ManagedJobRoute | undefined {
  if (profile.id !== ADMITTED_PROFILE_ID) return undefined;
  const routes = resolution?.routes.filter((candidate) => candidate.providerId === ADMITTED_PROVIDER_ID && candidate.profiles[ADMITTED_PROFILE_ID] !== undefined) ?? [];
  if (routes.length !== 1) return undefined;
  const route = routes[0];
  if (!route) return undefined;
  const routeProfile = route.profiles[profile.id as ManagedAgentAdmissionProfile]!;
  return {
    id: route.routeId,
    agentProfileId: profile.id,
    providerId: route.providerId,
    timeoutSource: routeProfile.timeoutSource ?? "default",
  };
}

function runtimeResolver(resolution: NonNullable<ManagedInvocationRouteResolution["managedInvocation"]>): ManagedJobRuntimeInvocationResolver {
  return {
    async resolve(input) {
      const route = input.profile.id === ADMITTED_PROFILE_ID
        ? resolution.routes.find((candidate) => candidate.routeId === input.route.id && candidate.providerId === ADMITTED_PROVIDER_ID && candidate.profiles[ADMITTED_PROFILE_ID] !== undefined)
        : undefined;
      const profile = route?.profiles[ADMITTED_PROFILE_ID];
      if (!route || !profile || route.providerId !== ADMITTED_PROVIDER_ID) {
        throw new ManagedJobApplicationError("route_unavailable", "Configure an admitted opencode-go managed-agent route.");
      }
      const request = defineManagedAgentInvocationRequest({
        invocationId: input.jobId,
        agentId: `${route.routeId}:${input.profile.id}`,
        parentSessionId: CODEX_APP_CALLER_ID,
        parentTurnId: input.jobId,
        profile: input.profile.id as ManagedAgentAdmissionProfile,
        requestedBy: CODEX_APP_CALLER_ID,
        requestSource: "codex-app-mcp",
        providerRoute: { providerId: route.providerId, surface: "direct-provider", ...(route.model ? { model: route.model } : {}) },
        adapterKind: route.adapter.descriptor.adapterKind,
        executionMode: "direct-provider",
        authority: {
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
        },
        input: { summary: input.objective.slice(0, 512), prompt: input.objective, context: { mode: "isolated" } },
      });
      return {
        request,
        adapter: route.adapter,
        capabilitySnapshot: {
          routeId: route.routeId,
          routeSource: route.routeSource,
          callerIdentity: { kind: "external-harness", harness: "codex", attachmentId: "kiln-codex-app-mcp", evidenceId: "codex-app-mcp" },
          routeHealth: { status: "healthy", reason: "Configured Codex App managed-job route." },
          providerModelProof: { status: "configured", source: "configured-managed-route", requiresToolCalls: true },
          resourcePlane: { available: true, resourceUris: [] },
          childIdentity: { agentId: request.agentId, requestedAgentProfile: input.profile.id },
        },
      };
    },
  };
}

export function summarizeCodexAppManagedProfiles(resolution: ManagedInvocationRouteResolution["managedInvocation"]): readonly CodexAppManagedProfileSummary[] {
  const routes = resolution?.routes.filter((route) => route.providerId === ADMITTED_PROVIDER_ID && route.profiles[ADMITTED_PROFILE_ID] !== undefined) ?? [];
  if (routes.length === 1) return [{ id: ADMITTED_PROFILE_ID, availability: "admitted", providerId: ADMITTED_PROVIDER_ID }];
  const unresolved = resolution?.unavailableRoutes?.some((route) => route.providerId === ADMITTED_PROVIDER_ID && route.profiles.includes(ADMITTED_PROFILE_ID)) ?? false;
  if (unresolved) return [{
    id: ADMITTED_PROFILE_ID,
    availability: "unresolved",
    providerId: ADMITTED_PROVIDER_ID,
    diagnostic: "eligibility_unresolved",
    operatorAction: "Refresh canonical managed-route eligibility evidence before invoking this profile.",
  }];
  return [{
    id: ADMITTED_PROFILE_ID,
    availability: "unavailable",
    providerId: ADMITTED_PROVIDER_ID,
    diagnostic: routes.length === 0 ? "profile_unavailable" : "route_unavailable",
    operatorAction: routes.length === 0 ? "Configure an admitted managed-agent profile." : "Configure exactly one admitted managed-agent route for this profile.",
  }];
}
