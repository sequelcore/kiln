export interface TurnTemporalContextInput {
  readonly observedAt: string;
  readonly timeZone: string;
}

export interface TurnTemporalContext extends TurnTemporalContextInput {
  readonly localDate: string;
}

export interface TemporalEvidenceRequirement {
  readonly exactLocalDate?: string;
  readonly requiredIdentityTerms?: readonly string[];
  readonly maximumAgeMs?: number;
}

export interface TemporalEventEvidenceRequirement {
  readonly exactLocalDate: string;
  readonly requiredIdentityTerms: readonly string[];
  readonly eventStatus: "completed";
  readonly minimumIndependentSources: number;
}

export interface WebTemporalEvidenceSource {
  readonly url: string;
  readonly title?: string;
  readonly snippet?: string;
}

export interface TemporalEvidenceObservation {
  readonly sourceId: string;
  readonly retrievedAt: string;
  readonly eventLocalDate?: string;
  readonly identityTerms?: readonly string[];
}

export type TemporalEvidenceRejectionReason =
  | "evidence_missing"
  | "event_date_mismatch"
  | "identity_mismatch"
  | "evidence_stale"
  | "event_not_completed"
  | "independent_source_consensus_missing";

export interface TemporalEvidenceDecision {
  readonly accepted: boolean;
  readonly reason?: TemporalEvidenceRejectionReason;
  readonly acceptedSourceIds: readonly string[];
  readonly rejectedSourceIds: readonly string[];
}

export interface WebSearchFreshnessCapability {
  readonly provider: string;
  readonly recencyFilter: "enforced" | "ignored" | "unsupported";
}

export interface WebSearchFreshnessRequirement {
  readonly required: boolean;
}

export type WebSearchFreshnessDecision =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: "freshness_not_enforced" };

export function defineTurnTemporalContext(input: TurnTemporalContextInput): TurnTemporalContext {
  const observedAt = requireCanonicalTimestamp(input.observedAt, "Turn temporal context observedAt is invalid");
  const timeZone = requireTimeZone(input.timeZone);
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(observedAt));
  const part = (type: string): string => {
    const value = dateParts.find((entry) => entry.type === type)?.value;
    if (!value) throwTemporalEvidenceError("Unable to derive the operator-local date");
    return value;
  };
  return {
    observedAt,
    timeZone,
    localDate: `${part("year")}-${part("month")}-${part("day")}`,
  };
}

export function parseExplicitEventLocalDate(value: string): string | undefined {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/u.exec(value);
  if (iso) return validLocalDate(`${iso[1]}-${iso[2]}-${iso[3]}`);

  const normalized = normalizeEvidenceText(value);
  const monthAliases = new Map<string, number>();
  MONTH_NAMES.forEach((aliases, index) => aliases.forEach((alias) => monthAliases.set(alias, index + 1)));
  const monthPattern = [...monthAliases.keys()].sort((left, right) => right.length - left.length).join("|");
  const dayFirst = new RegExp(`\\b(\\d{1,2}) (?:de )?(${monthPattern}) (?:de )?(\\d{4})\\b`, "u").exec(normalized);
  if (dayFirst) return validLocalDate(localDate(dayFirst[3]!, monthAliases.get(dayFirst[2]!)!, dayFirst[1]!));
  const monthFirst = new RegExp(`\\b(${monthPattern}) (\\d{1,2}) (\\d{4})\\b`, "u").exec(normalized);
  if (monthFirst) return validLocalDate(localDate(monthFirst[3]!, monthAliases.get(monthFirst[1]!)!, monthFirst[2]!));
  return undefined;
}

export function evaluateTemporalEvidence(input: {
  readonly context: TurnTemporalContext;
  readonly requirement: TemporalEvidenceRequirement;
  readonly observations: readonly TemporalEvidenceObservation[];
}): TemporalEvidenceDecision {
  const context = defineTurnTemporalContext(input.context);
  const exactLocalDate = input.requirement.exactLocalDate;
  if (exactLocalDate !== undefined) requireLocalDate(exactLocalDate, "Temporal evidence exactLocalDate is invalid");
  const requiredIdentityTerms = uniqueNormalizedTerms(input.requirement.requiredIdentityTerms ?? []);
  const maximumAgeMs = input.requirement.maximumAgeMs;
  if (maximumAgeMs !== undefined && (!Number.isFinite(maximumAgeMs) || maximumAgeMs < 0)) {
    throwTemporalEvidenceError("Temporal evidence maximumAgeMs must be a non-negative finite number");
  }

  if (input.observations.length === 0) {
    return { accepted: false, reason: "evidence_missing", acceptedSourceIds: [], rejectedSourceIds: [] };
  }

  const acceptedSourceIds: string[] = [];
  const rejectedSourceIds: string[] = [];
  let firstReason: TemporalEvidenceRejectionReason | undefined;
  for (const observation of input.observations) {
    const sourceId = requireText(observation.sourceId, "Temporal evidence sourceId is required");
    const retrievedAt = requireCanonicalTimestamp(observation.retrievedAt, "Temporal evidence retrievedAt is invalid");
    const rejection = observationRejection({
      context,
      exactLocalDate,
      requiredIdentityTerms,
      maximumAgeMs,
      observation,
      retrievedAt,
    });
    if (rejection) {
      rejectedSourceIds.push(sourceId);
      firstReason ??= rejection;
    } else {
      acceptedSourceIds.push(sourceId);
    }
  }

  return acceptedSourceIds.length > 0
    ? { accepted: true, acceptedSourceIds, rejectedSourceIds }
    : { accepted: false, reason: firstReason ?? "evidence_missing", acceptedSourceIds, rejectedSourceIds };
}

export function resolveWebSearchFreshnessCapability(
  capability: WebSearchFreshnessCapability,
  requirement: WebSearchFreshnessRequirement,
): WebSearchFreshnessDecision {
  requireText(capability.provider, "Web search provider is required");
  if (!requirement.required || capability.recencyFilter === "enforced") return { accepted: true };
  return { accepted: false, reason: "freshness_not_enforced" };
}

export function evaluateWebSearchTemporalEvidence(input: {
  readonly requirement: TemporalEventEvidenceRequirement;
  readonly retrievedAt: string;
  readonly sources: readonly WebTemporalEvidenceSource[];
}): TemporalEvidenceDecision {
  requireCanonicalTimestamp(input.retrievedAt, "Web temporal evidence retrievedAt is invalid");
  requireLocalDate(input.requirement.exactLocalDate, "Web temporal evidence exactLocalDate is invalid");
  const requiredIdentityTerms = uniqueNormalizedTerms(input.requirement.requiredIdentityTerms);
  if (requiredIdentityTerms.length < 2) {
    throwTemporalEvidenceError("Web temporal evidence requires at least two identity terms");
  }
  if (!Number.isInteger(input.requirement.minimumIndependentSources) || input.requirement.minimumIndependentSources < 2) {
    throwTemporalEvidenceError("Web temporal evidence minimumIndependentSources must be an integer of at least 2");
  }

  const acceptedSourceIds: string[] = [];
  const rejectedSourceIds: string[] = [];
  const acceptedHosts = new Set<string>();
  for (const source of input.sources) {
    const sourceId = requireText(source.url, "Web temporal evidence source URL is required");
    const text = normalizeEvidenceText(`${source.title ?? ""} ${source.snippet ?? ""}`);
    const host = evidenceHost(sourceId);
    const semanticallyBound = evidenceSupportsCompletedEvent(text, input.requirement.exactLocalDate, requiredIdentityTerms);
    if (host && semanticallyBound && !acceptedHosts.has(host)) {
      acceptedHosts.add(host);
      acceptedSourceIds.push(sourceId);
    } else {
      rejectedSourceIds.push(sourceId);
    }
  }

  if (acceptedHosts.size < input.requirement.minimumIndependentSources) {
    return {
      accepted: false,
      reason: "independent_source_consensus_missing",
      acceptedSourceIds,
      rejectedSourceIds,
    };
  }
  return { accepted: true, acceptedSourceIds, rejectedSourceIds };
}

export function parseTemporalEventEvidenceRequirement(
  value: unknown,
): { readonly ok: true; readonly value: TemporalEventEvidenceRequirement | undefined }
  | { readonly ok: false; readonly message: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, message: "Invalid input: temporalRequirement must be an object" };
  }
  const record = value as Record<string, unknown>;
  const exactLocalDate = typeof record.exactLocalDate === "string" ? record.exactLocalDate.trim() : "";
  const terms = Array.isArray(record.requiredIdentityTerms)
    ? record.requiredIdentityTerms.filter((term): term is string => typeof term === "string" && term.trim().length > 0).map((term) => term.trim())
    : [];
  const uniqueTerms = [...new Map(terms.map((term) => [normalizeEvidenceText(term), term] as const)).values()];
  const minimum = record.minimumIndependentSources;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(exactLocalDate)
    || uniqueTerms.length < 2
    || uniqueTerms.some((term) => normalizeEvidenceText(term).length < 2)
    || record.eventStatus !== "completed"
    || typeof minimum !== "number"
    || !Number.isInteger(minimum)
    || minimum < 2) {
    return { ok: false, message: "Invalid input: temporalRequirement requires exactLocalDate, at least two identity terms, completed status, and at least two independent sources" };
  }
  return {
    ok: true,
    value: {
      exactLocalDate,
      requiredIdentityTerms: uniqueTerms,
      eventStatus: "completed",
      minimumIndependentSources: minimum,
    },
  };
}

function observationRejection(input: {
  readonly context: TurnTemporalContext;
  readonly exactLocalDate: string | undefined;
  readonly requiredIdentityTerms: readonly string[];
  readonly maximumAgeMs: number | undefined;
  readonly observation: TemporalEvidenceObservation;
  readonly retrievedAt: string;
}): TemporalEvidenceRejectionReason | undefined {
  if (input.exactLocalDate !== undefined && input.observation.eventLocalDate !== input.exactLocalDate) {
    return "event_date_mismatch";
  }
  const observationTerms = uniqueNormalizedTerms(input.observation.identityTerms ?? []);
  if (input.requiredIdentityTerms.some((term) => !observationTerms.includes(term))) return "identity_mismatch";
  if (input.maximumAgeMs !== undefined && Date.parse(input.retrievedAt) < Date.parse(input.context.observedAt) - input.maximumAgeMs) {
    return "evidence_stale";
  }
  return undefined;
}

function requireCanonicalTimestamp(value: string, message: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throwTemporalEvidenceError(message);
  return value;
}

function requireTimeZone(value: string): string {
  const timeZone = requireText(value, "Turn temporal context timeZone is required");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throwTemporalEvidenceError(`Turn temporal context timeZone is invalid: ${timeZone}`);
  }
  return timeZone;
}

function requireLocalDate(value: string, message: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throwTemporalEvidenceError(message);
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (parsed.toISOString().slice(0, 10) !== value) throwTemporalEvidenceError(message);
}

function localDate(year: string, month: number, day: string): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
}

function validLocalDate(value: string): string | undefined {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

function requireText(value: string, message: string): string {
  const text = value.trim();
  if (!text) throwTemporalEvidenceError(message);
  return text;
}

function uniqueNormalizedTerms(terms: readonly string[]): readonly string[] {
  return [...new Set(terms.map((term) => requireText(term, "Temporal evidence identity term is required").toLocaleLowerCase("en-US")))];
}

const MONTH_NAMES = [
  ["january", "enero", "jan", "ene"],
  ["february", "febrero", "feb"],
  ["march", "marzo", "mar"],
  ["april", "abril", "apr", "abr"],
  ["may", "mayo"],
  ["june", "junio", "jun"],
  ["july", "julio", "jul"],
  ["august", "agosto", "aug", "ago"],
  ["september", "septiembre", "sep", "sept"],
  ["october", "octubre", "oct"],
  ["november", "noviembre", "nov"],
  ["december", "diciembre", "dec", "dic"],
] as const;

function normalizeEvidenceText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ").trim();
}

function evidenceDateCandidates(localDate: string): readonly string[] {
  const [year, month, day] = localDate.split("-");
  if (!year || !month || !day) return [];
  const dayNumber = String(Number(day));
  const monthNumber = String(Number(month));
  const names = MONTH_NAMES[Number(month) - 1] ?? [];
  return [
    normalizeEvidenceText(localDate),
    `${dayNumber} ${monthNumber} ${year}`,
    `${monthNumber} ${dayNumber} ${year}`,
    ...names.flatMap((name) => [
      `${dayNumber} ${name} ${year}`,
      `${dayNumber} de ${name} ${year}`,
      `${dayNumber} de ${name} de ${year}`,
      `${name} ${dayNumber} ${year}`,
    ]),
  ];
}

function evidenceSupportsCompletedEvent(text: string, localDate: string, identityTerms: readonly string[]): boolean {
  if (/\b(programado|scheduled|se jugara|will play|en vivo|live|sin resultado final|no final result)\b/u.test(text)) {
    return false;
  }
  const completion = /\b(resultado final|final score|full time|finalizado|terminado|marcador final)\b/u.exec(text);
  if (!completion) return false;
  const identityPositions = identityTerms.map((term) => evidenceTermIndex(text, normalizeEvidenceText(term)));
  if (identityPositions.some((position) => position < 0)) return false;
  const datePositions = evidenceDateCandidates(localDate).map((candidate) => text.indexOf(candidate)).filter((position) => position >= 0);
  return datePositions.some((datePosition) => {
    const positions = [completion.index, datePosition, ...identityPositions];
    return Math.max(...positions) - Math.min(...positions) <= 600;
  });
}

function evidenceTermIndex(text: string, term: string): number {
  return ` ${text} `.indexOf(` ${term} `);
}

function evidenceHost(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^(?:www|m)\./u, "");
  } catch {
    return undefined;
  }
}

function throwTemporalEvidenceError(message: string): never {
  throw new Error(message);
}
