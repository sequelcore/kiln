import { createHmac, randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  defineDeliberationLevelId,
  isDirectProviderId,
  type ModelGatewayConfig,
  type ExecutionCatalog,
  type AdmittedExecutionRoute,
  type ProviderModelRouteIdentity,
  type OperatorExecutionIntent,
} from "@kilnai/core";
import type {
  OpenAIResponsesIngressConfig,
  OpenAIResponsesTrustedPrincipal,
} from "../gateway/openai-responses-routes.js";
import type { AnthropicMessagesIngressConfig, AnthropicMessagesTrustedPrincipal } from "./anthropic-messages-routes.js";
import { LocalModelGatewayStore } from "./local-model-gateway-store.js";
import type { ExecutionAccountCapacityAuthority } from "../execution-kernel/execution-account-capacity-authority.js";
import { admitOperatorExecutionIntent } from "@kilnai/core";
import type {
  GovernedOneRoundCandidate,
  GovernedOneRoundDispatcherResolver,
  GovernedOneRoundInvocationPorts,
} from "../execution-kernel/governed-one-round-invocation.js";

export interface ModelGatewayExecutionRoutingPort {
  admit(intent: OperatorExecutionIntent): AdmittedExecutionRoute;
}

export interface ModelGatewayExecutionCandidatePort {
  resolve(input: {
    readonly admission: AdmittedExecutionRoute;
    /** Protocol-neutral route identity used by the shared lease authority. */
    readonly route: ProviderModelRouteIdentity & { readonly routeId: string };
  }): Promise<readonly GovernedOneRoundCandidate[]>;
}

/** Small composition adapter for the canonical Core admission function. */
export function createModelGatewayExecutionRoutingPort(catalog: ExecutionCatalog): ModelGatewayExecutionRoutingPort {
  return { admit: (intent) => admitOperatorExecutionIntent(catalog, intent) };
}

export interface ModelGatewayIngressOptions {
  readonly config: ModelGatewayConfig;
  /** Canonical accounts, policies, routes, and economics owned by composition. */
  readonly executionCatalog: ExecutionCatalog;
  /** Canonical route admission service owned by composition. */
  readonly executionRouting: ModelGatewayExecutionRoutingPort;
  /** Canonical candidate evidence and lease bindings owned by composition. */
  readonly executionCandidates: ModelGatewayExecutionCandidatePort;
  /** Post-fence provider dispatch owned by Runtime composition. */
  readonly executionDispatcher: GovernedOneRoundDispatcherResolver;
  /** Shared account-capacity authority; ingress does not create or close it. */
  readonly accountCapacityAuthority: ExecutionAccountCapacityAuthority;
  readonly databasePath: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}
export interface ModelGatewayIngressHandle {
  readonly openAIResponses?: OpenAIResponsesIngressConfig;
  readonly anthropicMessages?: AnthropicMessagesIngressConfig;
  readonly store: LocalModelGatewayStore;
  readonly accountCapacityAuthority: ExecutionAccountCapacityAuthority;
  close(): void;
}

export async function createModelGatewayIngress(
  options: ModelGatewayIngressOptions,
): Promise<ModelGatewayIngressHandle> {
  const env = options.env ?? process.env;
  const responsesSurface = options.config.surfaces.openAIResponses;
  const anthropicSurface = options.config.surfaces.anthropicMessages;
  if (!responsesSurface && !anthropicSurface) throw new Error("At least one model gateway surface must be configured.");
  const replaySecret = requireSecret(env, options.config.replay.hmacKeyEnv, "replay HMAC key");
  const principals = options.config.principals.map((config) => ({
    config,
    token: requireSecret(env, config.tokenEnv, "model gateway authentication token"),
  }));
  const principalIdentities = new Set(
    principals.map(({ config }) =>
      lengthPrefixed([config.ingress, config.tenantId, config.applicationId, config.callerId]),
    ),
  );
  if (principalIdentities.size !== principals.length)
    throw new Error("Model gateway trusted principal identities must be unique within each ingress.");
  const tokenDigests = new Set(principals.map(({ token }) => digest(token).toString("hex")));
  if (tokenDigests.size !== principals.length)
    throw new Error("Model gateway authentication token values must be globally unique.");
  if (options.databasePath !== ":memory:") {
    const stateDirectory = dirname(options.databasePath);
    const created = await mkdir(stateDirectory, {
      recursive: true,
      mode: 0o700,
    });
    if (created !== undefined && process.platform !== "win32") await chmod(stateDirectory, 0o700);
  }
  const store = new LocalModelGatewayStore({
    path: options.databasePath,
    replaySecret,
    replayTtlMs: options.config.replay.ttlMs,
    replayMaxEntries: options.config.replay.maxEntries,
  });
  try {
    if (options.databasePath !== ":memory:" && process.platform !== "win32") await chmod(options.databasePath, 0o600);
  } catch (error) {
    store.close();
    throw error;
  }
  const routes = new Map(
    options.config.virtualModels.map((model) => {
      const canonicalRoute = options.executionCatalog.routes.find(({ id }) => id === model.executionRouteId);
      if (!canonicalRoute) throw new Error(`Virtual model '${model.id}' references unknown execution route '${model.executionRouteId}'.`);
      const admission = options.executionRouting.admit({ routeId: model.executionRouteId });
      if (
        admission.routeId !== canonicalRoute.id
        || admission.providerId !== canonicalRoute.providerId
        || admission.providerModelId !== canonicalRoute.providerModelId
      ) throw new Error(`Execution admission for virtual model '${model.id}' does not match its canonical route.`);
      if (!isDirectProviderId(admission.providerId)) throw new Error(`Execution route '${admission.routeId}' is not available to the model gateway.`);
      return [
        model.id,
        {
          model,
          admission,
          route: {
            routeId: admission.routeId,
            providerId: admission.providerId,
            providerModelId: admission.providerModelId,
            scope: `virtual:${model.id}`,
          },
        },
      ] as const;
    }),
  );
  const candidateCatalog: GovernedOneRoundInvocationPorts["candidateCatalog"] = {
    list: async ({ route }) => {
      if (store.isRouteCooling(route))
        return { admission: findAdmission(route), candidates: [] };
      const admitted = [...routes.values()].find(
        (entry) =>
          entry.route.routeId === route.routeId &&
          entry.route.providerId === route.providerId &&
          entry.route.providerModelId === route.providerModelId &&
          entry.route.scope === route.scope,
      );
      if (!admitted) return { admission: findAdmission(route), candidates: [] };
      const candidates = await options.executionCandidates.resolve({ admission: admitted.admission, route });
      return {
        admission: admitted.admission,
        candidates: candidates as readonly GovernedOneRoundCandidate[],
      };
    },
  };
  function findAdmission(route: { readonly routeId: string; readonly providerId: string; readonly providerModelId: string; readonly scope: string }): AdmittedExecutionRoute {
    const admitted = [...routes.values()].find(
      (entry) =>
        entry.route.routeId === route.routeId
        && entry.route.providerId === route.providerId
        && entry.route.providerModelId === route.providerModelId
        && entry.route.scope === route.scope,
    );
    if (!admitted) throw new Error("The requested provider route is unavailable.");
    return admitted.admission;
  }
  const dispatcherResolver: GovernedOneRoundInvocationPorts["dispatcherResolver"] = {
    resolve: async (input) => {
      const { route, accountId } = input;
      const admittedModel = [...routes.values()].find(
        (entry) =>
          entry.route.routeId === input.routeId &&
          entry.route.providerId === route.providerId &&
          entry.route.providerModelId === route.providerModelId &&
          entry.route.scope === route.scope,
      );
      if (!admittedModel) throw new Error("Selected provider route is unavailable.");
      const canonicalAccount = options.executionCatalog.accounts.find(({ id }) => id === accountId);
      if (!canonicalAccount || canonicalAccount.providerId !== route.providerId) throw new Error("Selected execution account is unavailable.");
      const dispatcher = await options.executionDispatcher.resolve(input);
      return {
        dispatchOneRound: async (input) => {
          try {
            const result = await dispatcher.dispatchOneRound(input);
            return result;
          } catch (error) {
            const status = providerStatus(error);
            try {
              if (singleAccountRoute(admittedModel.admission) && status === 429)
                store.coolRoute(route, Date.now() + 60_000, "rate-limited");
              else if (singleAccountRoute(admittedModel.admission) && [408, 425, 500, 502, 503, 504].includes(status ?? 0))
                store.coolRoute(route, Date.now() + 30_000, "upstream-transient");
            } catch (circuitError) {
              throw new AggregateError(
                [error, circuitError],
                "Provider failure could not be fenced by the route circuit.",
              );
            }
            throw error;
          }
        },
      };
    },
  };
  const invocationPorts: GovernedOneRoundInvocationPorts = {
    candidateCatalog,
    accountCapacityAuthority: options.accountCapacityAuthority,
    attemptEvidence: store,
    dispatcherResolver,
  };

  const openAIResponses: OpenAIResponsesIngressConfig | undefined =
    responsesSurface === undefined
      ? undefined
      : {
          authenticateBearer: async (token) => {
            const presented = digest(token);
            let matched: OpenAIResponsesTrustedPrincipal | undefined;
            for (const principal of principals.filter(({ config }) => config.ingress === "openai-responses"))
              if (timingSafeEqual(presented, digest(principal.token))) matched = trustedPrincipal(principal.config);
            return matched;
          },
          resolveVirtualModel: async ({ principal, requestedModel }) =>
            resolveModel("openai-responses", principal, requestedModel),
          namespaceCorrelation: async ({ principal, observed }) =>
            namespaceCorrelation(replaySecret, "openai-responses", principal, observed),
          compatibilityEvidence: store.compatibilityEvidence,
          invocationPorts,
          createAttemptId: randomUUID,
          createResponseId: () => `resp_${randomUUID().replaceAll("-", "")}`,
          replayGuard: store,
          maxBodyBytes: responsesSurface.maxBodyBytes,
          maxConcurrentRequests: responsesSurface.maxConcurrentRequests,
        };
  const anthropicMessages: AnthropicMessagesIngressConfig | undefined =
    anthropicSurface === undefined
      ? undefined
      : {
          authenticate: async (token) => {
            const presented = digest(token);
            let matched: AnthropicMessagesTrustedPrincipal | undefined;
            for (const principal of principals.filter(({ config }) => config.ingress === "anthropic-messages"))
              if (timingSafeEqual(presented, digest(principal.token))) matched = trustedPrincipal(principal.config);
            return matched;
          },
          resolveVirtualModel: async ({ principal, requestedModel }) => {
            const resolved = await resolveModel("anthropic-messages", principal, requestedModel);
            if (!resolved) return undefined;
            const supported: ReadonlySet<string> = new Set([
              "text",
              "input-image-url",
              "input-image-base64",
              "function-tools",
              "parallel-tool-calls",
              "reasoning-controls",
            ]);
            return {
              ...resolved,
              capabilities: new Set(
                [...resolved.capabilities].filter(
                  (
                    capability,
                  ): capability is
                    | "text"
                    | "input-image-url"
                    | "input-image-base64"
                    | "function-tools"
                    | "parallel-tool-calls"
                    | "reasoning-controls" => supported.has(capability),
                ),
              ),
            };
          },
          listVirtualModels: async ({ principal }) => {
            const admitted = findPrincipal("anthropic-messages", principal);
            if (!admitted) return [];
            return admitted.config.virtualModelIds.flatMap((id) => {
              const found = routes.get(id)?.model;
              return found
                ? [
                    {
                      id: found.id,
                      ...(found.displayName === undefined ? {} : { displayName: found.displayName }),
                    },
                  ]
                : [];
            });
          },
          namespaceCorrelation: async ({ principal, observed }) =>
            namespaceCorrelation(replaySecret, "anthropic-messages", principal, {
              sessionId: observed.sessionId,
              turnId: lengthPrefixed([observed.rawBodyDigest, observed.agentId ?? "", observed.parentAgentId ?? ""]),
              rawBodyDigest: observed.rawBodyDigest,
            }),
          compatibilityEvidence: store.compatibilityEvidence,
          invocationPorts,
          createAttemptId: randomUUID,
          createMessageId: () => `msg_${randomUUID().replaceAll("-", "")}`,
          replayGuard: store,
          maxBodyBytes: anthropicSurface.maxBodyBytes,
          maxConcurrentRequests: anthropicSurface.maxConcurrentRequests,
        };
  return {
    ...(openAIResponses ? { openAIResponses } : {}),
    ...(anthropicMessages ? { anthropicMessages } : {}),
    store,
    accountCapacityAuthority: options.accountCapacityAuthority,
    close: () => {
      store.close();
    },
  };

  function findPrincipal(
    ingress: "openai-responses" | "anthropic-messages",
    principal: Pick<OpenAIResponsesTrustedPrincipal, "tenantId" | "applicationId" | "callerId">,
  ) {
    return principals.find(
      ({ config }) =>
        config.ingress === ingress &&
        config.tenantId === principal.tenantId &&
        config.applicationId === principal.applicationId &&
        config.callerId === principal.callerId,
    );
  }
  async function resolveModel(
    ingress: "openai-responses" | "anthropic-messages",
    principal: Pick<OpenAIResponsesTrustedPrincipal, "tenantId" | "applicationId" | "callerId">,
    requestedModel: string,
  ) {
    const admitted = findPrincipal(ingress, principal);
    if (!admitted?.config.virtualModelIds.includes(requestedModel)) return undefined;
    const found = routes.get(requestedModel);
    if (!found) return undefined;
    const configured = found.model.affinity;
    const affinity =
      configured.continuity === "none"
        ? { continuity: "none" as const }
        : {
            continuity: configured.continuity,
            scope: configured.scope!,
            ...(configured.allowRebind === undefined ? {} : { allowRebind: configured.allowRebind }),
          };
    const deliberation = found.model.deliberation
      ? {
          provider: found.admission.providerId,
          model: found.admission.providerModelId,
          levels: found.model.deliberation.levels.map((id) => ({
            id: defineDeliberationLevelId(id),
          })),
          ...(found.model.deliberation.defaultLevel
            ? {
                defaultLevel: defineDeliberationLevelId(found.model.deliberation.defaultLevel),
              }
            : {}),
          supportsAdaptive: found.model.deliberation.supportsAdaptive,
          evidence: {
            sourceIdentity: `model-gateway:${found.model.id}`,
            sourceRevision: found.model.deliberation.evidenceRevision,
            observedAt: new Date().toISOString(),
          },
        }
      : undefined;
    return {
      route: found.route,
      admission: found.admission,
      capabilities: new Set(found.model.capabilities),
      ...(deliberation ? { deliberation } : {}),
      affinity,
    };
  }

}

function singleAccountRoute(admission: AdmittedExecutionRoute): boolean {
  return admission.accountSelection.mode === "exact"
    || admission.accountSelection.eligibleAccountIds.length === 1;
}

function providerStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as { readonly status?: unknown }).status;
  return typeof value === "number" ? value : undefined;
}

function requireSecret(env: Readonly<Record<string, string | undefined>>, name: string, label: string): string {
  const value = env[name];
  if (!value || Buffer.byteLength(value, "utf8") < 32)
    throw new Error(`${label} environment value must contain at least 32 bytes.`);
  return value;
}
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
function trustedPrincipal(config: ModelGatewayConfig["principals"][number]): OpenAIResponsesTrustedPrincipal {
  return {
    tenantId: config.tenantId,
    applicationId: config.applicationId,
    callerId: config.callerId,
    capabilityId: config.capabilityId,
    scopes: config.scopes,
    budgetEvidence: { status: "admitted", evidenceId: config.budgetEvidenceId },
  };
}
function lengthPrefixed(values: readonly string[]): string {
  return values.map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`).join(";");
}
function namespaceCorrelation(
  secret: string,
  ingress: "openai-responses" | "anthropic-messages",
  principal: OpenAIResponsesTrustedPrincipal | AnthropicMessagesTrustedPrincipal,
  observed: {
    readonly sessionId?: string;
    readonly threadId?: string;
    readonly turnId?: string;
    readonly rawBodyDigest: string;
  },
): { sessionId: string; turnId: string } {
  const session = observed.sessionId ?? observed.threadId;
  if (!session) throw new Error("A native session or thread correlation is required.");
  const turn = observed.turnId ?? observed.rawBodyDigest;
  const namespaced = (kind: string, value: string) => {
    const h = createHmac("sha256", secret);
    for (const field of [
      "kiln-correlation-v1",
      ingress,
      principal.tenantId,
      principal.applicationId,
      principal.callerId,
      kind,
      value,
    ]) {
      const bytes = Buffer.from(field, "utf8");
      h.update(`${bytes.byteLength}:`);
      h.update(bytes);
      h.update(";");
    }
    return h.digest("hex");
  };
  return {
    sessionId: `ns:${namespaced("session", session)}`,
    turnId: `ns:${namespaced("turn", turn)}`,
  };
}
