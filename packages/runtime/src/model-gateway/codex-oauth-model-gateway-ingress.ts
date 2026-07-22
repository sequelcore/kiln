import { createHmac, randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createAccountRef, type ModelGatewayAccountCandidate, type ModelGatewayAccountConfig, type ModelGatewayConfig } from "@kilnai/core";
import { CodexOAuthCredentialPoolService } from "../agents/credential-pool/codex-oauth-credential-pool.js";
import type { OpenAIResponsesIngressConfig, OpenAIResponsesTrustedPrincipal } from "../gateway/openai-responses-routes.js";
import type { AnthropicMessagesIngressConfig, AnthropicMessagesTrustedPrincipal } from "./anthropic-messages-routes.js";
import { CodexOAuthModelTurnDispatcher, CodexOAuthModelTurnError } from "./codex-oauth-model-turn-dispatcher.js";
import { LocalModelGatewayStore } from "./local-model-gateway-store.js";
import type { GovernedOneRoundInvocationPorts } from "./governed-one-round-invocation.js";

export interface CodexOAuthModelGatewayIngressOptions {
  readonly config: ModelGatewayConfig;
  readonly databasePath: string;
  readonly credentialRootDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
}
export interface CodexOAuthModelGatewayIngressHandle {
  readonly openAIResponses?: OpenAIResponsesIngressConfig;
  readonly anthropicMessages?: AnthropicMessagesIngressConfig;
  readonly store: LocalModelGatewayStore;
  close(): void;
}

export async function createCodexOAuthModelGatewayIngress(options: CodexOAuthModelGatewayIngressOptions): Promise<CodexOAuthModelGatewayIngressHandle> {
  const env = options.env ?? process.env;
  const responsesSurface = options.config.surfaces.openAIResponses;
  const anthropicSurface = options.config.surfaces.anthropicMessages;
  if (!responsesSurface && !anthropicSurface) throw new Error("At least one model gateway surface must be configured.");
  if (options.config.virtualModels.some((model) => model.providerId === "codex-oauth" && model.accountIds.length !== 1)) throw new Error("Codex OAuth virtual models must reference exactly one account.");
  const replaySecret = requireSecret(env, options.config.replay.hmacKeyEnv, "replay HMAC key");
  const principals = options.config.principals.map((config) => ({ config, token: requireSecret(env, config.tokenEnv, "model gateway authentication token") }));
  const tokenDigests = new Set(principals.map(({ token }) => digest(token).toString("hex")));
  if (tokenDigests.size !== principals.length) throw new Error("Model gateway authentication token values must be globally unique.");
  const pool = new CodexOAuthCredentialPoolService({ rootDir: options.credentialRootDir });
  if (options.databasePath !== ":memory:") {
    const stateDirectory = dirname(options.databasePath);
    const created = await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    if (created !== undefined && process.platform !== "win32") await chmod(stateDirectory, 0o700);
  }
  const store = new LocalModelGatewayStore({ path: options.databasePath, replaySecret, replayTtlMs: options.config.replay.ttlMs, replayMaxEntries: options.config.replay.maxEntries, accounts: [] });
  try {
    if (options.databasePath !== ":memory:" && process.platform !== "win32") await chmod(options.databasePath, 0o600);
  } catch (error) {
    store.close();
    throw error;
  }
  const accounts = new Map(options.config.accounts.map((account) => [account.id, account]));
  const routes = new Map(options.config.virtualModels.map((model) => [model.id, { model, route: { providerId: model.providerId, providerModelId: model.providerModelId, scope: `virtual:${model.id}` } }]));
  const executionByRef = new Map<string, { config: ModelGatewayAccountConfig; fileIdentity: string }>();

  const candidateCatalog: GovernedOneRoundInvocationPorts["candidateCatalog"] = { list: async ({ route }) => {
    if (store.isRouteCooling(route)) return [];
    const model = [...routes.values()].find((entry) => entry.route.providerId === route.providerId && entry.route.providerModelId === route.providerModelId && entry.route.scope === route.scope)?.model;
    if (!model) return [];
    const execution = await pool.listExecutionAccounts(); const candidates: ModelGatewayAccountCandidate[] = [];
    executionByRef.clear();
    for (const config of accounts.values()) {
      const current = execution.find((entry) => entry.credentialId === config.credentialId); if (!current) continue;
      executionByRef.set(createAccountRef(`configured:${config.id}:${current.fileIdentity}`), { config, fileIdentity: current.fileIdentity });
    }
    for (const accountId of model.accountIds) {
      const config = accounts.get(accountId)!; const current = execution.find((entry) => entry.credentialId === config.credentialId); if (!current) continue;
      const accountRef = createAccountRef(`configured:${config.id}:${current.fileIdentity}`);
      store.configureAccount({ accountRef, maxConcurrency: config.maxConcurrency, reservedAffinitySlots: config.reservedAffinitySlots });
      candidates.push({ account: accountRef, route, health: "healthy", pressure: store.pressure(accountRef), reservedForNewWork: store.isNewWorkReserved(accountRef) });
    }
    return candidates;
  } };
  const dispatcherResolver: GovernedOneRoundInvocationPorts["dispatcherResolver"] = { resolve: async ({ identity, route, account, leaseId }) => {
    if (!store.verifyLease({ leaseId, accountRef: account, identity, route })) throw new Error("Selected account lease is invalid.");
    const expected = executionByRef.get(account); if (!expected) throw new Error("Selected execution account is unavailable.");
    const current = (await pool.listExecutionAccounts()).find((entry) => entry.credentialId === expected.config.credentialId && entry.fileIdentity === expected.fileIdentity);
    if (!current) throw new Error("Selected credential identity changed.");
    const credential = await pool.resolveExecutionCredential(current);
    const dispatcher = new CodexOAuthModelTurnDispatcher({ account, credential, fetch: options.fetch ?? fetch });
    return { dispatchOneRound: async (input) => { try { const result = await dispatcher.dispatchOneRound(input); void pool.recordProviderOutcome(expected.config.credentialId).catch(() => {}); return result; } catch (error) { if (error instanceof CodexOAuthModelTurnError) { try { if (error.status === 429) store.coolRoute(route, Date.now() + 60_000, "rate-limited"); else if ([408, 425, 500, 502, 503, 504].includes(error.status ?? 0)) store.coolRoute(route, Date.now() + 30_000, "upstream-transient"); } catch (circuitError) { throw new AggregateError([error, circuitError], "Provider failure could not be fenced by the route circuit."); } await pool.recordProviderOutcome(expected.config.credentialId, error).catch(() => {}); } throw error; } } };
  } };
  const invocationPorts: GovernedOneRoundInvocationPorts = { candidateCatalog, affinityStore: store, accountLease: store, attemptEvidence: store, dispatcherResolver };

  const openAIResponses: OpenAIResponsesIngressConfig | undefined = responsesSurface === undefined ? undefined : {
    authenticateBearer: async (token) => {
      const presented = digest(token); let matched: OpenAIResponsesTrustedPrincipal | undefined;
      for (const principal of principals.filter(({ config }) => config.ingress === "openai-responses")) if (timingSafeEqual(presented, digest(principal.token))) matched = trustedPrincipal(principal.config);
      return matched;
    },
    resolveVirtualModel: async ({ principal, requestedModel }) => resolveModel("openai-responses", principal, requestedModel),
    namespaceCorrelation: async ({ principal, observed }) => namespaceCorrelation(replaySecret, "openai-responses", principal, observed),
    compatibilityEvidence: store.compatibilityEvidence,
    invocationPorts,
    createAttemptId: randomUUID,
    createResponseId: () => `resp_${randomUUID().replaceAll("-", "")}`,
    replayGuard: store,
    maxBodyBytes: responsesSurface.maxBodyBytes,
    maxConcurrentRequests: responsesSurface.maxConcurrentRequests,
  };
  const anthropicMessages: AnthropicMessagesIngressConfig | undefined = anthropicSurface === undefined ? undefined : {
    authenticate: async (token) => {
      const presented = digest(token); let matched: AnthropicMessagesTrustedPrincipal | undefined;
      for (const principal of principals.filter(({ config }) => config.ingress === "anthropic-messages")) if (timingSafeEqual(presented, digest(principal.token))) matched = trustedPrincipal(principal.config);
      return matched;
    },
    resolveVirtualModel: async ({ principal, requestedModel }) => {
      const resolved = await resolveModel("anthropic-messages", principal, requestedModel);
      if (!resolved) return undefined;
      const supported: ReadonlySet<string> = new Set(["text", "input-image-url", "input-image-base64", "function-tools", "parallel-tool-calls"]);
      return { ...resolved, capabilities: new Set([...resolved.capabilities].filter((capability): capability is "text" | "input-image-url" | "input-image-base64" | "function-tools" | "parallel-tool-calls" => supported.has(capability))) };
    },
    listVirtualModels: async ({ principal }) => {
      const admitted = findPrincipal("anthropic-messages", principal);
      if (!admitted) return [];
      return admitted.config.virtualModelIds.flatMap((id) => { const found = routes.get(id)?.model; return found ? [{ id: found.id, ...(found.displayName === undefined ? {} : { displayName: found.displayName }) }] : []; });
    },
    namespaceCorrelation: async ({ principal, observed }) => namespaceCorrelation(replaySecret, "anthropic-messages", principal, {
      sessionId: observed.sessionId,
      turnId: lengthPrefixed([observed.rawBodyDigest, observed.agentId ?? "", observed.parentAgentId ?? ""]),
      rawBodyDigest: observed.rawBodyDigest,
    }),
    compatibilityEvidence: store.compatibilityEvidence, invocationPorts, createAttemptId: randomUUID,
    createMessageId: () => `msg_${randomUUID().replaceAll("-", "")}`, replayGuard: store,
    maxBodyBytes: anthropicSurface.maxBodyBytes, maxConcurrentRequests: anthropicSurface.maxConcurrentRequests,
  };
  return { ...(openAIResponses ? { openAIResponses } : {}), ...(anthropicMessages ? { anthropicMessages } : {}), store, close: () => store.close() };

  function findPrincipal(ingress: "openai-responses" | "anthropic-messages", principal: Pick<OpenAIResponsesTrustedPrincipal, "tenantId" | "applicationId" | "callerId">) {
    return principals.find(({ config }) => config.ingress === ingress && config.tenantId === principal.tenantId && config.applicationId === principal.applicationId && config.callerId === principal.callerId);
  }
  async function resolveModel(ingress: "openai-responses" | "anthropic-messages", principal: Pick<OpenAIResponsesTrustedPrincipal, "tenantId" | "applicationId" | "callerId">, requestedModel: string) {
    const admitted = findPrincipal(ingress, principal); if (!admitted?.config.virtualModelIds.includes(requestedModel)) return undefined;
    const found = routes.get(requestedModel); if (!found) return undefined; const configured = found.model.affinity;
    const affinity = configured.continuity === "none" ? { continuity: "none" as const } : { continuity: configured.continuity, scope: configured.scope!, ...(configured.allowRebind === undefined ? {} : { allowRebind: configured.allowRebind }) };
    return { route: found.route, capabilities: new Set(found.model.capabilities), affinity };
  }
}

function requireSecret(env: Readonly<Record<string, string | undefined>>, name: string, label: string): string { const value = env[name]; if (!value || Buffer.byteLength(value, "utf8") < 32) throw new Error(`${label} environment value must contain at least 32 bytes.`); return value; }
function digest(value: string): Buffer { return createHash("sha256").update(value, "utf8").digest(); }
function trustedPrincipal(config: ModelGatewayConfig["principals"][number]): OpenAIResponsesTrustedPrincipal {
  return { tenantId: config.tenantId, applicationId: config.applicationId, callerId: config.callerId, capabilityId: config.capabilityId, scopes: config.scopes, budgetEvidence: { status: "admitted", evidenceId: config.budgetEvidenceId } };
}
function lengthPrefixed(values: readonly string[]): string { return values.map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`).join(";"); }
function namespaceCorrelation(secret: string, ingress: "openai-responses" | "anthropic-messages", principal: OpenAIResponsesTrustedPrincipal | AnthropicMessagesTrustedPrincipal, observed: { readonly sessionId?: string; readonly threadId?: string; readonly turnId?: string; readonly rawBodyDigest: string }): { sessionId: string; turnId: string } {
  const session = observed.sessionId ?? observed.threadId; if (!session) throw new Error("A native session or thread correlation is required.");
  const turn = observed.turnId ?? observed.rawBodyDigest;
  const namespaced = (kind: string, value: string) => { const h = createHmac("sha256", secret); for (const field of ["kiln-correlation-v1", ingress, principal.tenantId, principal.applicationId, principal.callerId, kind, value]) { const bytes = Buffer.from(field, "utf8"); h.update(`${bytes.byteLength}:`); h.update(bytes); h.update(";"); } return h.digest("hex"); };
  return { sessionId: `ns:${namespaced("session", session)}`, turnId: `ns:${namespaced("turn", turn)}` };
}
