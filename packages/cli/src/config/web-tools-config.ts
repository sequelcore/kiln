import {
  DOCUMENTATION_DOMAINS,
  governedMemoryAuthority,
  MEMORY_LAYER_KINDS,
  PACKAGE_MANAGER_DOMAINS,
  SandboxPolicy,
  SqliteMemoryRepository,
  MemoryMutationService,
  WebSearchProviderError,
  type MemoryAuthorityCaller,
  type MemoryAuthorityPolicy,
  type DefaultBuiltinToolRegistryOptions,
  type NetPolicy,
  type SandboxConfig,
  type WebExtractProvider,
  type WebExtractProviderResponse,
  type WebExtractPage,
  type WebExtractFormat,
  type WebSearchProvider,
  type WebSearchProviderResponse,
  type WebSearchProviderCapabilities,
  type WebSearchProviderRegistration,
  type WebSourceMetadata,
  type MemoryScope,
} from "@kilnai/core";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { KilnAppConfig } from "../config.js";
import { loadKilnConfig } from "./config-merger.js";
import { KilnYamlError } from "../kiln-yaml.js";
import {
  convertEffectiveMemoryPermissionPolicyToMemoryAuthorityPolicy,
  resolveEffectivePermissionPolicy,
} from "../wrapper/permission-evaluator.js";
import type { KilnPermissionPolicy } from "../wrapper/session.js";
import type {
  ResolvedKilnConfig,
  KilnYamlWebConfig,
  KilnYamlWebExtractProvider,
  KilnYamlWebNetPolicy,
  KilnYamlWebSearchProvider,
} from "../kiln-yaml-types.js";
import type { KilnGlobalWebConfig } from "./global-config.js";
import type { KilnProjectConfig } from "./project-config-schema.js";
import {
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "../application/private-project-state-filesystem.js";
import { resolveProjectStateBinding } from "../application/project-state-root.js";
import { resolveCliMemoryStorage } from "../application/cli-memory-storage.js";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SurfaceMemoryRepository = NonNullable<DefaultBuiltinToolRegistryOptions["memoryResources"]>["repository"];

export interface WebToolSurfaceMemoryAuthorityInput {
  readonly modelFacingSession?: boolean;
  readonly permissionPolicy?: KilnPermissionPolicy;
  readonly permissionAgent?: string;
  readonly caller?: MemoryAuthorityCaller;
  readonly policy?: MemoryAuthorityPolicy;
}

export interface WebToolSurfaceOptionsInput {
  readonly config?: ResolvedKilnConfig | null;
  readonly projectPath: string;
  readonly fetchImpl?: FetchLike;
  readonly memoryAuthority?: WebToolSurfaceMemoryAuthorityInput;
}

export interface LoadConfiguredWebToolSurfaceOptionsInput {
  readonly memoryAuthority?: WebToolSurfaceMemoryAuthorityInput;
}

const VALID_NET_POLICIES: readonly KilnYamlWebNetPolicy[] = [
  "none",
  "documentation",
  "package-managers",
  "full",
];
const VALID_SEARCH_PROVIDER_TYPES = ["none", "http", "searxng", "brave", "tavily", "exa"] as const;
const VALID_EXTRACT_PROVIDER_TYPES = ["none", "http", "tavily", "firecrawl"] as const;
const DEFAULT_BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const DEFAULT_EXA_SEARCH_URL = "https://api.exa.ai/search";
const DEFAULT_TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
const DEFAULT_FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const API_KEY_SEARCH_PROVIDER_TYPES = ["brave", "tavily", "exa"] as const;
const API_KEY_EXTRACT_PROVIDER_TYPES = ["tavily", "firecrawl"] as const;

export interface WebToolConfigurationDiagnostics {
  readonly enabled: boolean;
  readonly netPolicy: KilnYamlWebNetPolicy;
  readonly allowedDomains: readonly string[];
  readonly searchProviderType: string;
  readonly searchProviderConfigured: boolean;
  readonly searchProviderSource: WebToolConfigurationSource;
  readonly searchFallbackProviderTypes: readonly string[];
  readonly searchFallbackProvidersConfigured: boolean;
  readonly searchFallbackProviderSource: WebToolConfigurationSource;
  readonly extractProviderType: string;
  readonly extractProviderConfigured: boolean;
  readonly extractProviderSource: WebToolConfigurationSource;
  readonly issues: readonly string[];
}

export type WebToolConfigurationSource = "none" | "effective" | "global" | "project";

class WebProviderUnavailableError extends KilnYamlError {
  constructor(
    message: string,
    readonly issue: string,
  ) {
    super(message);
  }
}

export interface WebToolConfigurationSourceInput {
  readonly globalWeb?: KilnGlobalWebConfig | null;
  readonly projectWeb?: KilnProjectConfig["web"] | null;
}

export async function loadConfiguredWebToolSurfaceOptions(
  appConfig: KilnAppConfig,
  projectPath: string,
  options: LoadConfiguredWebToolSurfaceOptionsInput = {},
): Promise<DefaultBuiltinToolRegistryOptions> {
  const config = appConfig.kilnYaml ?? await loadKilnConfig(projectPath);
  return createWebToolSurfaceOptions({ config, projectPath, memoryAuthority: options.memoryAuthority });
}

export function createWebToolSurfaceOptions(
  input: WebToolSurfaceOptionsInput,
): DefaultBuiltinToolRegistryOptions {
  const webConfig = input.config?.web;
  const workspaceResources = { rootPath: input.projectPath };
  const memoryAuthority = resolveMemoryAuthorityPolicy(input);
  const memoryResources = createProjectMemoryResources(input.projectPath, memoryAuthority);
  const memoryMutations = createMemoryMutationOptions(memoryResources?.repository, memoryAuthority, input.memoryAuthority?.caller);
  if (webConfig?.enabled !== true) {
    return {
      workspaceResources,
      ...(memoryResources ? { memoryResources } : {}),
      ...(memoryMutations ? { memoryMutations } : {}),
    };
  }

  const networkPolicy = createWebNetworkPolicy(webConfig, input.projectPath);
  const searchProviders = createConfiguredWebSearchProviders(
    webConfig.searchProvider,
    webConfig.searchFallbackProviders,
    input.fetchImpl,
  );
  const extractProvider = createOptionalConfiguredWebExtractProvider(webConfig.extractProvider, input.fetchImpl);

  return {
    workspaceResources,
    ...(memoryResources ? { memoryResources } : {}),
    ...(memoryMutations ? { memoryMutations } : {}),
    webFetch: { networkPolicy },
    webExtract: {
      networkPolicy,
      ...(extractProvider ? { extractProvider } : {}),
    },
    webSearch: {
      networkPolicy,
      ...(searchProviders.length > 0 ? { searchProviders } : {}),
    },
  };
}

export function describeWebToolConfiguration(
  config: ResolvedKilnConfig | null | undefined,
  sources: WebToolConfigurationSourceInput = {},
): WebToolConfigurationDiagnostics {
  const webConfig = config?.web;
  const enabled = webConfig?.enabled === true;
  const netPolicy = webConfig?.netPolicy ?? "none";
  const issues: string[] = [];
  let allowedDomains: readonly string[] = [];
  let searchProviderType = "none";
  let searchProviderConfigured = false;
  let searchFallbackProviderTypes: readonly string[] = [];
  let searchFallbackProvidersConfigured = false;
  let extractProviderType = "none";
  let extractProviderConfigured = false;

  if (!enabled) {
    issues.push("web.disabled");
  }

  if (!VALID_NET_POLICIES.includes(netPolicy)) {
    issues.push("web.net_policy_invalid");
  } else {
    allowedDomains = resolveAllowedDomains(netPolicy, webConfig?.allowedDomains);
    if (enabled && netPolicy === "none") {
      issues.push("web.network_policy_missing");
    }
  }

  const providerConfig = webConfig?.searchProvider;
  if (isRecord(providerConfig) && typeof providerConfig.type === "string") {
    searchProviderType = providerConfig.type;
  } else if (providerConfig && !isRecord(providerConfig)) {
    searchProviderType = "invalid";
  }
  const searchProviderEnvIssue = missingApiKeyEnvIssue(
    providerConfig,
    API_KEY_SEARCH_PROVIDER_TYPES,
    "web.search_provider_env_missing",
  );
  searchProviderConfigured = isSearchProviderConfigured(providerConfig) && searchProviderEnvIssue === undefined;
  const searchProviderSource = resolveProviderSource({
    effectiveProvider: providerConfig,
    globalProvider: sources.globalWeb?.searchProvider,
  });
  if (searchProviderEnvIssue) {
    issues.push(searchProviderEnvIssue);
  } else if (enabled && !searchProviderConfigured) {
    issues.push("web.search_provider_missing");
  }

  const fallbackConfigs = webConfig?.searchFallbackProviders ?? [];
  searchFallbackProviderTypes = fallbackConfigs.map((provider) =>
    isRecord(provider) && typeof provider.type === "string" ? provider.type : "invalid");
  const fallbackEnvIssues = fallbackConfigs
    .map((provider) => missingApiKeyEnvIssue(
      provider,
      API_KEY_SEARCH_PROVIDER_TYPES,
      "web.search_fallback_provider_env_missing",
    ))
    .filter((issue): issue is string => issue !== undefined);
  searchFallbackProvidersConfigured = fallbackConfigs.length > 0
    && fallbackConfigs.every(isSearchProviderConfigured)
    && fallbackEnvIssues.length === 0;
  const searchFallbackProviderSource = resolveOptionalConfigSource({
    effective: webConfig?.searchFallbackProviders,
    global: sources.globalWeb?.searchFallbackProviders,
    project: undefined,
  });
  issues.push(...new Set(fallbackEnvIssues));

  const extractProviderConfig = webConfig?.extractProvider;
  if (isRecord(extractProviderConfig) && typeof extractProviderConfig.type === "string") {
    extractProviderType = extractProviderConfig.type;
  } else if (extractProviderConfig && !isRecord(extractProviderConfig)) {
    extractProviderType = "invalid";
  }
  const extractProviderEnvIssue = missingApiKeyEnvIssue(
    extractProviderConfig,
    API_KEY_EXTRACT_PROVIDER_TYPES,
    "web.extract_provider_env_missing",
  );
  extractProviderConfigured = isExtractProviderConfigured(extractProviderConfig) && extractProviderEnvIssue === undefined;
  const extractProviderSource = resolveProviderSource({
    effectiveProvider: extractProviderConfig,
    globalProvider: sources.globalWeb?.extractProvider,
  });
  if (extractProviderEnvIssue) {
    issues.push(extractProviderEnvIssue);
  }

  return {
    enabled,
    netPolicy,
    allowedDomains,
    searchProviderType,
    searchProviderConfigured,
    searchProviderSource,
    searchFallbackProviderTypes,
    searchFallbackProvidersConfigured,
    searchFallbackProviderSource,
    extractProviderType,
    extractProviderConfigured,
    extractProviderSource,
    issues,
  };
}

function resolveOptionalConfigSource(input: {
  readonly effective: unknown;
  readonly global: unknown;
  readonly project: unknown;
}): WebToolConfigurationSource {
  if (input.project !== undefined) return "project";
  if (input.global !== undefined) return "global";
  if (input.effective !== undefined) return "effective";
  return "none";
}

function resolveProviderSource(input: {
  readonly effectiveProvider: KilnYamlWebSearchProvider | KilnYamlWebExtractProvider | undefined;
  readonly globalProvider: KilnYamlWebSearchProvider | KilnYamlWebExtractProvider | undefined;
  readonly projectProvider?: KilnYamlWebSearchProvider | KilnYamlWebExtractProvider | undefined;
}): WebToolConfigurationSource {
  if (input.projectProvider !== undefined) {
    return "project";
  }
  if (input.globalProvider !== undefined) {
    return "global";
  }
  if (input.effectiveProvider !== undefined) {
    return "effective";
  }
  return "none";
}

function createProjectMemoryResources(
  projectPath: string,
  authority: MemoryAuthorityPolicy | undefined,
): DefaultBuiltinToolRegistryOptions["memoryResources"] | undefined {
  if (!existsSync(projectPath)) {
    return undefined;
  }

  // A repository without an explicit Core authority boundary is not a
  // usable model-facing memory surface.  Omit it rather than reintroducing
  // omission-as-unrestricted behavior.
  if (!authority) {
    return undefined;
  }

  const memoryStorage = resolveCliMemoryStorage(projectPath);
  const binding = resolveProjectStateBinding(projectPath);
  ensurePrivateStateDirectorySync(binding.projectStateRoot, memoryStorage.stateDir);
  assertPrivateStateFileTargetSync(binding.projectStateRoot, memoryStorage.memoryDbPath);
  return {
    repository: new SqliteMemoryRepository({ dbPath: memoryStorage.memoryDbPath }),
    authority: governedMemoryAuthority(authority),
  };
}

function createMemoryMutationOptions(
  repository: SurfaceMemoryRepository | undefined,
  authority: MemoryAuthorityPolicy | undefined,
  caller: MemoryAuthorityCaller | undefined,
): DefaultBuiltinToolRegistryOptions["memoryMutations"] | undefined {
  if (!repository || !authority) {
    return undefined;
  }
  const callerIdentity = caller ?? { kind: "operator_surface", id: "cli" };
  return {
    callerContext: {
      actorType: callerIdentity.kind,
      actorId: callerIdentity.id,
      authority,
    },
    createService: ({ repository: resourceRepository, eventBus, callerContext }) => {
      return new MemoryMutationService({
        repository: resourceRepository ?? repository,
        eventBus,
        sessionId: callerContext.sessionId,
        tenantId: callerContext.tenantId,
        authority: governedMemoryAuthority(authority),
      });
    },
  };
}

function resolveMemoryAuthorityPolicy(input: WebToolSurfaceOptionsInput): MemoryAuthorityPolicy | undefined {
  const requested = input.memoryAuthority;
  if (requested?.policy) {
    return normalizeMemoryAuthorityPolicy(requested.policy);
  }

  const caller = requested?.caller ?? { kind: "operator_surface", id: "cli" };
  const projectScopeId = resolveProjectScopeId(input.projectPath);
  const permissionPolicy = requested?.permissionPolicy ?? (
    input.config?.permissions as KilnPermissionPolicy | undefined
  );
  const permissionAgent = requested?.permissionAgent;
  const explicit = resolveExplicitMemoryAuthority({
    permissionPolicy,
    permissionAgent,
    caller,
  });
  if (explicit) {
    return explicit;
  }

  if (requested?.modelFacingSession === true) {
    return createReadOnlyMemoryAuthority(caller, projectScopeId);
  }
  return undefined;
}

function resolveExplicitMemoryAuthority(input: {
  readonly permissionPolicy?: KilnPermissionPolicy;
  readonly permissionAgent?: string;
  readonly caller: MemoryAuthorityCaller;
}): MemoryAuthorityPolicy | undefined {
  if (!input.permissionPolicy) {
    return undefined;
  }

  if (!hasExplicitMemoryPermission(input.permissionPolicy, input.permissionAgent)) {
    return undefined;
  }

  const effective = resolveEffectivePermissionPolicy(
    input.permissionPolicy,
    input.permissionAgent,
  );
  return normalizeMemoryAuthorityPolicy(
    convertEffectiveMemoryPermissionPolicyToMemoryAuthorityPolicy(
      effective.policy,
      input.caller,
    ),
  );
}

function hasExplicitMemoryPermission(
  permissionPolicy: KilnPermissionPolicy,
  permissionAgent?: string,
): boolean {
  if (Object.prototype.hasOwnProperty.call(permissionPolicy, "memory")) {
    return true;
  }

  if (!permissionAgent || !permissionPolicy.agentScopes) {
    return false;
  }

  for (let index = permissionPolicy.agentScopes.length - 1; index >= 0; index -= 1) {
    const scope = permissionPolicy.agentScopes[index];
    if (!scope || scope.agent !== permissionAgent) {
      continue;
    }
    return Object.prototype.hasOwnProperty.call(scope, "memory");
  }
  return false;
}

function createReadOnlyMemoryAuthority(
  caller: MemoryAuthorityCaller,
  projectScopeId: string,
): MemoryAuthorityPolicy {
  return normalizeMemoryAuthorityPolicy({
    caller,
    rules: [{
      access: "read",
      operations: ["read"],
      scopeKinds: ["project"],
      scopeIds: [projectScopeId],
      layers: MEMORY_LAYER_KINDS,
    }],
  });
}

export function resolveProjectMemoryScope(projectPath: string): MemoryScope {
  return {
    kind: "project",
    id: resolveProjectScopeId(projectPath),
  };
}

function resolveProjectScopeId(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, "/").replace(/\/+$/g, "");
  const scopeId = basename(normalized);
  return scopeId.trim().length > 0 ? scopeId : normalized;
}

function normalizeMemoryAuthorityPolicy(policy: MemoryAuthorityPolicy): MemoryAuthorityPolicy {
  return {
    caller: {
      kind: policy.caller.kind.trim(),
      id: policy.caller.id.trim(),
    },
    rules: policy.rules.map((rule) => ({
      ...rule,
      operations: [...rule.operations],
      ...(rule.scopeKinds ? { scopeKinds: [...rule.scopeKinds] } : {}),
      ...(rule.scopeIds ? { scopeIds: [...rule.scopeIds] } : {}),
      ...(rule.layers ? { layers: [...rule.layers] } : {}),
    })),
  };
}

function createWebNetworkPolicy(
  webConfig: KilnYamlWebConfig,
  projectPath: string,
): SandboxPolicy {
  const netPolicy = resolveNetPolicy(webConfig.netPolicy);
  const config: SandboxConfig = {
    fsPolicy: "read-only",
    netPolicy,
    allowedPaths: [],
    deniedPaths: [],
    allowedDomains: resolveAllowedDomains(netPolicy, webConfig.allowedDomains),
  };
  return new SandboxPolicy({ config, projectPath });
}

function resolveNetPolicy(value: KilnYamlWebNetPolicy | undefined): NetPolicy {
  if (value === undefined) {
    return "none";
  }
  if (VALID_NET_POLICIES.includes(value)) {
    return value;
  }
  throw new KilnYamlError(`web.netPolicy must be one of: ${VALID_NET_POLICIES.join(", ")}`);
}

function resolveAllowedDomains(
  netPolicy: NetPolicy,
  configuredDomains: unknown,
): readonly string[] {
  if (configuredDomains === undefined) {
    return defaultDomainsForPolicy(netPolicy);
  }
  if (!Array.isArray(configuredDomains)) {
    throw new KilnYamlError("web.allowedDomains must be an array of domain strings");
  }
  return uniqueStrings(configuredDomains.map((domain) => normalizeDomain(domain)));
}

function defaultDomainsForPolicy(netPolicy: NetPolicy): readonly string[] {
  if (netPolicy === "documentation") {
    return DOCUMENTATION_DOMAINS;
  }
  if (netPolicy === "package-managers") {
    return PACKAGE_MANAGER_DOMAINS;
  }
  if (netPolicy === "full") {
    return ["*"];
  }
  return [];
}

function normalizeDomain(value: unknown): string {
  if (typeof value !== "string") {
    throw new KilnYamlError("web.allowedDomains must contain only strings");
  }
  const domain = value.trim().toLowerCase();
  if (!domain) {
    throw new KilnYamlError("web.allowedDomains must not contain empty domains");
  }
  return domain;
}

function createConfiguredWebSearchProvider(
  providerConfig: KilnYamlWebSearchProvider | undefined,
  fetchImpl: FetchLike | undefined,
): WebSearchProvider | undefined {
  if (providerConfig === undefined) {
    return undefined;
  }
  if (!isRecord(providerConfig)) {
    throw new KilnYamlError("web.searchProvider must be an object");
  }
  const type = providerConfig.type;
  if (type === undefined || type === "none") {
    return undefined;
  }
  if (type === "http") {
    return createHttpWebSearchProvider({
      url: requireConfigString(providerConfig, "url", "web.searchProvider.url must be a string"),
      headers: providerConfig.headers,
    }, fetchImpl);
  }
  if (type === "searxng") {
    return createSearxngWebSearchProvider({
      url: requireConfigString(providerConfig, "url", "web.searchProvider.url must be a string"),
      headers: providerConfig.headers,
    }, fetchImpl);
  }
  if (type === "brave") {
    return createBraveWebSearchProvider({
      url: optionalConfigString(providerConfig, "url"),
      apiKeyEnv: requireConfigString(providerConfig, "apiKeyEnv", "web.searchProvider.apiKeyEnv must be a string"),
    }, fetchImpl);
  }
  if (type === "tavily") {
    return createTavilyWebSearchProvider({
      url: optionalConfigString(providerConfig, "url"),
      apiKeyEnv: requireConfigString(providerConfig, "apiKeyEnv", "web.searchProvider.apiKeyEnv must be a string"),
    }, fetchImpl);
  }
  if (type === "exa") {
    return createExaWebSearchProvider({
      url: optionalConfigString(providerConfig, "url"),
      apiKeyEnv: requireConfigString(providerConfig, "apiKeyEnv", "web.searchProvider.apiKeyEnv must be a string"),
    }, fetchImpl);
  }
  throw new KilnYamlError(`web.searchProvider.type must be one of: ${VALID_SEARCH_PROVIDER_TYPES.join(", ")}`);
}

function createOptionalConfiguredWebSearchProvider(
  providerConfig: KilnYamlWebSearchProvider | undefined,
  fetchImpl: FetchLike | undefined,
): WebSearchProvider | undefined {
  try {
    return createConfiguredWebSearchProvider(providerConfig, fetchImpl);
  } catch (error) {
    if (error instanceof WebProviderUnavailableError) {
      return undefined;
    }
    throw error;
  }
}

function configuredSearchProviderCapabilities(
  providerConfig: KilnYamlWebSearchProvider | undefined,
): WebSearchProviderCapabilities | undefined {
  if (!isRecord(providerConfig) || typeof providerConfig.type !== "string" || providerConfig.type === "none") {
    return undefined;
  }
  const provider = providerConfig.type;
  if (provider === "tavily") {
    return {
      provider,
      recencyFilter: "enforced",
      topics: ["general", "news", "finance", "research"],
      absoluteDateRange: true,
      exactMatch: true,
      countryTargeting: true,
      countryTargetingTopics: ["general"],
      languageTargeting: false,
      highPrecisionSearch: true,
    };
  }
  if (provider === "brave") {
    return {
      provider,
      recencyFilter: "enforced",
      topics: ["general", "news", "research"],
      absoluteDateRange: true,
      exactMatch: true,
      countryTargeting: true,
      languageTargeting: true,
      highPrecisionSearch: true,
    };
  }
  if (provider === "exa") {
    return {
      provider,
      recencyFilter: "enforced",
      topics: ["general", "news", "finance", "research"],
      absoluteDateRange: true,
      exactMatch: false,
      countryTargeting: true,
      languageTargeting: false,
      highPrecisionSearch: true,
    };
  }
  return {
    provider,
    recencyFilter: "unsupported",
    topics: ["general"],
    absoluteDateRange: false,
    exactMatch: false,
    countryTargeting: false,
    languageTargeting: false,
    highPrecisionSearch: false,
  };
}

function createConfiguredWebSearchProviders(
  primary: KilnYamlWebSearchProvider | undefined,
  fallbacks: readonly KilnYamlWebSearchProvider[] | undefined,
  fetchImpl: FetchLike | undefined,
): readonly WebSearchProviderRegistration<WebSearchProvider>[] {
  const registrations: WebSearchProviderRegistration<WebSearchProvider>[] = [];
  const configs = [primary, ...(fallbacks ?? [])];
  configs.forEach((config, index) => {
    const search = createOptionalConfiguredWebSearchProvider(config, fetchImpl);
    const capabilities = configuredSearchProviderCapabilities(config);
    if (!search || !capabilities) {
      return;
    }
    registrations.push({
      id: index === 0 ? `${capabilities.provider}-primary` : `${capabilities.provider}-fallback-${index}`,
      search,
      capabilities,
    });
  });
  return registrations;
}

function createConfiguredWebExtractProvider(
  providerConfig: KilnYamlWebExtractProvider | undefined,
  fetchImpl: FetchLike | undefined,
): WebExtractProvider | undefined {
  if (providerConfig === undefined) {
    return undefined;
  }
  if (!isRecord(providerConfig)) {
    throw new KilnYamlError("web.extractProvider must be an object");
  }
  const type = providerConfig.type;
  if (type === undefined || type === "none") {
    return undefined;
  }
  if (type === "http") {
    return createHttpWebExtractProvider({
      url: requireConfigString(providerConfig, "url", "web.extractProvider.url must be a string"),
      headers: providerConfig.headers,
    }, fetchImpl);
  }
  if (type === "tavily") {
    return createTavilyWebExtractProvider({
      url: optionalConfigString(providerConfig, "url", "web.extractProvider"),
      apiKeyEnv: requireConfigString(providerConfig, "apiKeyEnv", "web.extractProvider.apiKeyEnv must be a string"),
    }, fetchImpl);
  }
  if (type === "firecrawl") {
    return createFirecrawlWebExtractProvider({
      url: optionalConfigString(providerConfig, "url", "web.extractProvider"),
      apiKeyEnv: requireConfigString(providerConfig, "apiKeyEnv", "web.extractProvider.apiKeyEnv must be a string"),
    }, fetchImpl);
  }
  throw new KilnYamlError(`web.extractProvider.type must be one of: ${VALID_EXTRACT_PROVIDER_TYPES.join(", ")}`);
}

function createOptionalConfiguredWebExtractProvider(
  providerConfig: KilnYamlWebExtractProvider | undefined,
  fetchImpl: FetchLike | undefined,
): WebExtractProvider | undefined {
  try {
    return createConfiguredWebExtractProvider(providerConfig, fetchImpl);
  } catch (error) {
    if (error instanceof WebProviderUnavailableError) {
      return undefined;
    }
    throw error;
  }
}

function createHttpWebSearchProvider(
  providerConfig: { readonly url: string; readonly headers?: unknown },
  fetchImpl: FetchLike | undefined,
): WebSearchProvider {
  const endpoint = parseProviderEndpoint(providerConfig.url);
  const fetchClient = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchClient) {
    throw new KilnYamlError("web.searchProvider.type=http requires a fetch implementation");
  }
  const headers = normalizeHeaders(providerConfig.headers);

  return async (request) => {
    const requestResult = await executeWebSearchRequest("http", () => fetchClient(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(request),
    }));
    return normalizeWebSearchExecution("http", requestResult, normalizeProviderResponse);
  };
}

function createHttpWebExtractProvider(
  providerConfig: { readonly url: string; readonly headers?: unknown },
  fetchImpl: FetchLike | undefined,
): WebExtractProvider {
  const endpoint = parseProviderEndpoint(providerConfig.url, "web.extractProvider.url");
  const fetchClient = requireFetchClient("web.extractProvider.type=http", fetchImpl);
  const headers = normalizeHeaders(providerConfig.headers, "web.extractProvider.headers");

  return async (request) => {
    const response = await fetchClient(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(`Web extract provider returned HTTP ${response.status}`);
    }
    return normalizeExtractProviderResponse(await response.json());
  };
}

function createTavilyWebExtractProvider(
  providerConfig: { readonly url?: string; readonly apiKeyEnv: string },
  fetchImpl: FetchLike | undefined,
): WebExtractProvider {
  const endpoint = parseProviderEndpoint(providerConfig.url ?? DEFAULT_TAVILY_EXTRACT_URL, "web.extractProvider.url");
  const fetchClient = requireFetchClient("web.extractProvider.type=tavily", fetchImpl);
  const apiKey = readRequiredEnv(providerConfig.apiKeyEnv, "web.extractProvider.apiKeyEnv");

  return async (request) => {
    const response = await fetchClient(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        urls: request.urls.length === 1 ? request.urls[0] : [...request.urls],
        extract_depth: "basic",
        format: request.format,
        timeout: Math.min(60, Math.max(1, Math.ceil(request.timeoutMs / 1000))),
      }),
    });
    if (!response.ok) {
      throw new Error(`Web extract provider returned HTTP ${response.status}`);
    }
    return normalizeTavilyExtractResponse(await response.json(), request.format);
  };
}

function createFirecrawlWebExtractProvider(
  providerConfig: { readonly url?: string; readonly apiKeyEnv: string },
  fetchImpl: FetchLike | undefined,
): WebExtractProvider {
  const endpoint = parseProviderEndpoint(providerConfig.url ?? DEFAULT_FIRECRAWL_SCRAPE_URL, "web.extractProvider.url");
  const fetchClient = requireFetchClient("web.extractProvider.type=firecrawl", fetchImpl);
  const apiKey = readRequiredEnv(providerConfig.apiKeyEnv, "web.extractProvider.apiKeyEnv");

  return async (request) => {
    const pages: WebExtractPage[] = [];
    for (const url of request.urls) {
      const response = await fetchClient(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          url,
          formats: [request.format === "markdown" ? "markdown" : "html"],
          onlyMainContent: true,
          timeout: request.timeoutMs,
        }),
      });
      if (!response.ok) {
        throw new Error(`Web extract provider returned HTTP ${response.status}`);
      }
      pages.push(normalizeFirecrawlExtractPage(await response.json(), url, request.format));
    }
    return {
      provider: "firecrawl",
      pages,
    };
  };
}

function createSearxngWebSearchProvider(
  providerConfig: { readonly url: string; readonly headers?: unknown },
  fetchImpl: FetchLike | undefined,
): WebSearchProvider {
  const baseUrl = parseProviderEndpoint(providerConfig.url);
  const fetchClient = requireFetchClient("web.searchProvider.type=searxng", fetchImpl);
  const headers = normalizeHeaders(providerConfig.headers);

  return async (request) => {
    const endpoint = new URL("search", ensureTrailingSlash(baseUrl));
    endpoint.searchParams.set("q", scopedQuery(request.query, request.domains, request.exactPhrases));
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("language", "all");
    endpoint.searchParams.set("safesearch", "1");
    const requestResult = await executeWebSearchRequest("searxng", () => fetchClient(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...headers,
      },
    }));
    return normalizeWebSearchExecution("searxng", requestResult, normalizeSearxngResponse);
  };
}

function createBraveWebSearchProvider(
  providerConfig: { readonly url?: string; readonly apiKeyEnv: string },
  fetchImpl: FetchLike | undefined,
): WebSearchProvider {
  const endpoint = parseProviderEndpoint(providerConfig.url ?? DEFAULT_BRAVE_SEARCH_URL);
  const fetchClient = requireFetchClient("web.searchProvider.type=brave", fetchImpl);
  const apiKey = readRequiredEnv(providerConfig.apiKeyEnv, "web.searchProvider.apiKeyEnv");

  return async (request) => {
    const url = braveSearchEndpoint(endpoint, request.topic);
    url.searchParams.set("q", scopedQuery(request.query, request.domains, request.exactPhrases));
    url.searchParams.set("count", String(request.maxResults));
    if (request.startDate || request.endDate) {
      url.searchParams.set("freshness", `${request.startDate ?? "1970-01-01"}to${request.endDate ?? currentUtcDate()}`);
    } else if (request.recencyDays !== undefined) {
      url.searchParams.set("freshness", `${request.recencyDays}d`);
    }
    if (request.country) url.searchParams.set("country", request.country.toUpperCase());
    if (request.language) url.searchParams.set("search_lang", request.language);
    if (request.quality === "high") url.searchParams.set("extra_snippets", "true");
    const requestResult = await executeWebSearchRequest("brave", () => fetchClient(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-subscription-token": apiKey,
      },
    }));
    return normalizeWebSearchExecution("brave", requestResult, normalizeBraveResponse);
  };
}

function createTavilyWebSearchProvider(
  providerConfig: { readonly url?: string; readonly apiKeyEnv: string },
  fetchImpl: FetchLike | undefined,
): WebSearchProvider {
  const endpoint = parseProviderEndpoint(providerConfig.url ?? DEFAULT_TAVILY_SEARCH_URL);
  const fetchClient = requireFetchClient("web.searchProvider.type=tavily", fetchImpl);
  const apiKey = readRequiredEnv(providerConfig.apiKeyEnv, "web.searchProvider.apiKeyEnv");

  return async (request) => {
    const body: Record<string, unknown> = {
      query: scopedQuery(request.query, [], request.exactPhrases),
      max_results: request.maxResults,
      include_answer: false,
      include_raw_content: false,
      include_usage: true,
      search_depth: request.quality === "high" ? "advanced" : "basic",
      topic: request.topic === "research" ? "general" : (request.topic ?? "general"),
    };
    if (request.domains.length > 0) {
      body.include_domains = request.domains;
    }
    if (request.startDate) body.start_date = request.startDate;
    else if (request.recencyDays !== undefined) body.start_date = relativeUtcDate(request.recencyDays);
    if (request.endDate) body.end_date = request.endDate;
    else if (request.recencyDays !== undefined) body.end_date = currentUtcDate();
    if (request.country) body.country = toEnglishCountryName(request.country);
    if ((request.exactPhrases?.length ?? 0) > 0) body.exact_match = true;
    const requestResult = await executeWebSearchRequest("tavily", () => fetchClient(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }));
    return normalizeWebSearchExecution("tavily", requestResult, normalizeTavilyResponse);
  };
}

function createExaWebSearchProvider(
  providerConfig: { readonly url?: string; readonly apiKeyEnv: string },
  fetchImpl: FetchLike | undefined,
): WebSearchProvider {
  const endpoint = parseProviderEndpoint(providerConfig.url ?? DEFAULT_EXA_SEARCH_URL);
  const fetchClient = requireFetchClient("web.searchProvider.type=exa", fetchImpl);
  const apiKey = readRequiredEnv(providerConfig.apiKeyEnv, "web.searchProvider.apiKeyEnv");

  return async (request) => {
    const startPublishedDate = request.startDate
      ? `${request.startDate}T00:00:00.000Z`
      : request.recencyDays !== undefined
        ? new Date(Date.now() - request.recencyDays * 86_400_000).toISOString()
        : undefined;
    const endPublishedDate = request.endDate ? `${request.endDate}T23:59:59.999Z` : undefined;
    const category = request.topic === "news"
      ? "news"
      : request.topic === "research"
        ? "research paper"
        : request.topic === "finance"
          ? "financial report"
          : undefined;
    const requestResult = await executeWebSearchRequest("exa", () => fetchClient(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query: scopedQuery(request.query, [], request.exactPhrases),
        type: request.quality === "high" ? "deep-lite" : "auto",
        numResults: request.maxResults,
        ...(request.domains.length > 0 ? { includeDomains: request.domains } : {}),
        ...(startPublishedDate ? { startPublishedDate } : {}),
        ...(endPublishedDate ? { endPublishedDate } : {}),
        ...(category ? { category } : {}),
        ...(request.country ? { userLocation: request.country.toUpperCase() } : {}),
        contents: { highlights: true },
      }),
    }));
    return normalizeWebSearchExecution("exa", requestResult, normalizeExaResponse);
  };
}

interface WebSearchRequestExecution {
  readonly response: Response;
  readonly requestId?: string;
  readonly durationMs: number;
}

async function executeWebSearchRequest(
  provider: string,
  execute: () => Promise<Response>,
): Promise<WebSearchRequestExecution> {
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await execute();
  } catch (error) {
    throw new WebSearchProviderError(
      error instanceof Error ? error.message : String(error),
      { provider, durationMs: elapsedMilliseconds(startedAt) },
      { cause: error },
    );
  }
  const durationMs = elapsedMilliseconds(startedAt);
  const requestId = response.headers.get("x-request-id") ?? undefined;
  if (!response.ok) {
    throw new WebSearchProviderError(
      `Web search provider returned HTTP ${response.status}`,
      { provider, durationMs, status: response.status, ...(requestId ? { requestId } : {}) },
    );
  }
  return { response, durationMs, ...(requestId ? { requestId } : {}) };
}

function withSearchTelemetry(
  response: WebSearchProviderResponse,
  execution: WebSearchRequestExecution,
): WebSearchProviderResponse {
  const requestId = response.requestId ?? execution.requestId;
  return {
    ...response,
    ...(requestId ? { requestId } : {}),
    durationMs: response.durationMs ?? execution.durationMs,
  };
}

async function normalizeWebSearchExecution(
  provider: string,
  execution: WebSearchRequestExecution,
  normalize: (value: unknown) => WebSearchProviderResponse,
): Promise<WebSearchProviderResponse> {
  try {
    return withSearchTelemetry(normalize(await execution.response.json()), execution);
  } catch (error) {
    if (error instanceof WebSearchProviderError) throw error;
    throw new WebSearchProviderError(
      error instanceof Error ? error.message : String(error),
      {
        provider,
        durationMs: execution.durationMs,
        status: execution.response.status,
        ...(execution.requestId ? { requestId: execution.requestId } : {}),
      },
      { cause: error },
    );
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function parseProviderEndpoint(value: string, field = "web.searchProvider.url"): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new KilnYamlError(`${field} must be a valid URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new KilnYamlError(`${field} must use http or https`);
  }
  if (url.username || url.password) {
    throw new KilnYamlError(`${field} must not include credentials`);
  }
  url.hash = "";
  return url.toString();
}

function requireFetchClient(providerLabel: string, fetchImpl: FetchLike | undefined): FetchLike {
  const fetchClient = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchClient) {
    throw new KilnYamlError(`${providerLabel} requires a fetch implementation`);
  }
  return fetchClient;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function readRequiredEnv(name: string, field: string): string {
  const envName = name.trim();
  if (!envName) {
    throw new KilnYamlError(`${field} must be a non-empty string`);
  }
  const value = process.env[envName];
  if (!value) {
    throw new WebProviderUnavailableError(
      `${field} references unset environment variable ${envName}`,
      issueForWebProviderEnv(field, envName),
    );
  }
  return value;
}

function issueForWebProviderEnv(field: string, envName: string): string {
  if (field.startsWith("web.searchProvider.")) {
    return `web.search_provider_env_missing:${envName}`;
  }
  if (field.startsWith("web.extractProvider.")) {
    return `web.extract_provider_env_missing:${envName}`;
  }
  return `web.provider_env_missing:${envName}`;
}

function missingApiKeyEnvIssue(
  providerConfig: KilnYamlWebSearchProvider | KilnYamlWebExtractProvider | undefined,
  providerTypes: readonly string[],
  issuePrefix: string,
): string | undefined {
  if (!isRecord(providerConfig) || typeof providerConfig.type !== "string") {
    return undefined;
  }
  if (!providerTypes.includes(providerConfig.type)) {
    return undefined;
  }
  if (typeof providerConfig.apiKeyEnv !== "string") {
    return undefined;
  }
  const envName = providerConfig.apiKeyEnv.trim();
  if (!envName || process.env[envName]) {
    return undefined;
  }
  return `${issuePrefix}:${envName}`;
}

function normalizeHeaders(headers: unknown, field = "web.searchProvider.headers"): Record<string, string> {
  if (!headers) return {};
  if (!isRecord(headers)) {
    throw new KilnYamlError(`${field} must be an object`);
  }
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!name.trim() || typeof value !== "string") {
      throw new KilnYamlError(`${field} must map non-empty header names to string values`);
    }
    out[name.trim()] = value;
  }
  return out;
}

function requireConfigString(
  value: Record<string, unknown>,
  key: string,
  message: string,
): string {
  const field = value[key];
  if (typeof field !== "string") {
    throw new KilnYamlError(message);
  }
  return field;
}

function optionalConfigString(
  value: Record<string, unknown>,
  key: string,
  parent = "web.searchProvider",
): string | undefined {
  const field = value[key];
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== "string") {
    throw new KilnYamlError(`${parent}.${key} must be a string`);
  }
  return field;
}

function isSearchProviderConfigured(providerConfig: KilnYamlWebSearchProvider | undefined): boolean {
  if (!providerConfig || !isRecord(providerConfig)) {
    return false;
  }
  const type = providerConfig.type;
  if (type === undefined || type === "none") {
    return false;
  }
  return typeof type === "string"
    && (VALID_SEARCH_PROVIDER_TYPES as readonly string[]).includes(type);
}

function isExtractProviderConfigured(providerConfig: KilnYamlWebExtractProvider | undefined): boolean {
  if (!providerConfig || !isRecord(providerConfig)) {
    return false;
  }
  const type = providerConfig.type;
  if (type === undefined || type === "none") {
    return false;
  }
  return typeof type === "string"
    && (VALID_EXTRACT_PROVIDER_TYPES as readonly string[]).includes(type);
}

function normalizeProviderResponse(value: unknown): WebSearchProviderResponse {
  if (!isRecord(value) || !Array.isArray(value.sources)) {
    throw new Error("Web search provider response must include a sources array");
  }
  return {
    ...(typeof value.provider === "string" ? { provider: value.provider } : {}),
    ...(typeof value.retrievedAt === "string" ? { retrievedAt: value.retrievedAt } : {}),
    ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
    ...(typeof value.durationMs === "number" ? { durationMs: value.durationMs } : {}),
    ...(isNumericRecord(value.usage) ? { usage: value.usage } : {}),
    ...(isRecord(value.effectiveParameters) ? { effectiveParameters: value.effectiveParameters } : {}),
    sources: value.sources.map(normalizeSource),
  };
}

function normalizeSearxngResponse(value: unknown): WebSearchProviderResponse {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new Error("SearXNG response must include a results array");
  }
  return {
    provider: "searxng",
    sources: value.results.map((result) => normalizeSearchResult(result, {
      snippetKeys: ["content", "snippet"],
      publishedAtKeys: ["publishedDate", "published_date"],
    })),
  };
}

function normalizeBraveResponse(value: unknown): WebSearchProviderResponse {
  const results = isRecord(value) && isRecord(value.web) && Array.isArray(value.web.results)
    ? value.web.results
    : isRecord(value) && Array.isArray(value.results)
      ? value.results
      : [];
  return {
    provider: "brave",
    sources: results.map((result) => normalizeSearchResult(result, {
      snippetKeys: ["description", "content", "snippet"],
      publishedAtKeys: ["age", "publishedDate", "published_date"],
    })),
  };
}

function normalizeTavilyResponse(value: unknown): WebSearchProviderResponse {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new Error("Tavily response must include a results array");
  }
  return {
    provider: "tavily",
    ...(typeof value.request_id === "string" ? { requestId: value.request_id } : {}),
    ...(typeof value.response_time === "number" ? { durationMs: Math.round(value.response_time * 1000) } : {}),
    ...(isNumericRecord(value.usage) ? { usage: value.usage } : {}),
    ...(isRecord(value.auto_parameters) ? { effectiveParameters: value.auto_parameters } : {}),
    sources: value.results.map((result, index) => ({ ...normalizeSearchResult(result, {
      snippetKeys: ["content", "snippet"],
      publishedAtKeys: ["published_date", "publishedDate"],
    }), providerRank: index + 1 })),
  };
}

function normalizeExaResponse(value: unknown): WebSearchProviderResponse {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new Error("Exa response must include a results array");
  }
  return {
    provider: "exa",
    ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
    ...(readExaCost(value.costDollars) !== undefined ? { usage: { costUsd: readExaCost(value.costDollars)! } } : {}),
    sources: value.results.map((result) => normalizeSearchResult(result, {
      snippetKeys: ["text", "summary", "snippet"],
      publishedAtKeys: ["publishedDate", "published_date"],
    })),
  };
}

function readExaCost(value: unknown): number | undefined {
  return isRecord(value) && typeof value.total === "number" && Number.isFinite(value.total)
    ? value.total
    : undefined;
}

function normalizeExtractProviderResponse(value: unknown): WebExtractProviderResponse {
  if (!isRecord(value) || !Array.isArray(value.pages)) {
    throw new Error("Web extract provider response must include a pages array");
  }
  return {
    ...(typeof value.provider === "string" ? { provider: value.provider } : {}),
    ...(typeof value.retrievedAt === "string" ? { retrievedAt: value.retrievedAt } : {}),
    pages: value.pages.map((page) => normalizeExtractPage(page, "provider")),
  };
}

function normalizeTavilyExtractResponse(
  value: unknown,
  format: WebExtractFormat,
): WebExtractProviderResponse {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new Error("Tavily extract response must include a results array");
  }
  return {
    provider: "tavily",
    pages: value.results.map((page) => normalizeExtractPage(page, "tavily", format)),
  };
}

function normalizeFirecrawlExtractPage(
  value: unknown,
  requestedUrl: string,
  format: WebExtractFormat,
): WebExtractPage {
  const data = isRecord(value) && isRecord(value.data) ? value.data : value;
  if (!isRecord(data)) {
    throw new Error("Firecrawl scrape response must include a data object");
  }
  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const text = extractPageText(data, format);
  return {
    url: firstString(metadata, ["sourceURL", "sourceUrl", "url"]) ?? requestedUrl,
    normalizedUrl: firstString(metadata, ["sourceURL", "sourceUrl", "url"]) ?? requestedUrl,
    ...(firstString(metadata, ["title"]) ? { title: firstString(metadata, ["title"]) } : {}),
    ...(firstString(data, ["contentType", "mimeType"]) ? { contentType: firstString(data, ["contentType", "mimeType"]) } : {}),
    ...(typeof metadata.statusCode === "number" ? { status: metadata.statusCode } : {}),
    text,
    bytesRead: Buffer.byteLength(text, "utf8"),
  };
}

function normalizeExtractPage(
  value: unknown,
  provider: string,
  format: WebExtractFormat = "markdown",
): WebExtractPage {
  if (!isRecord(value) || typeof value.url !== "string") {
    throw new Error(`${provider} extract result.url must be a string`);
  }
  const text = extractPageText(value, format);
  return {
    url: value.url,
    ...(typeof value.normalizedUrl === "string" ? { normalizedUrl: value.normalizedUrl } : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.contentType === "string" ? { contentType: value.contentType } : {}),
    ...(typeof value.status === "number" ? { status: value.status } : {}),
    text,
    ...(typeof value.bytesRead === "number" ? { bytesRead: value.bytesRead } : { bytesRead: Buffer.byteLength(text, "utf8") }),
    ...(typeof value.truncated === "boolean" ? { truncated: value.truncated } : {}),
  };
}

function extractPageText(value: Record<string, unknown>, format: WebExtractFormat): string {
  const text = format === "markdown"
    ? firstString(value, ["markdown", "raw_content", "rawContent", "content", "text", "html"])
    : firstString(value, ["text", "raw_content", "rawContent", "content", "markdown", "html"]);
  if (!text) {
    throw new Error("Web extract provider page must include extracted text");
  }
  return text;
}

function normalizeSearchResult(
  value: unknown,
  options: {
    readonly snippetKeys: readonly string[];
    readonly publishedAtKeys: readonly string[];
  },
): Omit<WebSourceMetadata, "rank"> {
  if (!isRecord(value) || typeof value.url !== "string") {
    throw new Error("Web search provider result.url must be a string");
  }
  const highlights = Array.isArray(value.highlights)
    ? value.highlights.filter((item): item is string => typeof item === "string")
    : [];
  const snippet = firstString(value, options.snippetKeys) ?? highlights[0];
  return {
    url: value.url,
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(snippet ? { snippet } : {}),
    ...(firstString(value, options.publishedAtKeys) ? { publishedAt: firstString(value, options.publishedAtKeys) } : {}),
    ...(typeof value.source === "string" ? { source: value.source } : {}),
    ...(typeof value.score === "number" ? { relevanceScore: value.score } : {}),
  };
}

function firstString(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function scopedQuery(query: string, domains: readonly string[], exactPhrases: readonly string[] = []): string {
  return [
    query,
    ...exactPhrases.map((phrase) => `"${phrase.replace(/"/g, "\\\"")}"`),
    ...domains.map((domain) => `site:${domain}`),
  ].join(" ");
}

function normalizeSource(value: unknown): Omit<WebSourceMetadata, "rank"> {
  if (!isRecord(value) || typeof value.url !== "string") {
    throw new Error("Web search provider source.url must be a string");
  }
  return {
    url: value.url,
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.snippet === "string" ? { snippet: value.snippet } : {}),
    ...(typeof value.publishedAt === "string" ? { publishedAt: value.publishedAt } : {}),
    ...(typeof value.source === "string" ? { source: value.source } : {}),
    ...(typeof value.relevanceScore === "number" ? { relevanceScore: value.relevanceScore } : {}),
    ...(typeof value.providerRank === "number" ? { providerRank: value.providerRank } : {}),
  };
}

function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function relativeUtcDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

function braveSearchEndpoint(endpoint: string, topic: string | undefined): URL {
  const url = new URL(endpoint);
  if (topic === "news") {
    if (!url.pathname.endsWith("/web/search")) {
      throw new Error("Configured Brave endpoint cannot satisfy news search routing");
    }
    url.pathname = `${url.pathname.slice(0, -"/web/search".length)}/news/search`;
  }
  return url;
}

function toEnglishCountryName(countryCode: string): string {
  const name = new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode.toUpperCase());
  if (!name || name.toUpperCase() === countryCode.toUpperCase()) {
    throw new Error(`Unsupported country code for Tavily: ${countryCode}`);
  }
  return name.toLowerCase();
}

function isNumericRecord(value: unknown): value is Readonly<Record<string, number>> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}
