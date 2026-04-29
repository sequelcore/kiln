import {
  DOCUMENTATION_DOMAINS,
  PACKAGE_MANAGER_DOMAINS,
  SandboxPolicy,
  type DefaultBuiltinToolRegistryOptions,
  type NetPolicy,
  type SandboxConfig,
  type WebSearchProvider,
  type WebSearchProviderResponse,
  type WebSourceMetadata,
} from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import { loadKilnConfig } from "./config-merger.js";
import { KilnYamlError } from "../kiln-yaml.js";
import type {
  KilnYaml,
  KilnYamlWebConfig,
  KilnYamlWebNetPolicy,
  KilnYamlWebSearchProvider,
} from "../kiln-yaml-types.js";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface WebToolSurfaceOptionsInput {
  readonly config?: KilnYaml | null;
  readonly projectPath: string;
  readonly fetchImpl?: FetchLike;
}

const VALID_NET_POLICIES: readonly KilnYamlWebNetPolicy[] = [
  "none",
  "documentation",
  "package-managers",
  "full",
];

export async function loadConfiguredWebToolSurfaceOptions(
  appConfig: KilnAppConfig,
  projectPath: string,
): Promise<DefaultBuiltinToolRegistryOptions> {
  const config = appConfig.kilnYaml ?? await loadKilnConfig(projectPath);
  return createWebToolSurfaceOptions({ config, projectPath });
}

export function createWebToolSurfaceOptions(
  input: WebToolSurfaceOptionsInput,
): DefaultBuiltinToolRegistryOptions {
  const webConfig = input.config?.web;
  if (webConfig?.enabled !== true) {
    return {};
  }

  const networkPolicy = createWebNetworkPolicy(webConfig, input.projectPath);
  const searchProvider = createConfiguredWebSearchProvider(webConfig.searchProvider, input.fetchImpl);

  return {
    webFetch: { networkPolicy },
    webSearch: {
      networkPolicy,
      ...(searchProvider ? { searchProvider } : {}),
    },
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
  throw new KilnYamlError("web.searchProvider.type must be one of: none, http");
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

function parseProviderEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new KilnYamlError("web.searchProvider.url must be a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new KilnYamlError("web.searchProvider.url must use http or https");
  }
  if (url.username || url.password) {
    throw new KilnYamlError("web.searchProvider.url must not include credentials");
  }
  url.hash = "";
  return url.toString();
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!headers) return {};
  if (!isRecord(headers)) {
    throw new KilnYamlError("web.searchProvider.headers must be an object");
  }
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!name.trim() || typeof value !== "string") {
      throw new KilnYamlError("web.searchProvider.headers must map non-empty header names to string values");
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
