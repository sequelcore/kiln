import type { ProviderRequestObservation } from "../packages/core/src/events/provider-request-observation.js";

/**
 * The collector adds this ordinal only when it merges multi-turn envelopes.
 * All other fields are the canonical Core observation projected by Runtime.
 */
export type ContextEfficiencyProviderRequestEvidence = ProviderRequestObservation & {
  readonly collectorTurnIndex?: number;
};

/**
 * Rebuilds the allowlisted, content-free subset of a canonical provider
 * observation. Extra fields are never copied into benchmark artifacts.
 */
export function projectContextEfficiencyProviderEvidence(
  value: unknown,
): ContextEfficiencyProviderRequestEvidence {
  const record = object(value, "provider request observation");
  const output = {
    version: literal(record.version, ["v1"], "provider request version"),
    requestIndex: nonNegativeInteger(record.requestIndex, "provider request index"),
    providerId: text(record.providerId, "provider identity"),
    modelId: text(record.modelId, "model identity"),
    ...(record.routeId === undefined ? {} : { routeId: text(record.routeId, "route identity") }),
    ...(record.managedInvocation === undefined ? {} : { managedInvocation: managedInvocation(record.managedInvocation) }),
    deliberation: deliberation(record.deliberation),
    authority: authority(record.authority),
    dispatch: dispatch(record.dispatch),
    usage: usage(record.usage),
    physicalRegions: array(record.physicalRegions, "physical regions")
      .map((entry, index) => physicalRegion(entry, `physical region ${index}`)),
    ...(record.regionalTokenAttribution === undefined ? {} : {
      regionalTokenAttribution: array(record.regionalTokenAttribution, "regional token attribution")
        .map((entry, index) => regionalTokenAttribution(entry, `regional token attribution ${index}`)),
    }),
    reconciliation: reconciliation(record.reconciliation),
    capacity: capacity(record.capacity),
    cache: cache(record.cache),
    toolCount: nonNegativeInteger(record.toolCount, "tool count"),
    ...(record.effectivePrompt === undefined ? {} : { effectivePrompt: effectivePrompt(record.effectivePrompt) }),
    ...(record.conversationProjection === undefined
      ? {} : { conversationProjection: conversationProjection(record.conversationProjection) }),
    ...(record.collectorTurnIndex === undefined
      ? {} : { collectorTurnIndex: nonNegativeInteger(record.collectorTurnIndex, "collector turn index") }),
  };
  return output as ContextEfficiencyProviderRequestEvidence;
}

/**
 * A provider attempt is settled only when its canonical dispatch observation
 * has a numbered attempt and a terminal transport outcome. Token measurements
 * may still be unknown and are accounted for separately.
 */
export function hasSettledContextEfficiencyProviderEvidence(requests: readonly unknown[]): boolean {
  return requests.every((request) => {
    try {
      const projected = projectContextEfficiencyProviderEvidence(request);
      const attempt = projected.dispatch.attempt;
      return attempt.state === "observed"
        && Number.isSafeInteger(attempt.value)
        && attempt.value >= 0
        && (projected.dispatch.outcome === "completed"
          || projected.dispatch.outcome === "failed"
          || projected.dispatch.outcome === "response_received");
    } catch {
      return false;
    }
  });
}

function managedInvocation(value: unknown): object {
  const record = object(value, "managed invocation");
  return {
    invocationId: text(record.invocationId, "managed invocation id"),
    childSessionId: text(record.childSessionId, "managed child session id"),
    childTurnId: text(record.childTurnId, "managed child turn id"),
  };
}

function deliberation(value: unknown): object {
  const record = object(value, "deliberation evidence");
  if (record.state === "unknown") return { state: "unknown" };
  return {
    state: literal(record.state, ["observed"], "deliberation state"),
    status: literal(record.status, ["exact", "defaulted", "clamped"], "deliberation status"),
    selectedLevel: text(record.selectedLevel, "deliberation level"),
  };
}

function authority(value: unknown): object {
  const record = object(value, "authority evidence");
  if (record.state === "unknown") return { state: "unknown" };
  return {
    state: literal(record.state, ["observed"], "authority state"),
    requestedAuthority: literal(record.requestedAuthority, ["planning", "auto", "read_only", "audited", "destructive"], "requested authority"),
    admittedAuthority: literal(record.admittedAuthority, ["fail_closed", "read_only", "idempotent", "audited", "destructive", "unknown"], "admitted authority"),
    completeness: literal(record.completeness, ["authoritative", "partial"], "authority completeness"),
  };
}

function dispatch(value: unknown): object {
  const record = object(value, "dispatch evidence");
  return {
    attempt: dispatchValue(record.attempt, "dispatch attempt", "number"),
    retry: dispatchValue(record.retry, "dispatch retry", "boolean"),
    fallback: unknownState(record.fallback, "fallback evidence"),
    ...(record.outcome === undefined ? {} : {
      outcome: literal(record.outcome, ["completed", "failed", "response_received", "unknown"], "dispatch outcome"),
    }),
    ...(record.responseStatus === undefined ? {} : { responseStatus: nonNegativeInteger(record.responseStatus, "response status") }),
    ...(record.failurePhase === undefined ? {} : {
      failurePhase: literal(record.failurePhase, ["headers", "first_byte", "chunk_idle", "transport"], "transport failure phase"),
    }),
  };
}

function dispatchValue(value: unknown, label: string, valueType: "number" | "boolean"): object {
  const record = object(value, label);
  if (record.state === "unknown") return { state: "unknown" };
  const candidate = record.value;
  if (valueType === "number") return {
    state: literal(record.state, ["observed"], `${label} state`),
    value: nonNegativeInteger(candidate, `${label} value`),
  };
  if (typeof candidate !== "boolean") throw new Error(`${label} value must be boolean.`);
  return { state: literal(record.state, ["observed"], `${label} state`), value: candidate };
}

function unknownState(value: unknown, label: string): object {
  const record = object(value, label);
  return { state: literal(record.state, ["unknown"], `${label} state`) };
}

function usage(value: unknown): object {
  const record = object(value, "usage evidence");
  return {
    input: tokenQuantity(record.input, "input usage"),
    output: tokenQuantity(record.output, "output usage"),
    cacheRead: tokenQuantity(record.cacheRead, "cache read usage"),
    cacheWrite: tokenQuantity(record.cacheWrite, "cache write usage"),
  };
}

function tokenQuantity(value: unknown, label: string): object {
  const record = object(value, label);
  if (record.measurement === "unknown") return { measurement: "unknown" };
  return {
    tokens: nonNegativeInteger(record.tokens, `${label} tokens`),
    measurement: literal(record.measurement, ["estimated", "provider_reported"], `${label} measurement`),
  };
}

function physicalRegion(value: unknown, label: string): object {
  const record = object(value, label);
  return {
    source: literal(record.source, ["system", "messages", "tool_schema"], `${label} source`),
    bytes: nonNegativeInteger(record.bytes, `${label} bytes`),
    measurement: literal(record.measurement, ["measured"], `${label} measurement`),
  };
}

function regionalTokenAttribution(value: unknown, label: string): object {
  const record = object(value, label);
  return {
    source: literal(record.source, ["required_prompt", "governed_context", "tool_schema", "conversation", "tool_result"], `${label} source`),
    tokens: nonNegativeInteger(record.tokens, `${label} tokens`),
    measurement: literal(record.measurement, ["estimated"], `${label} measurement`),
  };
}

function reconciliation(value: unknown): object {
  const record = object(value, "reconciliation evidence");
  if (record.state === "estimated") return {
    state: "estimated",
    providerInputTokens: nonNegativeInteger(record.providerInputTokens, "provider input tokens"),
    attributedInputTokens: nonNegativeInteger(record.attributedInputTokens, "attributed input tokens"),
    unresolvedRemainderTokens: nonNegativeInteger(record.unresolvedRemainderTokens, "unresolved tokens"),
    reason: literal(record.reason, ["provider_total_not_regionally_measured"], "reconciliation reason"),
  };
  return {
    state: literal(record.state, ["unknown"], "reconciliation state"),
    ...(record.providerInputTokens === undefined ? {} : {
      providerInputTokens: nonNegativeInteger(record.providerInputTokens, "provider input tokens"),
    }),
    reason: literal(record.reason, ["regional_token_attribution_unavailable", "provider_usage_unavailable"], "reconciliation reason"),
  };
}

function capacity(value: unknown): object {
  const record = object(value, "capacity evidence");
  if (record.state === "capacity_unknown") return {
    state: "capacity_unknown",
    ...(record.contextWindowTokens === undefined ? {} : {
      contextWindowTokens: nonNegativeInteger(record.contextWindowTokens, "context window tokens"),
    }),
    contextWindowAuthority: literal(record.contextWindowAuthority, ["provider_reported", "runtime_observed", "inferred", "unknown"], "context window authority"),
    reason: literal(record.reason, ["request_token_estimate_unavailable", "context_capacity_unavailable", "output_reserve_unavailable"], "capacity reason"),
  };
  return {
    state: literal(record.state, ["within_capacity", "overflow"], "capacity state"),
    measurement: literal(record.measurement, ["estimated"], "capacity measurement"),
    contextWindowTokens: nonNegativeInteger(record.contextWindowTokens, "context window tokens"),
    contextWindowAuthority: literal(record.contextWindowAuthority, ["provider_reported", "runtime_observed", "inferred", "unknown"], "context window authority"),
    estimatedInputTokens: nonNegativeInteger(record.estimatedInputTokens, "estimated input tokens"),
    outputReserveTokens: nonNegativeInteger(record.outputReserveTokens, "output reserve tokens"),
    estimatedTotalTokens: nonNegativeInteger(record.estimatedTotalTokens, "estimated total tokens"),
    estimatedRemainingTokens: nonNegativeInteger(record.estimatedRemainingTokens, "estimated remaining tokens"),
    overflow: boolean(record.overflow, "capacity overflow"),
  };
}

function cache(value: unknown): object {
  const record = object(value, "cache evidence");
  const partition = object(record.partitionIdentity, "cache partition identity");
  return {
    partitionIdentity: partition.state === "unknown" ? { state: "unknown" } : {
      state: literal(partition.state, ["observed"], "cache partition state"),
      hash: digest(partition.hash, "cache partition hash"),
    },
    regions: array(record.regions, "cache regions").map((entry, index) => cacheRegion(entry, `cache region ${index}`)),
    ...(record.readTokens === undefined ? {} : { readTokens: nonNegativeInteger(record.readTokens, "cache read tokens") }),
    ...(record.writeTokens === undefined ? {} : { writeTokens: nonNegativeInteger(record.writeTokens, "cache write tokens") }),
    measurement: literal(record.measurement, ["estimated", "provider_reported", "unknown"], "cache measurement"),
  };
}

function cacheRegion(value: unknown, label: string): object {
  const record = object(value, label);
  return {
    source: literal(record.source, ["tool_schema", "system", "messages"], `${label} source`),
    stability: literal(record.stability, ["stable", "volatile"], `${label} stability`),
    bytes: nonNegativeInteger(record.bytes, `${label} bytes`),
    includedInStablePrefix: boolean(record.includedInStablePrefix, `${label} stable prefix`),
  };
}

function effectivePrompt(value: unknown): object {
  const record = object(value, "effective prompt evidence");
  const scopes = object(record.componentScopeCounts, "effective prompt scope counts");
  return {
    version: literal(record.version, ["v1"], "effective prompt version"),
    estimatedTokens: nonNegativeInteger(record.estimatedTokens, "effective prompt tokens"),
    componentCount: nonNegativeInteger(record.componentCount, "effective prompt component count"),
    componentScopeCounts: {
      static: nonNegativeInteger(scopes.static, "static component count"),
      dynamic: nonNegativeInteger(scopes.dynamic, "dynamic component count"),
      deferred: nonNegativeInteger(scopes.deferred, "deferred component count"),
    },
  };
}

function conversationProjection(value: unknown): object {
  const record = object(value, "conversation projection evidence");
  return {
    policyId: literal(record.policyId, ["tool-result-clearing-v1"], "conversation projection policy"),
    originalToolResultCount: nonNegativeInteger(record.originalToolResultCount, "original tool result count"),
    projectedToolResultCount: nonNegativeInteger(record.projectedToolResultCount, "projected tool result count"),
    originalToolResultTokens: nonNegativeInteger(record.originalToolResultTokens, "original tool result tokens"),
    projectedToolResultTokens: nonNegativeInteger(record.projectedToolResultTokens, "projected tool result tokens"),
    clearedToolResultCount: nonNegativeInteger(record.clearedToolResultCount, "cleared tool result count"),
    overflow: boolean(record.overflow, "conversation projection overflow"),
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function literal<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${label} is unsupported.`);
  return value as T;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function digest(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^sha256:[a-f0-9]{64}$/iu.test(result)) throw new Error(`${label} must be a SHA-256 digest.`);
  return result;
}
