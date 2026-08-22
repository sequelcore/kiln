import {
  compareManagedEconomicAmounts,
  deriveManagedEconomicMinimumReservation,
  digestManagedEconomicValue,
  type ExecutionCatalog,
  type ManagedEconomicAmount,
  type ManagedEconomicComparableReservation,
  type ManagedEconomicScheme,
} from "@kilnai/core";
import type {
  KilnManagedAgentIntentConfig,
  KilnManagedAgentsConfig,
} from "../kiln-yaml-types.js";

/** Runtime-facing policy material derived from operator intent and current catalog evidence. */
export interface DerivedManagedAgentEconomicPolicy {
  readonly id: string;
  readonly revision: string;
  readonly evidenceRequirements: {
    readonly quota: "optional" | "required-for-account-bound";
    readonly price: "optional" | "required";
  };
  readonly noRouteAction: "deny";
  readonly comparisonDomains: readonly DerivedManagedAgentComparisonDomain[];
  readonly candidates: readonly DerivedManagedAgentCandidate[];
  readonly intentId: string;
  /** Fail-closed explanation when the bounded intent has no usable candidate. */
  readonly unavailableReason?: string;
}

export interface DerivedManagedAgentComparisonDomain {
  readonly id: string;
  readonly rank: number;
  readonly unit: string;
  readonly scheme: ManagedEconomicScheme;
  readonly rateCardBasis: string;
  readonly envelopeSemantics: string;
}

export interface DerivedManagedAgentCandidate {
  readonly targetId: string;
  readonly comparisonDomainId: string;
  readonly priorityRank: number;
  readonly worstCaseReservation: ManagedEconomicComparableReservation;
  readonly ceiling:
    | { readonly kind: "none" }
    | { readonly kind: "finite"; readonly amount: ManagedEconomicAmount };
}

/**
 * Derives the internal economic selection material for configured managed-agent
 * intent. The returned policy is ephemeral authority input; it must never be
 * serialized back into operator configuration.
 */
export function deriveManagedAgentEconomicPolicies(input: {
  readonly managedAgents?: KilnManagedAgentsConfig;
  readonly executionCatalog?: ExecutionCatalog;
  readonly defaultTargetId?: string;
  readonly targetEvidenceRevision?: string;
}): readonly DerivedManagedAgentEconomicPolicy[] {
  const intents = input.managedAgents?.intents ?? [];
  const routes = input.executionCatalog?.routes ?? [];
  return intents.map((intent) => deriveManagedAgentEconomicPolicy({
    intent,
    routes,
    accounts: input.executionCatalog?.accounts ?? [],
    accountPolicies: input.executionCatalog?.accountPolicies ?? [],
    defaultTargetId: input.defaultTargetId,
    targetEvidenceRevision: input.targetEvidenceRevision,
  }));
}

export function deriveManagedAgentEconomicPolicy(input: {
  readonly intent: KilnManagedAgentIntentConfig;
  readonly routes: ExecutionCatalog["routes"];
  readonly accounts?: ExecutionCatalog["accounts"];
  readonly accountPolicies?: ExecutionCatalog["accountPolicies"];
  readonly defaultTargetId?: string;
  readonly targetEvidenceRevision?: string;
}): DerivedManagedAgentEconomicPolicy {
  const { intent } = input;
  const accountById = new Map((input.accounts ?? []).map((account) => [account.id, account]));
  const accountPolicyById = new Map((input.accountPolicies ?? []).map((policy) => [policy.id, policy]));
  const routes = input.routes
    .filter((route) => route.accountSelection.mode === "automatic")
    .filter((route) => intent.target?.mode === "explicit"
      ? route.id === intent.target.targetId
      : route.id === input.defaultTargetId)
    .filter((route) => intent.model?.mode !== "explicit" || route.providerModelId === intent.model.modelId)
    .filter((route) => route.economics.fallbackPosture === "disabled" && route.economics.overagePosture === "disabled")
    .filter((route) => {
      if (route.accountSelection.mode !== "automatic") return false;
      const accountPolicy = accountPolicyById.get(route.accountSelection.accountPolicyId);
      if (!accountPolicy) return false;
      return accountPolicy.accountIds.every((accountId) => {
        const economics = accountById.get(accountId)?.economics;
        return economics !== undefined
          && economics.creditPosture === "disabled"
          && economics.overagePosture === "disabled";
      });
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const paidUsage = intent.paidUsage ?? "ask-before-spend";
  const cap = typeof paidUsage === "object" && paidUsage.kind === "cap" ? paidUsage.amount : undefined;
  const includedOnly = paidUsage === "included-only";

  const domains: DerivedManagedAgentComparisonDomain[] = [];
  const domainByKey = new Map<string, DerivedManagedAgentComparisonDomain>();
  const candidates: DerivedManagedAgentCandidate[] = [];
  const rejectedPaidRoutes: string[] = [];
  const rejectedReasons: string[] = [];
  for (const [priorityRank, route] of routes.entries()) {
    const price = route.economics.priceEvidence;
    if (includedOnly && price.kind !== "subscription" && price.kind !== "included" && price.kind !== "free") {
      rejectedPaidRoutes.push(route.id);
      continue;
    }
    const domain = domainForRoute(route.economics, price, domainByKey, domains);
    if (!domain) {
      if (cap !== undefined) {
        rejectedPaidRoutes.push(route.id);
        rejectedReasons.push(`Target '${route.id}' has heterogeneous or incomparable price evidence.`);
      }
      continue;
    }
    const reservation = reservationForRoute(route.economics, price, domain, cap);
    if (cap !== undefined) {
      if (reservation.kind !== "exact") {
        rejectedPaidRoutes.push(route.id);
        rejectedReasons.push(`Target '${route.id}' has ${price.kind} or unknown comparable economics; the cap cannot be enforced.`);
        continue;
      }
      if (reservation.amount.unit !== cap.unit || !sameScheme(reservation.amount.scheme, cap.scheme)) {
        rejectedPaidRoutes.push(route.id);
        rejectedReasons.push(`Target '${route.id}' uses an incompatible price unit or scheme for the cap.`);
        continue;
      }
      if (compareManagedEconomicAmounts(reservation.amount, cap) > 0) {
        rejectedPaidRoutes.push(route.id);
        continue;
      }
    }
    candidates.push({
      targetId: route.id,
      comparisonDomainId: domain.id,
      priorityRank,
      worstCaseReservation: reservation,
      ceiling: cap === undefined ? { kind: "none" } : { kind: "finite", amount: cap },
    });
  }

  const intentDigest = digestManagedEconomicValue({
    schema: "managed-agent-intent-economic-v1",
    intent,
    candidates: candidates.map((candidate) => ({
      targetId: candidate.targetId,
      comparisonDomainId: candidate.comparisonDomainId,
      worstCaseReservation: candidate.worstCaseReservation,
      ceiling: candidate.ceiling,
    })),
    rejectedPaidRoutes,
    rejectedReasons,
    relevantRouteEvidence: routes.map((route) => ({
      id: route.id,
      providerId: route.providerId,
      providerModelId: route.providerModelId,
      accountSelection: route.accountSelection,
      economics: route.economics,
    })),
    relevantAccountEvidence: routes.map((route) => {
      const policyId = route.accountSelection.mode === "automatic"
        ? route.accountSelection.accountPolicyId
        : undefined;
      const policy = policyId ? accountPolicyById.get(policyId) : undefined;
      return {
        routeId: route.id,
        policyId: policy?.id ?? null,
        accountIds: policy?.accountIds ?? [],
        accounts: (policy?.accountIds ?? []).map((accountId) => ({
          id: accountId,
          economics: accountById.get(accountId)?.economics ?? null,
        })),
      };
    }),
  });
  const unavailableReason = candidates.length === 0
    ? (cap !== undefined && rejectedReasons.length > 0
      ? `Managed agent '${intent.id}' has no target whose economics can enforce the configured monetary cap. ${rejectedReasons.join(" ")}`
      : `Managed agent '${intent.id}' has no admitted target with current account and economic evidence.`)
    : undefined;
  return {
    id: `managed-agent-intent:${intent.id}`,
    revision: intentDigest,
    // Bounded intent does not expose a quota policy knob. Unknown provider
    // allowance evidence may be projected as unknown and can still be
    // committed for an uncapped/ask-before-spend intent; finite monetary caps
    // are enforced solely from comparable price/reservation evidence below.
    evidenceRequirements: { quota: "optional", price: "required" },
    noRouteAction: "deny",
    comparisonDomains: domains,
    candidates,
    intentId: intent.id,
    ...(unavailableReason ? { unavailableReason } : {}),
  };
}

function domainForRoute(
  economics: ExecutionCatalog["routes"][number]["economics"],
  price: ExecutionCatalog["routes"][number]["economics"]["priceEvidence"],
  byKey: Map<string, DerivedManagedAgentComparisonDomain>,
  domains: DerivedManagedAgentComparisonDomain[],
): DerivedManagedAgentComparisonDomain | undefined {
  const firstPrice = "unitPrices" in price ? price.unitPrices[0]?.price : undefined;
  if ("unitPrices" in price && price.unitPrices.some((entry) =>
    entry.price.unit !== firstPrice?.unit || !sameScheme(entry.price.scheme, firstPrice?.scheme ?? { kind: "unit" }))) {
    return undefined;
  }
  const unit = firstPrice?.unit ?? "request";
  const scheme = firstPrice?.scheme ?? { kind: "unit" as const };
  const key = JSON.stringify([unit, scheme, economics.rateCardBasis, economics.envelopeSemantics]);
  const existing = byKey.get(key);
  if (existing) return existing;
  const domain: DerivedManagedAgentComparisonDomain = {
    id: `managed-domain:${digestManagedEconomicValue({ unit, scheme, rateCardBasis: economics.rateCardBasis, envelopeSemantics: economics.envelopeSemantics }).slice("sha256:".length, 24)}`,
    rank: domains.length,
    unit,
    scheme,
    rateCardBasis: economics.rateCardBasis,
    envelopeSemantics: economics.envelopeSemantics,
  };
  byKey.set(key, domain);
  domains.push(domain);
  return domain;
}

function reservationForRoute(
  economics: ExecutionCatalog["routes"][number]["economics"],
  price: ExecutionCatalog["routes"][number]["economics"]["priceEvidence"],
  domain: DerivedManagedAgentComparisonDomain,
  cap?: ManagedEconomicAmount,
): ManagedEconomicComparableReservation {
  if (price.kind === "free") {
    return {
      kind: "exact",
      amount: {
        atoms: "0",
        scale: 0,
        unit: cap?.unit ?? domain.unit,
        scheme: cap?.scheme ?? domain.scheme,
      },
    };
  }
  if (price.kind === "subscription") return { kind: "not-comparable", reason: "subscription-basis" };
  if (price.kind === "included") return { kind: "not-comparable", reason: "included-basis" };
  if (price.kind === "estimated") return { kind: "not-comparable", reason: "estimated-basis" };
  if (price.kind === "unknown") return { kind: "not-comparable", reason: "unknown-basis" };
  if (domain.scheme.kind === "unit") return { kind: "not-comparable", reason: "economic-basis-unavailable" };
  try {
    return {
      kind: "exact",
      amount: deriveManagedEconomicMinimumReservation({
        unitRates: price.unitPrices,
        usageLimits: economics.executionEnvelope.limits,
        auxiliaryCharges: economics.auxiliaryCharges,
        outputUnit: domain.unit,
        targetScheme: domain.scheme,
      }),
    };
  } catch {
    return { kind: "not-comparable", reason: "economic-basis-unavailable" };
  }
}

function sameScheme(left: ManagedEconomicScheme, right: ManagedEconomicScheme): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "unit") return true;
  if (left.kind === "currency" && right.kind === "currency") return left.currency === right.currency;
  if (left.kind === "credit" && right.kind === "credit") return left.creditSchemeId === right.creditSchemeId;
  return false;
}
