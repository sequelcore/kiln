import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Type, type Static, type TObject, type TProperties } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  defineExecutionTargetCatalog,
  defineExecutionTargetDataPolicyEvidence,
  type ExecutionAccountPolicy,
  type ExecutionAccountEconomicsConfig,
  type ExecutionTargetCatalog,
  type ExecutionDataClassification,
  type ExecutionTargetDataPolicyEvidence,
  type ExecutionTargetEconomicsConfig,
} from "@kilnai/core";

export const EXECUTION_TARGET_EVIDENCE_VERSION = 1 as const;

const CANONICAL_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$";
const SHA256_PATTERN = "^sha256:[a-f0-9]{64}$";

function strictObject<T extends TProperties>(properties: T): TObject<T> {
  return Type.Object(properties, { additionalProperties: false });
}

const canonicalId = Type.String({ pattern: CANONICAL_ID_PATTERN });
const nonEmptyText = Type.String({ minLength: 1 });
const sha256 = Type.String({ pattern: SHA256_PATTERN });
const timestamp = Type.String({ minLength: 1 });
const classification = Type.Union([
  Type.Literal("public"),
  Type.Literal("internal"),
  Type.Literal("confidential"),
  Type.Literal("restricted"),
]);
const economicScheme = Type.Union([
  strictObject({ kind: Type.Literal("unit") }),
  strictObject({ kind: Type.Literal("currency"), currency: canonicalId }),
  strictObject({ kind: Type.Literal("credit"), creditSchemeId: canonicalId }),
]);
const economicAmount = strictObject({
  atoms: Type.String({ pattern: "^(?:0|[1-9][0-9]*)$" }),
  scale: Type.Integer({ minimum: 0, maximum: 30 }),
  unit: canonicalId,
  scheme: economicScheme,
});
const economicEvidence = strictObject({
  sourceIdentity: nonEmptyText,
  sourceRevision: nonEmptyText,
  sourceDigest: sha256,
  observedAt: timestamp,
  validUntil: timestamp,
  confidence: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
  authority: Type.Union([
    Type.Literal("provider-reported"),
    Type.Literal("configured"),
    Type.Literal("calculated-estimate"),
  ]),
});
const unitPrice = strictObject({ usageUnit: canonicalId, price: economicAmount });
const priceBase = {
  rateCardId: canonicalId,
  rateCardRevision: canonicalId,
  evidence: economicEvidence,
};
const priceEvidence = Type.Union([
  strictObject({ kind: Type.Literal("subscription"), ...priceBase }),
  strictObject({ kind: Type.Literal("included"), allowanceId: canonicalId, ...priceBase }),
  strictObject({ kind: Type.Literal("free"), ...priceBase }),
  strictObject({ kind: Type.Literal("metered"), unitPrices: Type.Array(unitPrice), ...priceBase }),
  strictObject({ kind: Type.Literal("unknown"), reason: nonEmptyText, ...priceBase }),
  strictObject({
    kind: Type.Literal("estimated"),
    estimationMethod: canonicalId,
    unitPrices: Type.Array(unitPrice),
    ...priceBase,
  }),
]);
const dataPolicyEvidence = strictObject({
  providerId: canonicalId,
  providerModelId: nonEmptyText,
  dataUse: Type.Union([Type.Literal("not-used"), Type.Literal("service-operation")]),
  trainingPosture: Type.Union([Type.Literal("prohibited"), Type.Literal("permitted")]),
  retention: strictObject({
    posture: Type.Union([Type.Literal("zero"), Type.Literal("bounded")]),
    days: Type.Integer({ minimum: 0, maximum: 3650 }),
  }),
  permittedMaximumClassification: classification,
  permittedClassifications: Type.Array(classification, { minItems: 1, maxItems: 4, uniqueItems: true }),
  sourceIdentity: canonicalId,
  sourceRevision: canonicalId,
  sourceDigest: sha256,
  observedAt: timestamp,
  expiresAt: timestamp,
});
const discoveryEvidence = strictObject({
  providerId: canonicalId,
  providerRouteId: nonEmptyText,
  providerModelId: nonEmptyText,
  evidenceIdentity: nonEmptyText,
  evidenceRevision: sha256,
  observedAt: timestamp,
  expiresAt: timestamp,
});
const accountEvidence = strictObject({
  accountId: canonicalId,
  providerId: canonicalId,
  economics: strictObject({
    capacityIdentity: canonicalId,
    subscriptionClass: Type.Union([
      Type.Literal("subscription"),
      Type.Literal("included"),
      Type.Literal("free"),
      Type.Literal("metered"),
      Type.Literal("unknown"),
    ]),
    quotaClassId: canonicalId,
  }),
});
const directTargetEvidence = strictObject({
  targetId: canonicalId,
  kind: Type.Literal("direct"),
  discovery: discoveryEvidence,
  dataPolicyEvidence,
  economics: strictObject({
    adapterCapabilityId: canonicalId,
    adapterCapabilityVersion: canonicalId,
    rateCardBasis: canonicalId,
    envelopeSemantics: canonicalId,
    contextClass: canonicalId,
    cacheClass: canonicalId,
    priceEvidence,
    auxiliaryCharges: Type.Array(strictObject({ id: canonicalId, amount: economicAmount })),
  }),
});
const harnessTargetEvidence = strictObject({
  targetId: canonicalId,
  kind: Type.Literal("harness"),
  discovery: discoveryEvidence,
  dataPolicyEvidence,
  limitations: Type.Optional(Type.Array(nonEmptyText)),
});

export const EXECUTION_TARGET_EVIDENCE_SCHEMA = strictObject({
  version: Type.Literal(EXECUTION_TARGET_EVIDENCE_VERSION),
  accounts: Type.Array(accountEvidence),
  targets: Type.Array(Type.Union([directTargetEvidence, harnessTargetEvidence])),
});

type DeepReadonly<T> = T extends readonly unknown[]
  ? ReadonlyArray<DeepReadonly<T[number]>>
  : T extends Readonly<Record<PropertyKey, unknown>>
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type ExecutionTargetEvidenceRevision = `sha256:${string}`;
type EconomicAmount = DeepReadonly<Static<typeof economicAmount>>;
type ManagedDiscoveryEvidence = {
  readonly providerId: string;
  readonly providerRouteId: string;
  readonly providerModelId: string;
  readonly evidenceIdentity: string;
  readonly evidenceRevision: ExecutionTargetEvidenceRevision;
  readonly observedAt: string;
  readonly expiresAt: string;
};
export interface ExecutionAccountManagedEvidence {
  readonly accountId: string;
  readonly providerId: string;
  readonly economics: Pick<
    ExecutionAccountEconomicsConfig,
    "capacityIdentity" | "subscriptionClass" | "quotaClassId"
  >;
}
export interface DirectExecutionTargetEvidence {
  readonly targetId: string;
  readonly kind: "direct";
  readonly discovery: ManagedDiscoveryEvidence;
  readonly dataPolicyEvidence: ExecutionTargetDataPolicyEvidence;
  readonly economics: Pick<
    ExecutionTargetEconomicsConfig,
    | "adapterCapabilityId"
    | "adapterCapabilityVersion"
    | "rateCardBasis"
    | "envelopeSemantics"
    | "contextClass"
    | "cacheClass"
    | "priceEvidence"
    | "auxiliaryCharges"
  >;
}
export interface HarnessExecutionTargetEvidence {
  readonly targetId: string;
  readonly kind: "harness";
  readonly discovery: ManagedDiscoveryEvidence;
  readonly dataPolicyEvidence: ExecutionTargetDataPolicyEvidence;
  readonly limitations?: readonly string[];
}
export interface ExecutionTargetEvidenceSnapshot {
  readonly version: typeof EXECUTION_TARGET_EVIDENCE_VERSION;
  readonly accounts: readonly ExecutionAccountManagedEvidence[];
  readonly targets: readonly (DirectExecutionTargetEvidence | HarnessExecutionTargetEvidence)[];
}

export interface ExecutionAccountIntent {
  readonly id: string;
  readonly providerId: string;
  readonly credentialId: string;
  readonly maxConcurrency: number;
  readonly reservedAffinitySlots: number;
  readonly economics: {
    readonly creditPosture: "disabled" | "committed";
    readonly overagePosture: "disabled" | "committed";
  };
}

export interface DirectExecutionTargetIntent {
  readonly id: string;
  readonly kind: "direct";
  readonly label: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly accountPolicyId: string;
  readonly dataClassification: ExecutionDataClassification;
  readonly economics: {
    readonly authBillingChannel: string;
    readonly executionMode: string;
    readonly serviceTier: string;
    readonly fallbackPosture: "disabled" | "committed";
    readonly overagePosture: "disabled" | "committed";
    readonly executionEnvelope: {
      readonly limits: readonly EconomicAmount[];
    };
  };
}

export interface HarnessExecutionTargetIntent {
  readonly id: string;
  readonly kind: "harness";
  readonly label: string;
  readonly providerId: string;
  readonly providerModelId: string;
  readonly dataClassification: ExecutionDataClassification;
  readonly remoteHarness?: {
    readonly invokeUrl: string;
    readonly cancelUrl: string;
    readonly authTokenEnv?: string;
  };
  readonly externalRuntimeAttachment?: {
    readonly runtimeId: string;
    readonly attachmentId: string;
  };
}

export interface ExecutionTargetCatalogIntent {
  readonly evidenceRevision: ExecutionTargetEvidenceRevision;
  readonly accounts: readonly ExecutionAccountIntent[];
  readonly accountPolicies: readonly ExecutionAccountPolicy[];
  readonly targets: readonly (DirectExecutionTargetIntent | HarnessExecutionTargetIntent)[];
}

export function defineExecutionTargetEvidenceSnapshot(value: unknown): ExecutionTargetEvidenceSnapshot {
  if (!Value.Check(EXECUTION_TARGET_EVIDENCE_SCHEMA, value)) {
    const error = [...Value.Errors(EXECUTION_TARGET_EVIDENCE_SCHEMA, value)][0];
    throw new Error(`Invalid execution-target managed evidence at ${error?.path || "/"}: ${error?.message ?? "invalid value"}.`);
  }
  const snapshot = value as ExecutionTargetEvidenceSnapshot;
  uniqueIds(snapshot.accounts.map(({ accountId }) => accountId), "account evidence");
  uniqueIds(snapshot.targets.map(({ targetId }) => targetId), "target evidence");
  for (const target of snapshot.targets) {
    validTimestamp(target.discovery.observedAt, `targets.${target.targetId}.discovery.observedAt`);
    validTimestamp(target.discovery.expiresAt, `targets.${target.targetId}.discovery.expiresAt`);
    if (Date.parse(target.discovery.expiresAt) <= Date.parse(target.discovery.observedAt)) {
      throw new Error(`Execution target '${target.targetId}' discovery evidence expiresAt must follow observedAt.`);
    }
    defineExecutionTargetDataPolicyEvidence(target.dataPolicyEvidence);
    if (target.kind === "direct") {
      validTimestamp(target.economics.priceEvidence.evidence.observedAt, `targets.${target.targetId}.economics.priceEvidence.evidence.observedAt`);
      validTimestamp(target.economics.priceEvidence.evidence.validUntil, `targets.${target.targetId}.economics.priceEvidence.evidence.validUntil`);
    }
  }
  return deepFreeze(canonicalizeSnapshot(snapshot));
}

export function executionTargetEvidenceRevision(value: unknown): ExecutionTargetEvidenceRevision {
  const snapshot = defineExecutionTargetEvidenceSnapshot(value);
  return `sha256:${createHash("sha256").update(serializeSnapshot(snapshot)).digest("hex")}`;
}

/**
 * Proves that a replacement snapshot renews observation provenance only. A
 * renewal may move discovery identity/provenance and timestamps forward, but
 * it cannot change accounts, provider/model identity, data-policy meaning, or
 * economic meaning.
 */
export function assertExecutionTargetEvidenceRenewal(
  currentValue: unknown,
  renewedValue: unknown,
): void {
  const current = defineExecutionTargetEvidenceSnapshot(currentValue);
  const renewed = defineExecutionTargetEvidenceSnapshot(renewedValue);
  const currentMaterial = renewalAuthorityMaterial(current);
  const renewedMaterial = renewalAuthorityMaterial(renewed);
  if (JSON.stringify(currentMaterial) !== JSON.stringify(renewedMaterial)) {
    throw new Error("Execution-target evidence renewal changes authority-bearing material.");
  }
  if (executionTargetEvidenceRevision(current) === executionTargetEvidenceRevision(renewed)) {
    throw new Error("Execution-target evidence renewal must publish a new observation revision.");
  }
}

function renewalAuthorityMaterial(snapshot: ExecutionTargetEvidenceSnapshot): unknown {
  return {
    version: snapshot.version,
    accounts: snapshot.accounts,
    targets: snapshot.targets.map((target) => {
      const discovery = {
        providerId: target.discovery.providerId,
        providerModelId: target.discovery.providerModelId,
      };
      const {
        sourceIdentity: _dataPolicySourceIdentity,
        sourceRevision: _dataPolicySourceRevision,
        sourceDigest: _dataPolicySourceDigest,
        observedAt: _dataPolicyObservedAt,
        expiresAt: _dataPolicyExpiresAt,
        ...dataPolicy
      } = target.dataPolicyEvidence;
      if (target.kind === "harness") {
        return {
          targetId: target.targetId,
          kind: target.kind,
          discovery,
          dataPolicy,
          ...(target.limitations ? { limitations: target.limitations } : {}),
        };
      }
      const { evidence: _priceSourceEvidence, ...priceEvidence } = target.economics.priceEvidence;
      return {
        targetId: target.targetId,
        kind: target.kind,
        discovery,
        dataPolicy,
        economics: { ...target.economics, priceEvidence },
      };
    }),
  };
}

export function executionTargetEvidencePath(input: {
  readonly globalConfigPath: string;
  readonly revision: ExecutionTargetEvidenceRevision;
}): string {
  requireRevision(input.revision);
  return join(dirname(input.globalConfigPath), "evidence", "execution-targets", `${input.revision.slice("sha256:".length)}.json`);
}

export function writeExecutionTargetEvidenceSnapshot(input: {
  readonly globalConfigPath: string;
  readonly snapshot: unknown;
}): {
  readonly revision: ExecutionTargetEvidenceRevision;
  readonly path: string;
  readonly created: boolean;
} {
  const snapshot = defineExecutionTargetEvidenceSnapshot(input.snapshot);
  const revision = executionTargetEvidenceRevision(snapshot);
  const path = executionTargetEvidencePath({ globalConfigPath: input.globalConfigPath, revision });
  if (existsSync(path)) {
    readExecutionTargetEvidenceSnapshot({ globalConfigPath: input.globalConfigPath, revision });
    return { revision, path, created: false };
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, serializeSnapshot(snapshot), { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, path);
    readExecutionTargetEvidenceSnapshot({ globalConfigPath: input.globalConfigPath, revision });
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return { revision, path, created: true };
}

export function readExecutionTargetEvidenceSnapshot(input: {
  readonly globalConfigPath: string;
  readonly revision: ExecutionTargetEvidenceRevision;
}): ExecutionTargetEvidenceSnapshot {
  const path = executionTargetEvidencePath(input);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Execution-target managed evidence '${input.revision}' is unavailable.`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Execution-target managed evidence '${input.revision}' is not valid JSON.`, { cause: error });
  }
  const snapshot = defineExecutionTargetEvidenceSnapshot(parsed);
  if (executionTargetEvidenceRevision(snapshot) !== input.revision) {
    throw new Error(`Execution-target managed evidence digest mismatch after admission: ${input.revision}.`);
  }
  return snapshot;
}

export function projectExecutionTargetCatalogFromIntent(
  intent: ExecutionTargetCatalogIntent,
  evidenceValue: unknown,
  evidenceRevision: ExecutionTargetEvidenceRevision,
  options: { readonly now?: Date } = {},
): ExecutionTargetCatalog {
  const evidence = defineExecutionTargetEvidenceSnapshot(evidenceValue);
  const actualRevision = executionTargetEvidenceRevision(evidence);
  if (actualRevision !== evidenceRevision || intent.evidenceRevision !== evidenceRevision) {
    throw new Error(`Execution target evidence revision mismatch: intent=${intent.evidenceRevision}, supplied=${evidenceRevision}, actual=${actualRevision}.`);
  }
  const accountEvidence = exactEvidenceMap(
    intent.accounts.map(({ id }) => id),
    evidence.accounts,
    ({ accountId }) => accountId,
    "account",
  );
  const targetEvidence = exactEvidenceMap(
    intent.targets.map(({ id }) => id),
    evidence.targets,
    ({ targetId }) => targetId,
    "target",
  );
  const now = (options.now ?? new Date()).getTime();
  const accounts = intent.accounts.map((account) => {
    const managed = accountEvidence.get(account.id)!;
    if (managed.providerId !== account.providerId) {
      throw new Error(`Execution account '${account.id}' managed evidence provider mismatch.`);
    }
    return {
      ...account,
      economics: { ...managed.economics, ...account.economics },
    };
  });
  const targets = intent.targets.flatMap((target) => {
    const managed = targetEvidence.get(target.id)!;
    if (managed.kind !== target.kind) {
      throw new Error(`Execution target '${target.id}' managed evidence kind mismatch.`);
    }
    assertTargetEvidenceIdentity(target, managed);
    assertFresh(managed.discovery.expiresAt, now, `Execution target '${target.id}' discovery evidence`);
    assertFresh(managed.dataPolicyEvidence.expiresAt, now, `Execution target '${target.id}' data-policy evidence`);
    if (target.kind !== "direct" || managed.kind !== "direct") return [];
    assertFresh(
      managed.economics.priceEvidence.evidence.validUntil,
      now,
      `Execution target '${target.id}' price evidence`,
    );
    return [{
      id: target.id,
      label: target.label,
      providerId: target.providerId,
      providerModelId: target.providerModelId,
      accountPolicyId: target.accountPolicyId,
      dataClassification: target.dataClassification,
      dataPolicyEvidence: managed.dataPolicyEvidence,
      economics: { ...managed.economics, ...target.economics },
    }];
  });
  return defineExecutionTargetCatalog({ accounts, accountPolicies: intent.accountPolicies, targets });
}

function assertTargetEvidenceIdentity(
  target: DirectExecutionTargetIntent | HarnessExecutionTargetIntent,
  evidence: ExecutionTargetEvidenceSnapshot["targets"][number],
): void {
  if (evidence.discovery.providerId !== target.providerId
    || evidence.dataPolicyEvidence.providerId !== target.providerId) {
    throw new Error(`Execution target '${target.id}' managed evidence provider mismatch.`);
  }
  if (evidence.discovery.providerModelId !== target.providerModelId
    || evidence.dataPolicyEvidence.providerModelId !== target.providerModelId) {
    throw new Error(`Execution target '${target.id}' managed evidence provider model mismatch.`);
  }
}

function exactEvidenceMap<T>(
  configuredIds: readonly string[],
  records: readonly T[],
  idOf: (record: T) => string,
  label: string,
): ReadonlyMap<string, T> {
  const expected = new Set(configuredIds);
  const byId = new Map(records.map((record) => [idOf(record), record]));
  for (const id of configuredIds) {
    if (!byId.has(id)) throw new Error(`Configured ${label} '${id}' has no managed evidence.`);
  }
  for (const id of byId.keys()) {
    if (!expected.has(id)) throw new Error(`Managed evidence references unconfigured ${label} '${id}'.`);
  }
  return byId;
}

function canonicalizeSnapshot(snapshot: ExecutionTargetEvidenceSnapshot): ExecutionTargetEvidenceSnapshot {
  return {
    version: EXECUTION_TARGET_EVIDENCE_VERSION,
    accounts: [...snapshot.accounts].sort((left, right) => left.accountId.localeCompare(right.accountId)),
    targets: [...snapshot.targets].sort((left, right) => left.targetId.localeCompare(right.targetId)),
  };
}

function serializeSnapshot(snapshot: ExecutionTargetEvidenceSnapshot): string {
  return `${JSON.stringify(sortJson(snapshot), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, member]) => [key, sortJson(member)]),
  );
}

function uniqueIds(ids: readonly string[], label: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`Execution-target ${label} ids must be unique.`);
}

function validTimestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp.`);
}

function assertFresh(expiresAt: string, now: number, label: string): void {
  validTimestamp(expiresAt, `${label}.expiresAt`);
  if (Date.parse(expiresAt) <= now) throw new Error(`${label} is stale.`);
}

function requireRevision(value: string): asserts value is ExecutionTargetEvidenceRevision {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error("Execution-target evidence revision must be a SHA-256 digest.");
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const member of Object.values(value)) deepFreeze(member);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
