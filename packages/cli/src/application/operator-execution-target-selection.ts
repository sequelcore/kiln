import {
  admitOperatorExecutionIntent,
  defineExecutionTargetCatalog,
  type ExecutionPriceEvidenceConfig,
  type ExecutionTargetCatalog,
} from "@kilnai/core";
import type {
  ExecutionTargetCost,
  ExecutionTargetReasonCode,
  ExecutionTargetSelectionIntent,
} from "@kilnai/gateway-contracts";
import type {
  OperatorExecutionTargetCatalogEntry,
  OperatorExecutionTargetSelectionPort,
} from "@kilnai/runtime";
import { getGuiProviderMetadata } from "@kilnai/gateway-contracts";
import { readGlobalExecutionTargetCatalog, type KilnGlobalConfig } from "../config/global-config.js";

export interface OperatorExecutionTargetAccountAvailability {
  readonly accountId: string;
  readonly available: boolean;
  readonly reasonCodes: readonly ExecutionTargetReasonCode[];
}

export function createOperatorExecutionTargetSelectionPort(input: {
  readonly readConfigSnapshot: () => { readonly config: KilnGlobalConfig | null; readonly revision: string };
  readonly readExecutionTargetCatalog?: (config: KilnGlobalConfig | null) => ExecutionTargetCatalog | undefined;
  readonly resolveAccountAvailability: (input: {
    readonly admission: ReturnType<typeof admitOperatorExecutionIntent>;
    readonly catalog: ExecutionTargetCatalog;
    readonly configurationRevision: { readonly revisionSetId: string; readonly revisions: Readonly<Record<string, string>> };
  }) => Promise<readonly OperatorExecutionTargetAccountAvailability[]>;
}): OperatorExecutionTargetSelectionPort {
  const readCatalog = (config: KilnGlobalConfig | null): ExecutionTargetCatalog => {
    const configured = (input.readExecutionTargetCatalog ?? readGlobalExecutionTargetCatalog)(config);
    return defineExecutionTargetCatalog(configured ?? { accounts: [], accountPolicies: [], targets: [] });
  };

  return {
    getTargets: async () => {
      const snapshot = input.readConfigSnapshot();
      return projectTargets(readCatalog(snapshot.config), input.resolveAccountAvailability, snapshot.revision);
    },
    admit: async (intent: ExecutionTargetSelectionIntent) => {
      const snapshot = input.readConfigSnapshot();
      const catalog = readCatalog(snapshot.config);
      let admitted: ReturnType<typeof admitOperatorExecutionIntent>;
      try {
        admitted = admitOperatorExecutionIntent(catalog, intent);
      } catch (error) {
        const configured = catalog.targets.some((target) => target.id === intent.targetId);
        return configured && intent.accountOverrideId !== undefined
          ? {
              ok: false,
              reasonCode: "account-unavailable",
              reason: error instanceof Error ? error.message : "Execution account admission failed.",
              repairActions: ["check-account", "refresh-model-catalog"],
            }
          : {
              ok: false,
              reasonCode: "target-not-configured",
              reason: `Execution target '${intent.targetId}' is not configured.`,
              repairActions: ["review-target-configuration"],
            };
      }

      let availability: readonly OperatorExecutionTargetAccountAvailability[];
      try {
        availability = await input.resolveAccountAvailability({
          admission: admitted,
          catalog,
          configurationRevision: { revisionSetId: snapshot.revision, revisions: { global: snapshot.revision } },
        });
      } catch (error) {
        return {
          ok: false,
          reasonCode: "target-evidence-pending",
          reason: error instanceof Error ? error.message : "Execution target availability could not be resolved.",
          repairActions: ["refresh-model-catalog"],
        };
      }

      const admittedAccountIds = admitted.accountSelection.kind === "policy"
        ? admitted.accountSelection.eligibleAccountIds
        : [admitted.accountSelection.accountId];
      const admittedAccounts = admittedAccountIds.map((accountId) =>
        availability.find((account) => account.accountId === accountId)
        ?? { accountId, available: false, reasonCodes: ["missing-credentials"] as const });
      if (!admittedAccounts.some((account) => account.available)) {
        const reasonCodes = targetReasonCodes(admittedAccounts);
        return {
          ok: false,
          reasonCode: reasonCodes[0] ?? "target-evidence-pending",
          reason: `Execution target '${intent.targetId}' is unavailable.`,
          repairActions: repairActionsFor(reasonCodes),
        };
      }
      return {
        ok: true,
        admission: {
          targetId: admitted.targetId,
          providerId: admitted.providerId,
          providerModelId: admitted.providerModelId,
        },
      };
    },
  };
}

export function resolveOperatorStartupExecutionTarget(
  config: KilnGlobalConfig,
  catalog: ExecutionTargetCatalog = readGlobalExecutionTargetCatalog(config)
    ?? defineExecutionTargetCatalog({ accounts: [], accountPolicies: [], targets: [] }),
) {
  const targetId = config.ui?.targetSelection?.targetId ?? config.targetRouting?.defaultTargetId;
  const target = catalog.targets.find((candidate) => candidate.id === targetId);
  if (!target) throw new Error("No configured execution target is available for the operator surface.");
  return target;
}

async function projectTargets(
  catalog: ExecutionTargetCatalog,
  resolveAccountAvailability: (input: {
    readonly admission: ReturnType<typeof admitOperatorExecutionIntent>;
    readonly catalog: ExecutionTargetCatalog;
    readonly configurationRevision: { readonly revisionSetId: string; readonly revisions: Readonly<Record<string, string>> };
  }) => Promise<readonly OperatorExecutionTargetAccountAvailability[]>,
  revision: string,
): Promise<readonly OperatorExecutionTargetCatalogEntry[]> {
  const availabilityByTarget = new Map<string, readonly OperatorExecutionTargetAccountAvailability[]>();
  const unresolvedTargets = new Set<string>();
  for (const target of catalog.targets) {
    try {
      const admission = admitOperatorExecutionIntent(catalog, { targetId: target.id });
      availabilityByTarget.set(target.id, await resolveAccountAvailability({
        admission,
        catalog,
        configurationRevision: { revisionSetId: revision, revisions: { global: revision } },
      }));
    } catch {
      availabilityByTarget.set(target.id, []);
      unresolvedTargets.add(target.id);
    }
  }

  return catalog.targets.map((target): OperatorExecutionTargetCatalogEntry => {
    const policy = catalog.accountPolicies.find((candidate) => candidate.id === target.accountPolicyId);
    const configuredAccountIds = policy?.accountIds ?? [];
    const accountAvailability = availabilityByTarget.get(target.id) ?? [];
    const executableAccountIds = configuredAccountIds.filter((accountId) =>
      accountAvailability.some((account) => account.accountId === accountId && account.available));
    const unavailableAccounts = configuredAccountIds
      .map((accountId) => accountAvailability.find((account) => account.accountId === accountId)
        ?? { accountId, available: false, reasonCodes: ["missing-credentials"] as const })
      .filter((account) => !account.available);
    if (unresolvedTargets.has(target.id)) {
      return {
        targetId: target.id,
        label: target.label,
        providerId: target.providerId,
        providerModelId: target.providerModelId,
        access: getGuiProviderMetadata(target.providerId)?.access ?? "api",
        availability: "unresolved",
        reasonCodes: ["target-health-unknown"],
        repairActions: ["retry-target", "refresh-model-catalog"],
        eligibleAccountCount: 0,
        accountOverrideIds: [],
        cost: projectCost(target.economics.priceEvidence),
      };
    }
    const available = executableAccountIds.length > 0;
    const reasonCodes = available ? [] : targetReasonCodes(unavailableAccounts);
    return {
      targetId: target.id,
      label: target.label,
      providerId: target.providerId,
      providerModelId: target.providerModelId,
      access: getGuiProviderMetadata(target.providerId)?.access ?? "api",
      availability: available ? "available" : "unavailable",
      reasonCodes,
      repairActions: available ? [] : repairActionsFor(reasonCodes),
      eligibleAccountCount: executableAccountIds.length,
      accountOverrideIds: executableAccountIds,
      cost: projectCost(target.economics.priceEvidence),
    };
  });
}

function projectCost(price: ExecutionPriceEvidenceConfig): ExecutionTargetCost {
  if (price.kind === "subscription" || price.kind === "included" || price.kind === "free") {
    return { kind: price.kind };
  }
  if (price.kind === "unknown") return { kind: "unknown", reason: price.reason };
  if (price.kind === "estimated") return { kind: "unknown", reason: "Estimated pricing is not comparable." };

  const currency = price.unitPrices[0]?.price.scheme.kind === "currency"
    ? price.unitPrices[0].price.scheme.currency
    : undefined;
  if (!currency || price.unitPrices.some((unit) =>
    unit.price.scheme.kind !== "currency" || unit.price.scheme.currency !== currency)) {
    return { kind: "unknown", reason: "Target pricing uses non-comparable units." };
  }
  const amount = (unit: string): number | undefined => {
    const value = price.unitPrices.find((candidate) => candidate.usageUnit === unit)?.price;
    if (!value) return undefined;
    return Number(value.atoms) / (10 ** value.scale);
  };
  return {
    kind: "metered",
    currency,
    ...(amount("input-token") !== undefined ? { inputPerMillion: amount("input-token")! * 1_000_000 } : {}),
    ...(amount("output-token") !== undefined ? { outputPerMillion: amount("output-token")! * 1_000_000 } : {}),
    ...(amount("cached-input-token") !== undefined ? { cachedInputPerMillion: amount("cached-input-token")! * 1_000_000 } : {}),
  };
}

function targetReasonCodes(accounts: readonly OperatorExecutionTargetAccountAvailability[]): readonly ExecutionTargetReasonCode[] {
  const codes = [...new Set(accounts.flatMap((account) => account.reasonCodes))];
  return codes.length > 0 ? codes : ["account-unavailable"];
}

function repairActionsFor(reasonCodes: readonly ExecutionTargetReasonCode[]) {
  if (reasonCodes.includes("missing-credentials") || reasonCodes.includes("credential-unavailable")) {
    return ["authenticate-provider", "check-account", "refresh-model-catalog"] as const;
  }
  if (reasonCodes.includes("provider-unavailable")) {
    return ["check-provider", "retry-target", "refresh-model-catalog"] as const;
  }
  if (reasonCodes.includes("quota-exhausted") || reasonCodes.includes("account-capacity-exhausted")) {
    return ["select-another-model", "retry-target", "refresh-model-catalog"] as const;
  }
  return ["check-account", "refresh-model-catalog"] as const;
}
