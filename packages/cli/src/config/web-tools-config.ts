import {
  DOCUMENTATION_DOMAINS,
  MEMORY_LAYER_KINDS,
  PACKAGE_MANAGER_DOMAINS,
  SandboxPolicy,
  SqliteMemoryRepository,
  MemoryMutationService,
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
  type WebSourceMetadata,
  type MemoryScope,
} from "@kilnai/core";
import { existsSync, mkdirSync } from "node:fs";
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
  KilnYaml,
  KilnYamlWebConfig,
  KilnYamlWebExtractProvider,
  KilnYamlWebNetPolicy,
  KilnYamlWebSearchProvider,
} from "../kiln-yaml-types.js";
import type { KilnGlobalWebConfig } from "./global-config.js";
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
  readonly config?: KilnYaml | null;
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
  readonly projectWeb?: KilnYamlWebConfig | null;
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
  const searchProvider = createOptionalConfiguredWebSearchProvider(webConfig.searchProvider, input.fetchImpl);
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
      ...(searchProvider ? { searchProvider } : {}),
    },
  };
}

export function describeWebToolConfiguration(
  config: KilnYaml | null | undefined,
  sources: WebToolConfigurationSourceInput = {},
): WebToolConfigurationDiagnostics {
  const webConfig = config?.web;
  const enabled = webConfig?.enabled === true;
  const netPolicy = webConfig?.netPolicy ?? "none";
  const issues: string[] = [];
  let allowedDomains: readonly string[] = [];
  let searchProviderType = "none";
  let searchProviderConfigured = false;
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
    projectProvider: sources.projectWeb?.searchProvider,
  });
  if (searchProviderEnvIssue) {
    issues.push(searchProviderEnvIssue);
  } else if (enabled && !searchProviderConfigured) {
    issues.push("web.search_provider_missing");
  }

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
    projectProvider: sources.projectWeb?.extractProvider,
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
    extractProviderType,
    extractProviderConfigured,
    extractProviderSource,
    issues,
  };
}

function resolveProviderSource(input: {
  readonly effectiveProvider: KilnYamlWebSearchProvider | KilnYamlWebExtractProvider | undefined;
  readonly globalProvider: KilnYamlWebSearchProvider | KilnYamlWebExtractProvider | undefined;
  readonly projectProvider: KilnYamlWebSearchProvider | KilnYamlWebExtractProvider | undefined;
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

  const memoryStorage = resolveCliMemoryStorage(projectPath);
  mkdirSync(memoryStorage.stateDir, { recursive: true });
  return {
    repository: new SqliteMemoryRepository({ dbPath: memoryStorage.memoryDbPath }),
    ...(authority ? { authority } : {}),
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
        authority,
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
      throw new Error(`Web search provider returned HTTP ${response.status}`);
    }
    return normalizeProviderResponse(await response.json());
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
    endpoint.searchParams.set("q", scopedQuery(request.query, request.domains));
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("language", "all");
    endpoint.searchParams.set("safesearch", "1");
    const response = await fetchClient(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...headers,
      },
    });
    if (!response.ok) {
      throw new Error(`Web search provider returned HTTP ${response.status}`);
    }
    return normalizeSearxngResponse(await response.json());
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
    const url = new URL(endpoint);
    url.searchParams.set("q", scopedQuery(request.query, request.domains));
    url.searchParams.set("count", String(request.maxResults));
    if (request.recencyDays !== undefined) {
      url.searchParams.set("freshness", `${request.recencyDays}d`);
    }
    const response = await fetchClient(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-subscription-token": apiKey,
      },
    });
    if (!response.ok) {
      throw new Error(`Web search provider returned HTTP ${response.status}`);
    }
    return normalizeBraveResponse(await response.json());
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
      query: request.query,
      max_results: request.maxResults,
      include_answer: false,
      include_raw_content: false,
      search_depth: "basic",
    };
    if (request.domains.length > 0) {
      body.include_domains = request.domains;
    }
    if (request.recencyDays !== undefined) {
      body.days = request.recencyDays;
    }
    const response = await fetchClient(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Web search provider returned HTTP ${response.status}`);
    }
    return normalizeTavilyResponse(await response.json());
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
    const response = await fetchClient(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        query: scopedQuery(request.query, request.domains),
        type: "auto",
        numResults: request.maxResults,
        contents: { highlights: true },
      }),
    });
    if (!response.ok) {
      throw new Error(`Web search provider returned HTTP ${response.status}`);
    }
    return normalizeExaResponse(await response.json());
  };
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
    sources: value.results.map((result) => normalizeSearchResult(result, {
      snippetKeys: ["content", "snippet"],
      publishedAtKeys: ["published_date", "publishedDate"],
    })),
  };
}

function normalizeExaResponse(value: unknown): WebSearchProviderResponse {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new Error("Exa response must include a results array");
  }
  return {
    provider: "exa",
    sources: value.results.map((result) => normalizeSearchResult(result, {
      snippetKeys: ["text", "summary", "snippet"],
      publishedAtKeys: ["publishedDate", "published_date"],
    })),
  };
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

function scopedQuery(query: string, domains: readonly string[]): string {
  if (domains.length === 0) {
    return query;
  }
  return `${query} ${domains.map((domain) => `site:${domain}`).join(" ")}`;
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
  };
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
