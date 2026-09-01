import type { ContextWindowAuthority } from "./context-usage-projection.js";

export type ProviderRequestObservedTokenQuantity =
  | { readonly tokens: number; readonly measurement: "estimated" | "provider_reported" }
  | { readonly measurement: "unknown" };

export interface ProviderRequestPhysicalRegionObservation {
  readonly source: "system" | "messages" | "tool_schema";
  readonly bytes: number;
  readonly measurement: "measured";
}

export interface ProviderRequestUnknownDispatchEvidence {
  readonly state: "unknown";
}

export interface ProviderRequestObservedDispatchEvidence<T> {
  readonly state: "observed";
  readonly value: T;
}

export interface ProviderRequestDispatchObservation {
  readonly attempt: ProviderRequestUnknownDispatchEvidence | ProviderRequestObservedDispatchEvidence<number>;
  readonly retry: ProviderRequestUnknownDispatchEvidence | ProviderRequestObservedDispatchEvidence<boolean>;
  readonly fallback: ProviderRequestUnknownDispatchEvidence;
  readonly outcome?: "completed" | "failed" | "response_received" | "unknown";
  readonly responseStatus?: number;
  readonly failurePhase?: "headers" | "first_byte" | "chunk_idle" | "transport";
}

export type ProviderRequestReconciliationObservation =
  | {
      readonly state: "estimated";
      readonly providerInputTokens: number;
      readonly attributedInputTokens: number;
      readonly unresolvedRemainderTokens: number;
      readonly reason: "provider_total_not_regionally_measured";
    }
  | {
      readonly state: "unknown";
      readonly providerInputTokens?: number;
      readonly reason: "regional_token_attribution_unavailable" | "provider_usage_unavailable";
    };

export type ModelRequestCapacityEvidence =
  | {
      readonly state: "capacity_unknown";
      readonly contextWindowTokens?: number;
      readonly contextWindowAuthority: ContextWindowAuthority;
      readonly reason:
        | "request_token_estimate_unavailable"
        | "context_capacity_unavailable"
        | "output_reserve_unavailable";
    }
  | {
      readonly state: "within_capacity" | "overflow";
      readonly measurement: "estimated";
      readonly contextWindowTokens: number;
      readonly contextWindowAuthority: ContextWindowAuthority;
      readonly estimatedInputTokens: number;
      readonly outputReserveTokens: number;
      readonly estimatedTotalTokens: number;
      readonly estimatedRemainingTokens: number;
      readonly overflow: boolean;
    };

export interface ProviderRequestObservation {
  readonly version: "v1";
  readonly requestIndex: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly routeId?: string;
  readonly deliberation:
    | {
        readonly state: "observed";
        readonly status: "exact" | "defaulted" | "clamped";
        readonly selectedLevel: string;
      }
    | { readonly state: "unknown" };
  readonly authority:
    | {
        readonly state: "observed";
        readonly requestedAuthority: "planning" | "auto" | "read_only" | "audited" | "destructive";
        readonly admittedAuthority: "fail_closed" | "read_only" | "idempotent" | "audited" | "destructive" | "unknown";
        readonly completeness: "authoritative" | "partial";
      }
    | { readonly state: "unknown" };
  readonly dispatch: ProviderRequestDispatchObservation;
  readonly usage: {
    readonly input: ProviderRequestObservedTokenQuantity;
    readonly output: ProviderRequestObservedTokenQuantity;
    readonly cacheRead: ProviderRequestObservedTokenQuantity;
    readonly cacheWrite: ProviderRequestObservedTokenQuantity;
  };
  readonly physicalRegions: readonly ProviderRequestPhysicalRegionObservation[];
  readonly regionalTokenAttribution?: readonly {
    readonly source: "required_prompt" | "governed_context" | "tool_schema" | "conversation" | "tool_result";
    readonly tokens: number;
    readonly measurement: "estimated";
  }[];
  readonly reconciliation: ProviderRequestReconciliationObservation;
  readonly capacity: ModelRequestCapacityEvidence;
  readonly cache: {
    readonly partitionIdentity: { readonly state: "unknown" };
    readonly regions: readonly {
      readonly source: "tool_schema" | "system" | "messages";
      readonly stability: "stable" | "volatile";
      readonly bytes: number;
      readonly includedInStablePrefix: boolean;
    }[];
    readonly readTokens?: number;
    readonly writeTokens?: number;
    readonly measurement: "estimated" | "provider_reported" | "unknown";
  };
  readonly toolCount: number;
  readonly effectivePrompt?: {
    readonly version: "v1";
    readonly estimatedTokens: number;
    readonly componentCount: number;
    readonly componentScopeCounts: {
      readonly static: number;
      readonly dynamic: number;
      readonly deferred: number;
    };
  };
  readonly conversationProjection?: {
    readonly policyId: "tool-result-clearing-v1";
    readonly originalToolResultCount: number;
    readonly projectedToolResultCount: number;
    readonly originalToolResultTokens: number;
    readonly projectedToolResultTokens: number;
    readonly clearedToolResultCount: number;
    readonly overflow: boolean;
  };
}
