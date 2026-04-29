import type { SandboxPolicy } from "../../sandbox/policies.js";
import {
  webToolMetadata,
  type ToolOutputVerbosity,
  type WebSourceMetadata,
  type WebToolErrorCode,
} from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { parseOutputVerbosity } from "./output-verbosity.js";
import {
  normalizeWebDomains,
  sanitizeWebText,
} from "./web-policy.js";
import { formatWebSearchOutput } from "./web-result-format.js";
import {
  getSandboxContext,
  optionalNumber,
  requireString,
  toErrorResult,
  toSuccessResult,
} from "./tool-helpers.js";

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 20;
const MAX_RECENCY_DAYS = 3650;

export interface WebSearchProviderRequest {
  readonly query: string;
  readonly domains: readonly string[];
  readonly recencyDays?: number;
  readonly maxResults: number;
}

export interface WebSearchProviderResponse {
  readonly provider?: string;
  readonly retrievedAt?: string;
  readonly sources: readonly Omit<WebSourceMetadata, "rank">[];
}

export type WebSearchProvider = (request: WebSearchProviderRequest) => Promise<WebSearchProviderResponse>;

export interface WebSearchToolOptions {
  readonly searchProvider?: WebSearchProvider;
  readonly networkPolicy?: SandboxPolicy;
}

export class WebSearchTool implements DevTool {
  readonly name = "web_search";
  readonly description = TOOL_SCHEMAS.web_search.description;
  readonly inputSchema = TOOL_SCHEMAS.web_search.inputSchema;
  readonly annotations = TOOL_SCHEMAS.web_search.annotations;

  private readonly searchProvider?: WebSearchProvider;
  private readonly networkPolicy?: SandboxPolicy;

  constructor(options: WebSearchToolOptions = {}) {
    this.searchProvider = options.searchProvider;
    this.networkPolicy = options.networkPolicy;
  }

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const queryInput = requireString(input, "query");
    if (!queryInput.ok) {
      return queryInput.result;
    }
    const query = queryInput.value.trim();
    if (query.length === 0) {
      return this.error("", "Invalid input: \"query\" must be a non-empty string", "invalid_input", "raw");
    }

    const verbosityInput = parseOutputVerbosity(input);
    if (!verbosityInput.ok) {
      return verbosityInput.result;
    }
    const domainInput = normalizeWebDomains(input.input["domains"]);
    if (!domainInput.ok) {
      return this.error(query, domainInput.message, domainInput.errorCode, verbosityInput.value);
    }
    const recencyInput = parseOptionalBoundedNumber(input, "recencyDays", MAX_RECENCY_DAYS);
    if (!recencyInput.ok) {
      return this.error(query, recencyInput.message, "invalid_input", verbosityInput.value, domainInput.domains);
    }
    const maxResultsInput = parseOptionalBoundedNumber(input, "maxResults", MAX_RESULTS, DEFAULT_MAX_RESULTS);
    if (!maxResultsInput.ok) {
      return this.error(query, maxResultsInput.message, "invalid_input", verbosityInput.value, domainInput.domains);
    }
    const maxResults = maxResultsInput.value ?? DEFAULT_MAX_RESULTS;
    const effectiveDomains = resolveEffectiveDomains(domainInput.domains, sandbox, this.networkPolicy);
    if (!effectiveDomains.ok) {
      return this.error(query, effectiveDomains.message, effectiveDomains.errorCode, verbosityInput.value, domainInput.domains);
    }

    if (!this.searchProvider) {
      return this.error(
        query,
        "Web search provider is not configured",
        "provider_not_configured",
        verbosityInput.value,
        effectiveDomains.domains,
      );
    }

    try {
      const response = await this.searchProvider({
        query,
        domains: effectiveDomains.domains,
        ...(recencyInput.value !== undefined ? { recencyDays: recencyInput.value } : {}),
        maxResults,
      });
      const sources = normalizeSources(response.sources, maxResults);
      const metadata = webToolMetadata("web_search", {
        operation: "search",
        provider: response.provider,
        query,
        domains: effectiveDomains.domains,
        ...(recencyInput.value !== undefined ? { recencyDays: recencyInput.value } : {}),
        resultCount: sources.length,
        retrievedAt: response.retrievedAt ?? new Date().toISOString(),
        sources,
        verbosity: verbosityInput.value,
      });

      return toSuccessResult(formatWebSearchOutput({
        query,
        sources,
      }, verbosityInput.value), metadata);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code: WebToolErrorCode = /timeout/i.test(message) ? "timeout" : "unavailable";
      return this.error(query, message, code, verbosityInput.value, effectiveDomains.domains);
    }
  }

  private error(
    query: string,
    message: string,
    errorCode: WebToolErrorCode,
    verbosity: ToolOutputVerbosity,
    domains: readonly string[] = [],
  ): ToolResult {
    return toErrorResult(message, webToolMetadata("web_search", {
      operation: "search",
      query,
      domains,
      errorCode,
      verbosity,
    }));
  }
}

function parseOptionalBoundedNumber(
  input: ToolInput,
  key: string,
  maxValue: number,
  defaultValue?: number,
): { ok: true; value: number | undefined } | { ok: false; message: string } {
  const value = optionalNumber(input, key);
  if (value === undefined) {
    if (input.input[key] !== undefined) {
      return { ok: false, message: `Invalid input: "${key}" must be a finite number` };
    }
    return { ok: true, value: defaultValue };
  }
  if (value <= 0) {
    return { ok: false, message: `Invalid input: "${key}" must be > 0` };
  }
  return { ok: true, value: Math.min(Math.trunc(value), maxValue) };
}

function resolveEffectiveDomains(
  domains: readonly string[],
  sandbox: unknown,
  networkPolicy: SandboxPolicy | undefined,
): { ok: true; domains: readonly string[] } | { ok: false; message: string; errorCode: WebToolErrorCode } {
  const policy = networkPolicy ?? getSandboxContext(sandbox)?.policy;
  if (!policy) {
    return {
      ok: false,
      message: "Network access denied: explicit network policy is required",
      errorCode: "network_denied",
    };
  }

  if (domains.length > 0) {
    for (const domain of domains) {
      if (!policy.canAccess(domain)) {
        return { ok: false, message: `Domain access denied: ${domain}`, errorCode: "network_denied" };
      }
    }
    return { ok: true, domains };
  }

  if (policy.config.netPolicy === "full" || policy.config.allowedDomains.includes("*")) {
    return { ok: true, domains: [] };
  }

  const policyDomains = normalizePolicyDomains(policy.config.allowedDomains);
  if (policyDomains.length === 0) {
    return { ok: false, message: "Network access denied: no allowed search domains", errorCode: "network_denied" };
  }
  return { ok: true, domains: policyDomains };
}

function normalizePolicyDomains(domains: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const domain of domains) {
    const normalized = normalizeWebDomains([domain]);
    if (normalized.ok) {
      for (const value of normalized.domains) {
        if (!out.includes(value)) {
          out.push(value);
        }
      }
    }
  }
  return out;
}

function normalizeSources(
  sources: readonly Omit<WebSourceMetadata, "rank">[],
  maxResults: number,
): readonly WebSourceMetadata[] {
  return sources.slice(0, maxResults).map((source, index) => ({
    url: source.url,
    ...(source.title ? { title: sanitizeWebText(source.title) } : {}),
    ...(source.snippet ? { snippet: sanitizeWebText(source.snippet) } : {}),
    ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
    ...(source.source ? { source: source.source } : {}),
    rank: index + 1,
  }));
}
