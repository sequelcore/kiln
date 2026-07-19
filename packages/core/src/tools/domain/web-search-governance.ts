import type { WebSearchFreshnessCapability } from "./temporal-evidence.js";

export type WebSearchTopic = "general" | "news" | "finance" | "research";
export type WebSearchQuality = "balanced" | "high";

export interface WebSearchIntent {
  readonly topic: WebSearchTopic;
  readonly quality: WebSearchQuality;
  readonly freshnessRequired: boolean;
  readonly targetingRequired: boolean;
  readonly recencyDays?: number;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly country?: string;
  readonly language?: string;
  readonly exactPhrases?: readonly string[];
}

export interface WebSearchProviderCapabilities extends WebSearchFreshnessCapability {
  readonly topics: readonly WebSearchTopic[];
  readonly absoluteDateRange: boolean;
  readonly exactMatch: boolean;
  readonly countryTargeting: boolean;
  readonly countryTargetingTopics?: readonly WebSearchTopic[];
  readonly languageTargeting: boolean;
  readonly highPrecisionSearch: boolean;
}

export interface WebSearchProviderRegistration<TSearch> {
  readonly id: string;
  readonly search: TSearch;
  readonly capabilities: WebSearchProviderCapabilities;
}

export type WebSearchProviderAttemptOutcome =
  | "accepted"
  | "capability_rejected"
  | "provider_failed"
  | "contract_rejected"
  | "evidence_rejected"
  | "empty";

export interface WebSearchProviderAttempt {
  readonly providerId: string;
  readonly provider: string;
  readonly outcome: WebSearchProviderAttemptOutcome;
  readonly unmetCapabilities?: readonly string[];
  readonly errorCode?: string;
  readonly requestId?: string;
  readonly durationMs?: number;
  readonly providerStatus?: number;
  readonly candidateCount?: number;
  readonly acceptedCount?: number;
  readonly rejectedCount?: number;
  readonly rejectedSourceIds?: readonly string[];
  readonly omittedPreferences?: readonly string[];
}

export interface WebSearchRecoveryDirective {
  readonly kind: "progressive_web_research";
  readonly action: "broaden_search";
  readonly constraintPolicy: "relax_only_agent_added";
  readonly preserveTemporalRequirement: true;
  readonly nextActions: readonly ["broaden_search", "extract_candidates"];
}

export interface WebSearchDomainPostcondition {
  readonly enforcement: "strict" | "unrestricted";
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly rejectedSourceIds: readonly string[];
}

export function findUnmetWebSearchCapabilities(
  intent: WebSearchIntent,
  capabilities: WebSearchProviderCapabilities,
): readonly string[] {
  const unmet: string[] = [];
  if (intent.freshnessRequired && capabilities.recencyFilter !== "enforced") {
    unmet.push("recency");
  }
  if (!capabilities.topics.includes(intent.topic)) {
    unmet.push(`topic:${intent.topic}`);
  }
  if (intent.quality === "high" && !capabilities.highPrecisionSearch) {
    unmet.push("quality:high");
  }
  if ((intent.startDate || intent.endDate) && !capabilities.absoluteDateRange) {
    unmet.push("absolute_date_range");
  }
  if ((intent.exactPhrases?.length ?? 0) > 0 && !capabilities.exactMatch) {
    unmet.push("exact_match");
  }
  if (intent.targetingRequired && intent.country && (
    !capabilities.countryTargeting
    || (capabilities.countryTargetingTopics && !capabilities.countryTargetingTopics.includes(intent.topic))
  )) {
    unmet.push("country_targeting");
  }
  if (intent.targetingRequired && intent.language && !capabilities.languageTargeting) {
    unmet.push("language_targeting");
  }
  return unmet;
}

export function findUnsupportedWebSearchPreferences(
  intent: WebSearchIntent,
  capabilities: WebSearchProviderCapabilities,
): readonly string[] {
  if (intent.targetingRequired) return [];
  const unsupported: string[] = [];
  if (intent.country && (
    !capabilities.countryTargeting
    || (capabilities.countryTargetingTopics && !capabilities.countryTargetingTopics.includes(intent.topic))
  )) {
    unsupported.push("country_targeting");
  }
  if (intent.language && !capabilities.languageTargeting) {
    unsupported.push("language_targeting");
  }
  return unsupported;
}
