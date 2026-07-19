import type { SandboxPolicy } from "../../sandbox/policies.js";
import {
  webToolMetadata,
  type ToolOutputVerbosity,
  type WebSourceMetadata,
  type WebToolErrorCode,
  type WebToolResultMetadata,
} from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { parseOutputVerbosity } from "./output-verbosity.js";
import {
  domainMatches,
  normalizeWebDomains,
  normalizeWebUrl,
  sanitizeWebText,
} from "./web-policy.js";
import { formatWebSearchOutput } from "./web-result-format.js";
import {
  evaluateWebSearchTemporalEvidence,
  parseTemporalEventEvidenceRequirement,
  type TemporalEventEvidenceRequirement,
  type WebSearchFreshnessCapability,
} from "../domain/temporal-evidence.js";
import {
  findUnmetWebSearchCapabilities,
  findUnsupportedWebSearchPreferences,
  type WebSearchDomainPostcondition,
  type WebSearchIntent,
  type WebSearchProviderAttempt,
  type WebSearchProviderCapabilities,
  type WebSearchProviderRegistration,
  type WebSearchQuality,
  type WebSearchTopic,
} from "../domain/web-search-governance.js";
import {
  getSandboxContext,
  optionalBoolean,
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
  readonly topic?: WebSearchTopic;
  readonly quality?: WebSearchQuality;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly country?: string;
  readonly language?: string;
  readonly exactPhrases?: readonly string[];
}

export interface WebSearchProviderResponse {
  readonly provider?: string;
  readonly retrievedAt?: string;
  readonly requestId?: string;
  readonly durationMs?: number;
  readonly usage?: Readonly<Record<string, number>>;
  readonly effectiveParameters?: Readonly<Record<string, unknown>>;
  readonly sources: readonly Omit<WebSourceMetadata, "rank">[];
}

export type WebSearchProvider = (request: WebSearchProviderRequest) => Promise<WebSearchProviderResponse>;

export interface WebSearchProviderFailureMetadata {
  readonly provider?: string;
  readonly requestId?: string;
  readonly durationMs?: number;
  readonly status?: number;
}

export class WebSearchProviderError extends Error {
  constructor(
    message: string,
    readonly providerMetadata: WebSearchProviderFailureMetadata = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WebSearchProviderError";
  }
}

export interface WebSearchToolOptions {
  readonly searchProvider?: WebSearchProvider;
  readonly searchProviders?: readonly WebSearchProviderRegistration<WebSearchProvider>[];
  readonly networkPolicy?: SandboxPolicy;
  readonly freshnessCapability?: WebSearchFreshnessCapability;
}

export class WebSearchTool implements DevTool {
  readonly name = "web_search";
  readonly description = TOOL_SCHEMAS.web_search.description;
  readonly inputSchema = TOOL_SCHEMAS.web_search.inputSchema;

  private readonly searchProviders: readonly WebSearchProviderRegistration<WebSearchProvider>[];
  private readonly networkPolicy?: SandboxPolicy;
  private readonly usesSingleProviderCompatibility: boolean;

  constructor(options: WebSearchToolOptions = {}) {
    this.usesSingleProviderCompatibility = options.searchProviders === undefined && options.searchProvider !== undefined;
    this.searchProviders = options.searchProviders
      ?? (options.searchProvider
        ? [{
          id: "primary",
          search: options.searchProvider,
          capabilities: inferSingleProviderCapabilities(options.freshnessCapability),
        }]
        : []);
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
    const freshnessRequired = parseFreshnessRequired(input);
    if (!freshnessRequired.ok) {
      return this.error(query, freshnessRequired.message, "invalid_input", verbosityInput.value, domainInput.domains);
    }
    const temporalRequirement = parseTemporalEventEvidenceRequirement(input.input["temporalRequirement"]);
    if (!temporalRequirement.ok) {
      return this.error(query, temporalRequirement.message, "invalid_input", verbosityInput.value, domainInput.domains);
    }
    const effectiveDomains = resolveEffectiveDomains(domainInput.domains, sandbox, this.networkPolicy);
    if (!effectiveDomains.ok) {
      return this.error(query, effectiveDomains.message, effectiveDomains.errorCode, verbosityInput.value, domainInput.domains);
    }

    if (this.searchProviders.length === 0) {
      return this.error(
        query,
        "Web search provider is not configured",
        "provider_not_configured",
        verbosityInput.value,
        effectiveDomains.domains,
      );
    }

    const intentInput = parseSearchIntent(input, {
      freshnessRequired: freshnessRequired.value,
      recencyDays: recencyInput.value,
      temporalEvidenceRequired: temporalRequirement.value !== undefined,
    });
    if (!intentInput.ok) {
      return this.error(query, intentInput.message, "invalid_input", verbosityInput.value, effectiveDomains.domains);
    }

    const attempts: WebSearchProviderAttempt[] = [];
    let lastResult: {
      readonly response: WebSearchProviderResponse;
      readonly sources: readonly WebSourceMetadata[];
      readonly postcondition: WebSearchDomainPostcondition;
      readonly temporalEvidence?: ReturnType<typeof evaluateWebSearchTemporalEvidence>;
    } | undefined;
    let lastProviderError: { readonly message: string; readonly code: WebToolErrorCode } | undefined;

    for (const registration of this.searchProviders) {
      const unmet = findUnmetWebSearchCapabilities(intentInput.intent, registration.capabilities);
      const omittedPreferences = findUnsupportedWebSearchPreferences(intentInput.intent, registration.capabilities);
      if (unmet.length > 0) {
        attempts.push({
          providerId: registration.id,
          provider: registration.capabilities.provider,
          outcome: "capability_rejected",
          unmetCapabilities: unmet,
          ...(omittedPreferences.length > 0 ? { omittedPreferences } : {}),
        });
        continue;
      }

      try {
        const response = await registration.search({
          query,
          domains: effectiveDomains.domains,
          ...(recencyInput.value !== undefined ? { recencyDays: recencyInput.value } : {}),
          maxResults,
          ...projectProviderParameters(intentInput.providerParameters, registration.capabilities, intentInput.intent.topic),
        });
        const normalized = normalizeSources(response.sources, maxResults, effectiveDomains.domains);
        const retrievedAt = response.retrievedAt ?? new Date().toISOString();
        const temporalEvidence = temporalRequirement.value
          ? evaluateWebSearchTemporalEvidence({
            requirement: temporalRequirement.value,
            retrievedAt,
            sources: normalized.sources,
          })
          : undefined;
        lastResult = {
          response,
          sources: normalized.sources,
          postcondition: normalized.postcondition,
          ...(temporalEvidence ? { temporalEvidence } : {}),
        };

        const provider = response.provider ?? registration.capabilities.provider;
        const attemptBase = {
          providerId: registration.id,
          provider,
          ...(response.requestId ? { requestId: response.requestId } : {}),
          ...(response.durationMs !== undefined ? { durationMs: response.durationMs } : {}),
          candidateCount: response.sources.length,
          acceptedCount: normalized.sources.length,
          rejectedCount: normalized.postcondition.rejectedCount,
          rejectedSourceIds: normalized.postcondition.rejectedSourceIds,
          ...(omittedPreferences.length > 0 ? { omittedPreferences } : {}),
        };

        if (normalized.postcondition.rejectedCount > 0 && normalized.sources.length === 0) {
          attempts.push({ ...attemptBase, outcome: "contract_rejected" });
          continue;
        }
        if (temporalEvidence && !temporalEvidence.accepted) {
          attempts.push({ ...attemptBase, outcome: "evidence_rejected" });
          continue;
        }
        if (normalized.sources.length === 0 && this.searchProviders.length > 1) {
          attempts.push({ ...attemptBase, outcome: "empty" });
          continue;
        }

        attempts.push({ ...attemptBase, outcome: "accepted" });
        const metadata = buildSearchMetadata({
          query,
          domains: effectiveDomains.domains,
          recencyDays: recencyInput.value,
          freshnessRequired: freshnessRequired.value,
          temporalRequirement: temporalRequirement.value,
          intent: intentInput.intent,
          response,
          provider,
          sources: normalized.sources,
          postcondition: normalized.postcondition,
          temporalEvidence,
          attempts,
          verbosity: verbosityInput.value,
        });
        return toSuccessResult(formatWebSearchOutput({ query, sources: normalized.sources }, verbosityInput.value), metadata);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code: WebToolErrorCode = /timeout/i.test(message) ? "timeout" : "unavailable";
        lastProviderError = { message, code };
        const providerMetadata = error instanceof WebSearchProviderError ? error.providerMetadata : undefined;
        attempts.push({
          providerId: registration.id,
          provider: providerMetadata?.provider ?? registration.capabilities.provider,
          outcome: "provider_failed",
          errorCode: code,
          ...(providerMetadata?.requestId ? { requestId: providerMetadata.requestId } : {}),
          ...(providerMetadata?.durationMs !== undefined ? { durationMs: providerMetadata.durationMs } : {}),
          ...(providerMetadata?.status !== undefined ? { providerStatus: providerMetadata.status } : {}),
        });
      }
    }

    const metadataBase = {
      operation: "search" as const,
      query,
      domains: effectiveDomains.domains,
      ...(recencyInput.value !== undefined ? { recencyDays: recencyInput.value } : {}),
      ...(freshnessRequired.value
        ? { freshnessRequired: true, freshnessEnforcement: "not_enforced" as const }
        : {}),
      searchIntent: intentInput.intent,
      providerAttempts: attempts,
      ...(temporalRequirement.value ? { temporalRequirement: temporalRequirement.value } : {}),
      verbosity: verbosityInput.value,
    };
    if (lastResult) {
      const provider = lastResult.response.provider
        ?? attempts.at(-1)?.provider;
      const metadata = buildSearchMetadata({
        query,
        domains: effectiveDomains.domains,
        recencyDays: recencyInput.value,
        freshnessRequired: freshnessRequired.value,
        temporalRequirement: temporalRequirement.value,
        intent: intentInput.intent,
        response: lastResult.response,
        provider,
        sources: lastResult.sources,
        postcondition: lastResult.postcondition,
        temporalEvidence: lastResult.temporalEvidence,
        attempts,
        verbosity: verbosityInput.value,
      });
      if (lastResult.postcondition.rejectedCount > 0 && lastResult.sources.length === 0) {
        return toErrorResult(
          "Web search provider returned no sources within the required domains",
          { ...metadata, errorCode: "provider_contract_violation" },
        );
      }
      if (lastResult.temporalEvidence && !lastResult.temporalEvidence.accepted) {
        return toErrorResult(
          "Web search results do not yet provide independent semantic consensus for the required event date, identities, and completed status. "
          + "Retry web_search with a broader discovery query and only constraints required by the operator. "
          + "Do not copy the event date into publication-date filters. Then use web_extract on the strongest candidate pages with the same temporalRequirement.",
          {
            ...metadata,
            recoveryDirective: {
              kind: "progressive_web_research",
              action: "broaden_search",
              constraintPolicy: "relax_only_agent_added",
              preserveTemporalRequirement: true,
              nextActions: ["broaden_search", "extract_candidates"],
            },
            errorCode: "temporal_evidence_rejected",
          },
        );
      }
      return toSuccessResult(formatWebSearchOutput({ query, sources: lastResult.sources }, verbosityInput.value), metadata);
    }

    const onlyCapabilityRejections = attempts.length > 0
      && attempts.every((attempt) => attempt.outcome === "capability_rejected");
    if (onlyCapabilityRejections) {
      const code = this.usesSingleProviderCompatibility && freshnessRequired.value
        ? "freshness_not_enforced"
        : "provider_capability_mismatch";
      return toErrorResult(
        "No configured web search provider can satisfy the required search intent",
        webToolMetadata("web_search", { ...metadataBase, errorCode: code }),
      );
    }
    return toErrorResult(
      lastProviderError?.message ?? "All configured web search providers failed",
      webToolMetadata("web_search", { ...metadataBase, errorCode: lastProviderError?.code ?? "unavailable" }),
    );
  }

  private error(
    query: string,
    message: string,
    errorCode: WebToolErrorCode,
    verbosity: ToolOutputVerbosity,
    domains: readonly string[] = [],
    freshness?: Pick<WebToolResultMetadata, "freshnessRequired" | "freshnessEnforcement">,
  ): ToolResult {
    return toErrorResult(message, webToolMetadata("web_search", {
      operation: "search",
      query,
      domains,
      errorCode,
      verbosity,
      ...freshness,
    }));
  }
}

function parseFreshnessRequired(input: ToolInput): { ok: true; value: boolean } | { ok: false; message: string } {
  const value = optionalBoolean(input, "freshnessRequired");
  if (value === undefined && input.input["freshnessRequired"] !== undefined) {
    return { ok: false, message: "Invalid input: \"freshnessRequired\" must be a boolean" };
  }
  return { ok: true, value: value === true };
}

function parseOptionalBoundedNumber(
  input: ToolInput,
  key: string,
  maxValue: number,
  defaultValue?: number,
): { ok: true; value: number | undefined } | { ok: false; message: string } {
  if (input.input[key] === null) {
    return { ok: true, value: defaultValue };
  }
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
      errorCode: "network_policy_missing",
    };
  }

  if (domains.length > 0) {
    for (const domain of domains) {
      if (!policy.canAccess(domain)) {
        return { ok: false, message: `Domain access denied: ${domain}`, errorCode: "domain_denied" };
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
  domains: readonly string[],
): { readonly sources: readonly WebSourceMetadata[]; readonly postcondition: WebSearchDomainPostcondition } {
  const accepted: WebSourceMetadata[] = [];
  const rejectedSourceIds: string[] = [];
  for (const source of sources) {
    const normalizedUrl = normalizeWebUrl(source.url);
    if (
      !normalizedUrl.ok
      || (domains.length > 0 && !domains.some((domain) => domainMatches(normalizedUrl.hostname, domain)))
    ) {
      rejectedSourceIds.push(source.url);
      continue;
    }
    if (accepted.length >= maxResults) {
      continue;
    }
    accepted.push({
      url: normalizedUrl.url,
      ...(source.title ? { title: sanitizeWebText(source.title) } : {}),
      ...(source.snippet ? { snippet: sanitizeWebText(source.snippet) } : {}),
      ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
      ...(source.source ? { source: source.source } : {}),
      ...(source.relevanceScore !== undefined ? { relevanceScore: source.relevanceScore } : {}),
      ...(source.providerRank !== undefined ? { providerRank: source.providerRank } : {}),
      rank: accepted.length + 1,
    });
  }
  return {
    sources: accepted,
    postcondition: {
      enforcement: domains.length > 0 ? "strict" : "unrestricted",
      acceptedCount: accepted.length,
      rejectedCount: rejectedSourceIds.length,
      rejectedSourceIds,
    },
  };
}

function inferSingleProviderCapabilities(
  freshness: WebSearchFreshnessCapability | undefined,
): WebSearchProviderCapabilities {
  const provider = freshness?.provider ?? "unconfigured";
  const knownProvider = provider === "tavily" || provider === "brave";
  return {
    provider,
    recencyFilter: freshness?.recencyFilter ?? "unsupported",
    topics: knownProvider ? ["general", "news", "finance", "research"] : ["general"],
    absoluteDateRange: knownProvider,
    exactMatch: knownProvider,
    countryTargeting: knownProvider,
    languageTargeting: provider === "brave",
    highPrecisionSearch: knownProvider,
  };
}

function parseSearchIntent(
  input: ToolInput,
  defaults: {
    readonly freshnessRequired: boolean;
    readonly recencyDays?: number;
    readonly temporalEvidenceRequired: boolean;
  },
): {
  readonly ok: true;
  readonly intent: WebSearchIntent;
  readonly providerParameters: Partial<WebSearchProviderRequest>;
} | { readonly ok: false; readonly message: string } {
  const defaultTopic: WebSearchTopic = "general";
  const defaultQuality: WebSearchQuality = defaults.temporalEvidenceRequired ? "high" : "balanced";
  const topic = parseEnum(input.input["topic"], ["general", "news", "finance", "research"] as const, defaultTopic, "topic");
  if (!topic.ok) return topic;
  const quality = parseEnum(input.input["quality"], ["balanced", "high"] as const, defaultQuality, "quality");
  if (!quality.ok) return quality;
  const startDate = parseOptionalDate(input.input["startDate"], "startDate");
  if (!startDate.ok) return startDate;
  const endDate = parseOptionalDate(input.input["endDate"], "endDate");
  if (!endDate.ok) return endDate;
  if (startDate.value && endDate.value && startDate.value > endDate.value) {
    return { ok: false, message: 'Invalid input: "startDate" must not be after "endDate"' };
  }
  if (defaults.freshnessRequired && defaults.recencyDays === undefined && !startDate.value && !endDate.value) {
    return { ok: false, message: "Invalid input: freshnessRequired requires recencyDays, startDate, or endDate" };
  }
  const country = parseOptionalCountry(input.input["country"]);
  if (!country.ok) return country;
  const language = parseOptionalCode(input.input["language"], "language");
  if (!language.ok) return language;
  const exactPhrases = parseOptionalPhrases(input.input["exactPhrases"]);
  if (!exactPhrases.ok) return exactPhrases;
  const targetingRequired = optionalBoolean(input, "targetingRequired");
  if (targetingRequired === undefined && input.input["targetingRequired"] !== undefined) {
    return { ok: false, message: 'Invalid input: "targetingRequired" must be a boolean' };
  }

  const intent: WebSearchIntent = {
    topic: topic.value,
    quality: quality.value,
    freshnessRequired: defaults.freshnessRequired,
    targetingRequired: targetingRequired === true,
    ...(defaults.recencyDays !== undefined ? { recencyDays: defaults.recencyDays } : {}),
    ...(startDate.value ? { startDate: startDate.value } : {}),
    ...(endDate.value ? { endDate: endDate.value } : {}),
    ...(country.value ? { country: country.value } : {}),
    ...(language.value ? { language: language.value } : {}),
    ...(exactPhrases.value ? { exactPhrases: exactPhrases.value } : {}),
  };
  return {
    ok: true,
    intent,
    providerParameters: {
      ...(input.input["topic"] !== undefined || defaults.temporalEvidenceRequired ? { topic: topic.value } : {}),
      ...(input.input["quality"] !== undefined || defaults.temporalEvidenceRequired ? { quality: quality.value } : {}),
      ...(startDate.value ? { startDate: startDate.value } : {}),
      ...(endDate.value ? { endDate: endDate.value } : {}),
      ...(country.value ? { country: country.value } : {}),
      ...(language.value ? { language: language.value } : {}),
      ...(exactPhrases.value ? { exactPhrases: exactPhrases.value } : {}),
    },
  };
}

function projectProviderParameters(
  parameters: Partial<WebSearchProviderRequest>,
  capabilities: WebSearchProviderCapabilities,
  topic: WebSearchTopic,
): Partial<WebSearchProviderRequest> {
  const { country, language, ...supported } = parameters;
  const supportsCountry = capabilities.countryTargeting
    && (!capabilities.countryTargetingTopics || capabilities.countryTargetingTopics.includes(topic));
  return {
    ...supported,
    ...(country && supportsCountry ? { country } : {}),
    ...(language && capabilities.languageTargeting ? { language } : {}),
  };
}

function parseEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  defaultValue: T[number],
  field: string,
): { readonly ok: true; readonly value: T[number] } | { readonly ok: false; readonly message: string } {
  if (value === undefined || value === null) return { ok: true, value: defaultValue };
  if (typeof value !== "string" || !allowed.includes(value)) {
    return { ok: false, message: `Invalid input: "${field}" must be one of ${allowed.join(", ")}` };
  }
  return { ok: true, value };
}

function parseOptionalDate(
  value: unknown,
  field: string,
): { readonly ok: true; readonly value?: string } | { readonly ok: false; readonly message: string } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, message: `Invalid input: "${field}" must use YYYY-MM-DD` };
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return { ok: false, message: `Invalid input: "${field}" must be a real calendar date` };
  }
  return { ok: true, value };
}

function parseOptionalCode(
  value: unknown,
  field: string,
): { readonly ok: true; readonly value?: string } | { readonly ok: false; readonly message: string } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== "string" || !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{2,8})?$/.test(value)) {
    return { ok: false, message: `Invalid input: "${field}" must be a language or country code` };
  }
  return { ok: true, value: value.toLowerCase() };
}

function parseOptionalCountry(
  value: unknown,
): { readonly ok: true; readonly value?: string } | { readonly ok: false; readonly message: string } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== "string" || !/^[a-zA-Z]{2}$/.test(value)) {
    return { ok: false, message: 'Invalid input: "country" must be a two-letter ISO country code' };
  }
  return { ok: true, value: value.toLowerCase() };
}

function parseOptionalPhrases(
  value: unknown,
): { readonly ok: true; readonly value?: readonly string[] } | { readonly ok: false; readonly message: string } {
  if (value === undefined || value === null) return { ok: true };
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) {
    return { ok: false, message: 'Invalid input: "exactPhrases" must be an array containing 1 to 10 strings' };
  }
  const phrases: string[] = [];
  for (const phrase of value) {
    if (typeof phrase !== "string" || phrase.trim().length === 0 || phrase.length > 200) {
      return { ok: false, message: 'Invalid input: "exactPhrases" must contain non-empty strings up to 200 characters' };
    }
    phrases.push(phrase.trim());
  }
  return { ok: true, value: phrases };
}

function buildSearchMetadata(input: {
  readonly query: string;
  readonly domains: readonly string[];
  readonly recencyDays?: number;
  readonly freshnessRequired: boolean;
  readonly temporalRequirement?: TemporalEventEvidenceRequirement;
  readonly intent: WebSearchIntent;
  readonly response: WebSearchProviderResponse;
  readonly provider?: string;
  readonly sources: readonly WebSourceMetadata[];
  readonly postcondition: WebSearchDomainPostcondition;
  readonly temporalEvidence?: ReturnType<typeof evaluateWebSearchTemporalEvidence>;
  readonly attempts: readonly WebSearchProviderAttempt[];
  readonly verbosity: ToolOutputVerbosity;
}): WebToolResultMetadata<"web_search"> {
  const retrievedAt = input.response.retrievedAt ?? new Date().toISOString();
  return webToolMetadata("web_search", {
    operation: "search",
    ...(input.provider ? { provider: input.provider } : {}),
    query: input.query,
    domains: input.domains,
    ...(input.recencyDays !== undefined ? { recencyDays: input.recencyDays } : {}),
    ...(input.freshnessRequired ? { freshnessRequired: true, freshnessEnforcement: "enforced" as const } : {}),
    searchIntent: input.intent,
    resultCount: input.sources.length,
    retrievedAt,
    sources: input.sources,
    domainPostcondition: input.postcondition,
    providerAttempts: input.attempts,
    ...(input.response.requestId ? { providerRequestId: input.response.requestId } : {}),
    ...(input.response.durationMs !== undefined ? { providerDurationMs: input.response.durationMs } : {}),
    ...(input.response.usage ? { providerUsage: input.response.usage } : {}),
    ...(input.response.effectiveParameters ? { providerEffectiveParameters: input.response.effectiveParameters } : {}),
    ...(input.temporalRequirement ? { temporalRequirement: input.temporalRequirement } : {}),
    ...(input.temporalEvidence ? { temporalEvidence: input.temporalEvidence } : {}),
    verbosity: input.verbosity,
  });
}
