import { createHash } from "node:crypto";
import {
  createAccountRef,
  type ModelGatewayAccountCandidate,
  type ModelGatewayAccountConfig,
  type ModelGatewayAccountHealth,
  type ModelGatewayRoute,
  type ModelGatewayVirtualModelConfig,
  type ProviderUsageSnapshot,
} from "@kilnai/core";

export interface ModelGatewayExecutionAccountIdentity {
  readonly credentialId: string;
  readonly fileIdentity: string;
  readonly revision: string;
}

export interface ModelGatewayAccountBinding {
  readonly accountId: string;
  readonly providerId: string;
  readonly credentialId: string;
  readonly execution: ModelGatewayExecutionAccountIdentity;
}

export function createModelGatewayCredentialRevisionId(
  binding: Pick<ModelGatewayAccountBinding, "providerId" | "credentialId" | "execution">,
): string {
  const hash = createHash("sha256");
  for (const value of [
    binding.providerId,
    binding.credentialId,
    binding.execution.fileIdentity,
    binding.execution.revision,
  ]) {
    const bytes = Buffer.from(value, "utf8");
    hash.update(`${bytes.byteLength}:`);
    hash.update(bytes);
    hash.update(";");
  }
  return hash.digest("hex");
}

export interface ModelGatewayBoundCandidate {
  readonly binding: ModelGatewayAccountBinding;
  readonly candidate: ModelGatewayAccountCandidate;
  readonly usageEvidence: ModelGatewayBoundUsageEvidence;
  readonly capacity: { readonly maxConcurrency: number; readonly reservedAffinitySlots: number };
}

export interface ModelGatewayBoundUsageEvidence {
  readonly health: ModelGatewayAccountHealth;
  readonly freshness: "fresh" | "stale" | "missing";
  readonly availability?: ProviderUsageSnapshot["availability"];
  readonly observedAt?: string;
  readonly validUntil?: string;
  readonly source?: ProviderUsageSnapshot["source"];
  readonly confidence?: ProviderUsageSnapshot["confidence"];
}

export interface BuildModelGatewayBoundCandidatesInput {
  readonly virtualModel: ModelGatewayVirtualModelConfig;
  readonly accounts: readonly ModelGatewayAccountConfig[];
  readonly executionAccounts: readonly ModelGatewayExecutionAccountIdentity[];
  readonly usage: readonly ProviderUsageSnapshot[];
  readonly now?: Date;
  readonly configureCapacity?: (accountRef: ModelGatewayAccountCandidate["account"], capacity: { readonly maxConcurrency: number; readonly reservedAffinitySlots: number }) => void;
  readonly pressure: (accountRef: ModelGatewayAccountCandidate["account"]) => number;
  readonly reservedForNewWork: (accountRef: ModelGatewayAccountCandidate["account"]) => boolean;
}

export function createModelGatewayBoundAccountRef(
  account: Pick<ModelGatewayAccountConfig, "id">,
  execution: ModelGatewayExecutionAccountIdentity,
): ModelGatewayAccountCandidate["account"] {
  return createAccountRef(`configured:${account.id}:${execution.fileIdentity}:${execution.revision}`);
}

/** Resolves only explicit virtual-model account bindings; ambient credentials are never candidates. */
export function buildModelGatewayBoundCandidates(
  input: BuildModelGatewayBoundCandidatesInput,
): readonly ModelGatewayBoundCandidate[] {
  const route: ModelGatewayRoute = {
    providerId: input.virtualModel.providerId,
    providerModelId: input.virtualModel.providerModelId,
    scope: `virtual:${input.virtualModel.id}`,
  };
  const configs = new Map(input.accounts.map((account) => [account.id, account]));
  const seenCredentials = new Set<string>();
  return Object.freeze(input.virtualModel.accountIds.flatMap((accountId) => {
    const config = configs.get(accountId);
    if (config === undefined) throw new Error(`Virtual model '${input.virtualModel.id}' references unknown account '${accountId}'.`);
    if (config.providerId !== input.virtualModel.providerId) {
      throw new Error(`Virtual model '${input.virtualModel.id}' account '${accountId}' has an incompatible provider.`);
    }
    if (seenCredentials.has(config.credentialId)) {
      throw new Error(`Virtual model '${input.virtualModel.id}' binds credential '${config.credentialId}' more than once.`);
    }
    seenCredentials.add(config.credentialId);
    const execution = input.executionAccounts.find((entry) => entry.credentialId === config.credentialId);
    if (execution === undefined) return [];
    const account = createModelGatewayBoundAccountRef(config, execution);
    const capacity = Object.freeze({ maxConcurrency: config.maxConcurrency, reservedAffinitySlots: config.reservedAffinitySlots });
    input.configureCapacity?.(account, capacity);
    const usage = input.usage.find((entry) => entry.provider === config.providerId && entry.credentialId === config.credentialId);
    const usageEvidence = deriveUsageHealth(usage, input.now ?? new Date());
    return [{
      binding: Object.freeze({ accountId: config.id, providerId: config.providerId, credentialId: config.credentialId, execution }),
      candidate: Object.freeze({
        account,
        route,
        health: usageEvidence.health,
        leaseCapacity: "available",
        pressure: input.pressure(account),
        reservedForNewWork: input.reservedForNewWork(account),
      }),
      usageEvidence,
      capacity,
    }];
  }));
}

function deriveUsageHealth(usage: ProviderUsageSnapshot | undefined, now: Date): ModelGatewayBoundUsageEvidence {
  if (usage === undefined) return Object.freeze({ health: "healthy", freshness: "missing" });
  const observedAt = Date.parse(usage.observedAt);
  const validUntil = Date.parse(usage.validUntil);
  const freshness = Number.isFinite(observedAt) && Number.isFinite(validUntil) && observedAt <= now.getTime() && validUntil > now.getTime()
    ? "fresh" as const
    : "stale" as const;
  return Object.freeze({
    health: freshness === "fresh" && usage.availability === "exhausted" ? "unhealthy" : "healthy",
    freshness,
    availability: usage.availability,
    observedAt: usage.observedAt,
    validUntil: usage.validUntil,
    source: usage.source,
    confidence: usage.confidence,
  });
}
