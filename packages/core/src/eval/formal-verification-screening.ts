import { createHash } from "node:crypto";

/** The only arms admitted by the formal-verification screening contract. */
export type FormalVerificationScreeningArm = "C0" | "T";

export type FormalVerificationScreeningRepeatIndex = 0 | 1;

export const FORMAL_VERIFICATION_SCREENING_K = 2 as const;
export const FORMAL_VERIFICATION_SCREENING_PAIR_COUNT = 8 as const;
export const FORMAL_VERIFICATION_SCREENING_REPEAT_INDICES = [0, 1] as const;
export const FORMAL_VERIFICATION_SCREENING_DEFAULT_PAIR_IDS = [
  "pair-1",
  "pair-2",
  "pair-3",
  "pair-4",
  "pair-5",
  "pair-6",
  "pair-7",
  "pair-8",
] as const;

/**
 * Facts required to screen one trial.  This type deliberately contains no
 * CLI, runtime, lifecycle, or configuration objects.  The hashes identify
 * the fixed comparison design; identity fields bind the requested route to
 * the route observed for this trial.
 */
export interface FormalVerificationScreeningObservation {
  readonly itemId: string;
  readonly pairId: string;
  readonly arm: FormalVerificationScreeningArm;
  readonly repeatIndex: FormalVerificationScreeningRepeatIndex;
  readonly valid: boolean;
  readonly promptHash: string;
  readonly fixtureHash: string;
  readonly protocolHash: string;
  readonly expectedRoute: string;
  readonly observedRoute: string;
  readonly expectedProvider: string;
  readonly observedProvider: string;
  readonly expectedModel: string;
  readonly observedModel: string;
  readonly expectedAccount: string;
  readonly observedAccount: string;
  readonly fallbackUsed: boolean;
  readonly budgetHash: string;
  readonly toolProjectionHash: string;
  readonly verifierHash: string;
  /** Runtime-observed dependency binding; treatment-only and stable across T. */
  readonly treatmentToolchainHash?: string;
  readonly hiddenOracleExhaustive: boolean;
  /** Host-owned lemma_check/toolchain fact; required only for treatment. */
  readonly lemmaCheckPassed?: boolean;
  readonly hiddenPassed: boolean;
}

export interface FormalVerificationScreeningOptions {
  /** The eight pair identifiers in the fixed screening plan. */
  readonly pairIds?: readonly string[];
}

export interface FormalVerificationScreeningIdentityIssue {
  readonly blockKey: string;
  readonly itemId?: string;
  readonly arm?: FormalVerificationScreeningArm;
  readonly field: string;
  readonly expected?: string;
  readonly observed?: string;
}

export interface FormalVerificationScreeningBlock {
  readonly blockKey: string;
  readonly pairId: string;
  readonly repeatIndex: FormalVerificationScreeningRepeatIndex;
  readonly observationCount: number;
  readonly armCounts: Readonly<Record<FormalVerificationScreeningArm, number>>;
  readonly complete: boolean;
  readonly valid: boolean;
  readonly identityCoherent: boolean;
  readonly issues: readonly string[];
}

export interface FormalVerificationScreeningReconciliation {
  readonly plannedPairIds: readonly string[];
  readonly plannedRepeatIndices: readonly FormalVerificationScreeningRepeatIndex[];
  readonly plannedBlockCount: number;
  readonly plannedTrialCount: number;
  readonly observedTrialCount: number;
  readonly observedBlockCount: number;
  readonly completeBlockCount: number;
  readonly completeValidBlockCount: number;
  readonly completeValidBlockRate: number;
  /** Complete blocks containing at least one invalid or incoherent arm. */
  readonly invalidCompleteBlockRate: number;
  /** Invalid expected arm slots divided by the 32 planned arm slots. */
  readonly invalidTrialCount: number;
  readonly invalidTrialRate: number;
  readonly missingBlocks: readonly string[];
  readonly missingArmSlots: readonly string[];
  readonly duplicateSlots: readonly string[];
  readonly extraObservations: readonly string[];
  readonly invalidArms: readonly string[];
  readonly identityMissing: readonly FormalVerificationScreeningIdentityIssue[];
  readonly identityMismatches: readonly FormalVerificationScreeningIdentityIssue[];
  readonly invalidTrials: readonly string[];
  readonly blocks: readonly FormalVerificationScreeningBlock[];
}

export interface FormalVerificationScreeningArmMetrics {
  readonly validTrialCount: number;
  readonly invalidTrialCount: number;
  /** Hidden oracle pass rate among mechanically valid trials only. */
  readonly pass1: number;
  /** Number of planned pair slots whose two repeats are both valid. */
  readonly validPairCount: number;
  /** Number of valid pairs whose two repeats both passed the hidden oracle. */
  readonly passingPairCount: number;
  /** pass2 = passingPairCount / validPairCount (zero when no pair is valid). */
  readonly pass2: number;
}

export interface FormalVerificationScreeningPass2Details {
  readonly validPairCount: number;
  readonly passingPairCount: number;
  readonly rate: number;
}

export interface FormalVerificationScreeningGates {
  readonly completeValidBlocks: boolean;
  readonly invalid: boolean;
  readonly c0Pass1: boolean;
  readonly c0OracleExhaustive: boolean;
  readonly c0LemmaIsolation: boolean;
  readonly treatmentMechanicallySound: boolean;
  /** Structural reconciliation must also be clean before screening is ready. */
  readonly reconciliation: boolean;
  readonly all: boolean;
}

export interface FormalVerificationScreeningReport {
  readonly policyId: "formal-verification-screening-v1";
  readonly k: typeof FORMAL_VERIFICATION_SCREENING_K;
  readonly plannedPairCount: typeof FORMAL_VERIFICATION_SCREENING_PAIR_COUNT;
  readonly plannedRepeatCount: typeof FORMAL_VERIFICATION_SCREENING_K;
  readonly plannedBlockCount: number;
  readonly plannedTrialCount: number;
  readonly comparisonHash: string;
  readonly reconciliation: FormalVerificationScreeningReconciliation;
  readonly arms: Readonly<Record<FormalVerificationScreeningArm, FormalVerificationScreeningArmMetrics>>;
  readonly pass1: Readonly<Record<FormalVerificationScreeningArm, number>>;
  readonly pass2: Readonly<Record<FormalVerificationScreeningArm, number>>;
  readonly pass2Details: Readonly<Record<FormalVerificationScreeningArm, FormalVerificationScreeningPass2Details>>;
  readonly invalidCompleteBlockRate: number;
  readonly invalidTrialRate: number;
  readonly gates: FormalVerificationScreeningGates;
  readonly benchmarkReady: false;
  readonly claimCeiling: "mechanical-validity-screening-only";
  readonly screeningReady: boolean;
  readonly issues: readonly string[];
}

type UnknownObservation = Partial<Record<keyof FormalVerificationScreeningObservation, unknown>> & {
  readonly [key: string]: unknown;
};

interface NormalizedObservation {
  readonly index: number;
  readonly itemId?: string;
  readonly pairId?: string;
  readonly arm: unknown;
  readonly repeatIndex: unknown;
  readonly valid: unknown;
  readonly promptHash?: string;
  readonly fixtureHash?: string;
  readonly protocolHash?: string;
  readonly expectedRoute?: string;
  readonly observedRoute?: string;
  readonly expectedProvider?: string;
  readonly observedProvider?: string;
  readonly expectedModel?: string;
  readonly observedModel?: string;
  readonly expectedAccount?: string;
  readonly observedAccount?: string;
  readonly fallbackUsed: unknown;
  readonly budgetHash?: string;
  readonly toolProjectionHash?: string;
  readonly verifierHash?: string;
  readonly treatmentToolchainHash?: string;
  readonly hiddenOracleExhaustive: unknown;
  readonly lemmaCheckPassed: unknown;
  readonly hiddenPassed: unknown;
}

interface SlotEvaluation {
  readonly observations: readonly NormalizedObservation[];
  readonly representative?: NormalizedObservation;
  readonly complete: boolean;
  readonly valid: boolean;
}

interface BlockEvaluation {
  readonly blockKey: string;
  readonly pairId: string;
  readonly repeatIndex: FormalVerificationScreeningRepeatIndex;
  readonly observations: readonly NormalizedObservation[];
  readonly slots: Readonly<Record<FormalVerificationScreeningArm, SlotEvaluation>>;
  readonly complete: boolean;
  readonly identityCoherent: boolean;
  readonly valid: boolean;
  readonly issues: readonly string[];
}

const HASH_FIELDS = [
  "promptHash",
  "fixtureHash",
  "protocolHash",
  "budgetHash",
  "toolProjectionHash",
  "verifierHash",
] as const;

const IDENTITY_FIELDS = [
  ["route", "expectedRoute", "observedRoute"],
  ["provider", "expectedProvider", "observedProvider"],
  ["model", "expectedModel", "observedModel"],
  ["account", "expectedAccount", "observedAccount"],
] as const;

const CROSS_ARM_FIELDS = [
  "promptHash",
  "fixtureHash",
  "protocolHash",
  "budgetHash",
  "verifierHash",
  "expectedRoute",
  "expectedProvider",
  "expectedModel",
  "expectedAccount",
] as const;

/**
 * Reconcile and screen a fixed C0/T plan.  Invalid facts are returned as
 * diagnostics instead of being thrown away; no invalid fact can make the
 * result mechanically ready.
 */
export function evaluateFormalVerificationScreening(
  observations: readonly unknown[],
  options: FormalVerificationScreeningOptions = {},
): FormalVerificationScreeningReport {
  const plan = normalizePlan(options.pairIds);
  const normalized = observations.map(normalizeObservation);
  const planIssues = validatePlan(plan);
  const plannedBlocks = buildPlannedBlocks(plan.pairIds);
  const byBlock = groupObservations(normalized);
  const reconciliationIssues: string[] = [...planIssues];
  const missingBlocks: string[] = [];
  const missingArmSlots: string[] = [];
  const duplicateSlots: string[] = [];
  const extraObservations: string[] = [];
  const invalidArms: string[] = [];
  const identityMissing: FormalVerificationScreeningIdentityIssue[] = [];
  const identityMismatches: FormalVerificationScreeningIdentityIssue[] = [];
  const invalidTrials: string[] = [];
  const evaluations: BlockEvaluation[] = [];

  for (const fact of normalized) {
    if (!isScreeningArm(fact.arm)) {
      invalidArms.push(fact.itemId ?? `observation-${fact.index}`);
      extraObservations.push(observationDescriptor(fact));
      reconciliationIssues.push(`${observationDescriptor(fact)} has invalid arm`);
      continue;
    }
    if (!isScreeningRepeatIndex(fact.repeatIndex) || !plan.pairIdSet.has(fact.pairId ?? "")) {
      extraObservations.push(observationDescriptor(fact));
      reconciliationIssues.push(`${observationDescriptor(fact)} is outside the planned blocks`);
    }
  }

  for (const planned of plannedBlocks) {
    const observationsForBlock = byBlock.get(planned.blockKey) ?? [];
    const blockIssues: string[] = [];
    const slots = {} as Record<FormalVerificationScreeningArm, SlotEvaluation>;
    for (const arm of ["C0", "T"] as const) {
      const armObservations = observationsForBlock.filter((fact) => fact.arm === arm);
      const representative = armObservations.length === 1 ? armObservations[0] : undefined;
      const complete = armObservations.length === 1;
      if (armObservations.length === 0) {
        const slot = `${planned.blockKey}:${arm}`;
        missingArmSlots.push(slot);
        blockIssues.push(`missing ${slot}`);
      } else if (armObservations.length > 1) {
        const slot = `${planned.blockKey}:${arm}`;
        duplicateSlots.push(slot);
        blockIssues.push(`duplicate ${slot}`);
      }
      for (const observation of armObservations) {
        collectObservationIssues(
          observation,
          planned.blockKey,
          arm,
          identityMissing,
          identityMismatches,
          invalidTrials,
          blockIssues,
        );
      }
      slots[arm] = {
        observations: armObservations,
        representative,
        complete,
        valid: complete && representative !== undefined && observationOwnValidity(representative, arm),
      };
    }
    const complete = slots.C0.complete && slots.T.complete;
    if (!complete) missingBlocks.push(planned.blockKey);
    const crossArmIssues = collectCrossArmIdentityIssues(
      planned.blockKey,
      slots.C0.representative,
      slots.T.representative,
      identityMismatches,
    );
    blockIssues.push(...crossArmIssues);
    const identityCoherent = crossArmIssues.length === 0
      && slots.C0.representative !== undefined
      && slots.T.representative !== undefined
      && observationIdentityCoherent(slots.C0.representative)
      && observationIdentityCoherent(slots.T.representative);
    const valid = complete && identityCoherent && slots.C0.valid && slots.T.valid;
    evaluations.push({
      blockKey: planned.blockKey,
      pairId: planned.pairId,
      repeatIndex: planned.repeatIndex,
      observations: observationsForBlock,
      slots,
      complete,
      identityCoherent,
      valid,
      issues: blockIssues,
    });
    reconciliationIssues.push(...blockIssues.map((issue) => `${planned.blockKey}: ${issue}`));
  }

  for (const [blockKey, facts] of byBlock) {
    if (!plannedBlocks.some((planned) => planned.blockKey === blockKey)) {
      for (const fact of facts) {
        const descriptor = observationDescriptor(fact);
        if (!extraObservations.includes(descriptor)) extraObservations.push(descriptor);
      }
    }
  }

  const projectionIssues = collectProjectionIssues(normalized, plan.pairIdSet, evaluations, identityMismatches);
  const reconciledEvaluations = evaluations.map((block) => {
    const issues = projectionIssues.get(block.blockKey);
    if (!issues || issues.length === 0) return block;
    return {
      ...block,
      identityCoherent: false,
      valid: false,
      issues: [...block.issues, ...issues],
    };
  });
  const completeBlockCount = reconciledEvaluations.filter((block) => block.complete).length;
  const completeValidBlockCount = reconciledEvaluations.filter((block) => block.valid).length;
  const plannedTrialCount = plannedBlocks.length * 2;
  const armMetrics = {
    C0: calculateArmMetrics(reconciledEvaluations, "C0"),
    T: calculateArmMetrics(reconciledEvaluations, "T"),
  } as const;
  const invalidTrialCount = armMetrics.C0.invalidTrialCount + armMetrics.T.invalidTrialCount;
  const invalidTrialRate = ratio(invalidTrialCount, plannedTrialCount);
  const completeValidBlockRate = ratio(completeValidBlockCount, plannedBlocks.length);
  const invalidCompleteBlockRate = completeBlockCount === 0
    ? 0
    : (completeBlockCount - completeValidBlockCount) / completeBlockCount;
  const pass2Details = {
    C0: pass2DetailsFor(reconciledEvaluations, "C0"),
    T: pass2DetailsFor(reconciledEvaluations, "T"),
  } as const;
  const blockReports = reconciledEvaluations.map(toBlockReport);
  const reconciliation: FormalVerificationScreeningReconciliation = {
    plannedPairIds: plan.pairIds,
    plannedRepeatIndices: FORMAL_VERIFICATION_SCREENING_REPEAT_INDICES,
    plannedBlockCount: plannedBlocks.length,
    plannedTrialCount,
    observedTrialCount: normalized.length,
    observedBlockCount: byBlock.size,
    completeBlockCount,
    completeValidBlockCount,
    completeValidBlockRate,
    invalidCompleteBlockRate,
    invalidTrialCount,
    invalidTrialRate,
    missingBlocks: [...new Set(missingBlocks)].sort(),
    missingArmSlots: [...new Set(missingArmSlots)].sort(),
    duplicateSlots: [...new Set(duplicateSlots)].sort(),
    extraObservations: [...new Set(extraObservations)].sort(),
    invalidArms: [...new Set(invalidArms)].sort(),
    identityMissing: sortIdentityIssues(identityMissing),
    identityMismatches: sortIdentityIssues(identityMismatches),
    invalidTrials: [...new Set(invalidTrials)].sort(),
    blocks: blockReports,
  };
  const hasStructuralIssue = planIssues.length > 0
    || reconciliation.missingBlocks.length > 0
    || reconciliation.missingArmSlots.length > 0
    || reconciliation.duplicateSlots.length > 0
    || reconciliation.extraObservations.length > 0
    || reconciliation.invalidArms.length > 0;
  const c0Facts = normalized.filter((fact) =>
    fact.arm === "C0"
    && isScreeningRepeatIndex(fact.repeatIndex)
    && fact.pairId !== undefined
    && plan.pairIdSet.has(fact.pairId));
  const gates: FormalVerificationScreeningGates = {
    completeValidBlocks: completeValidBlockRate >= 0.9,
    invalid: invalidTrialRate <= 0.1,
    c0Pass1: armMetrics.C0.pass1 >= 0.2 && armMetrics.C0.pass1 <= 0.8,
    c0OracleExhaustive: c0Facts.length === plannedBlocks.length
      && c0Facts.every((fact) => fact.hiddenOracleExhaustive === true),
    c0LemmaIsolation: c0Facts.every((fact) => fact.lemmaCheckPassed !== true),
    treatmentMechanicallySound: armMetrics.T.validTrialCount === plannedBlocks.length
      && armMetrics.T.invalidTrialCount === 0
      && reconciledEvaluations.every((block) => block.slots.T.valid && block.identityCoherent)
      && reconciledEvaluations.every((block) => block.slots.T.representative?.hiddenOracleExhaustive === true)
      && reconciledEvaluations.every((block) => block.slots.T.representative?.lemmaCheckPassed === true),
    reconciliation: !hasStructuralIssue
      && reconciliation.identityMissing.length === 0
      && reconciliation.identityMismatches.length === 0,
    all: false,
  };
  const allGates = gates.completeValidBlocks
    && gates.invalid
    && gates.c0Pass1
    && gates.c0OracleExhaustive
    && gates.c0LemmaIsolation
    && gates.treatmentMechanicallySound
    && gates.reconciliation;
  const finalGates = { ...gates, all: allGates };
  const issues = buildIssues(reconciliation, finalGates);

  return {
    policyId: "formal-verification-screening-v1",
    k: FORMAL_VERIFICATION_SCREENING_K,
    plannedPairCount: FORMAL_VERIFICATION_SCREENING_PAIR_COUNT,
    plannedRepeatCount: FORMAL_VERIFICATION_SCREENING_K,
    plannedBlockCount: plannedBlocks.length,
    plannedTrialCount,
    comparisonHash: comparisonHash(plan.pairIds, normalized),
    reconciliation,
    arms: armMetrics,
    pass1: { C0: armMetrics.C0.pass1, T: armMetrics.T.pass1 },
    pass2: { C0: pass2Details.C0.rate, T: pass2Details.T.rate },
    pass2Details,
    invalidCompleteBlockRate,
    invalidTrialRate,
    gates: finalGates,
    benchmarkReady: false,
    claimCeiling: "mechanical-validity-screening-only",
    screeningReady: allGates,
    issues,
  };
}

interface ScreeningPlan {
  readonly pairIds: readonly string[];
  readonly pairIdSet: ReadonlySet<string>;
}

interface PlannedBlock {
  readonly pairId: string;
  readonly repeatIndex: FormalVerificationScreeningRepeatIndex;
  readonly blockKey: string;
}

function normalizePlan(pairIds: readonly string[] | undefined): ScreeningPlan {
  const source = pairIds ?? FORMAL_VERIFICATION_SCREENING_DEFAULT_PAIR_IDS;
  const normalized = source.map((pairId) => typeof pairId === "string" ? pairId.trim() : "");
  return {
    pairIds: [...new Set(normalized)].sort(),
    pairIdSet: new Set(normalized),
  };
}

function validatePlan(plan: ScreeningPlan): readonly string[] {
  const issues: string[] = [];
  if (plan.pairIds.length !== FORMAL_VERIFICATION_SCREENING_PAIR_COUNT) {
    issues.push(`screening plan requires exactly ${FORMAL_VERIFICATION_SCREENING_PAIR_COUNT} pairIds`);
  }
  if (plan.pairIds.some((pairId) => pairId.length === 0)) issues.push("screening plan pairIds must be non-empty");
  return issues;
}

function buildPlannedBlocks(pairIds: readonly string[]): readonly PlannedBlock[] {
  return pairIds.flatMap((pairId) => FORMAL_VERIFICATION_SCREENING_REPEAT_INDICES.map((repeatIndex) => ({
    pairId,
    repeatIndex,
    blockKey: screeningBlockKey(pairId, repeatIndex),
  })));
}

export function screeningBlockKey(
  pairId: string,
  repeatIndex: FormalVerificationScreeningRepeatIndex,
): string {
  return `${pairId}:${repeatIndex}`;
}

function normalizeObservation(value: unknown, index: number): NormalizedObservation {
  const input: UnknownObservation = isRecord(value) ? value : {};
  return {
    index,
    itemId: nonEmptyString(input.itemId),
    pairId: nonEmptyString(input.pairId),
    arm: input.arm,
    repeatIndex: input.repeatIndex,
    valid: input.valid,
    promptHash: nonEmptyString(input.promptHash),
    fixtureHash: nonEmptyString(input.fixtureHash),
    protocolHash: nonEmptyString(input.protocolHash),
    expectedRoute: nonEmptyString(input.expectedRoute),
    observedRoute: nonEmptyString(input.observedRoute),
    expectedProvider: nonEmptyString(input.expectedProvider),
    observedProvider: nonEmptyString(input.observedProvider),
    expectedModel: nonEmptyString(input.expectedModel),
    observedModel: nonEmptyString(input.observedModel),
    expectedAccount: nonEmptyString(input.expectedAccount),
    observedAccount: nonEmptyString(input.observedAccount),
    fallbackUsed: input.fallbackUsed,
    budgetHash: nonEmptyString(input.budgetHash),
    toolProjectionHash: nonEmptyString(input.toolProjectionHash),
    verifierHash: nonEmptyString(input.verifierHash),
    treatmentToolchainHash: nonEmptyString(input.treatmentToolchainHash),
    hiddenOracleExhaustive: input.hiddenOracleExhaustive,
    lemmaCheckPassed: input.lemmaCheckPassed,
    hiddenPassed: input.hiddenPassed,
  };
}

function groupObservations(observations: readonly NormalizedObservation[]): Map<string, NormalizedObservation[]> {
  const byBlock = new Map<string, NormalizedObservation[]>();
  for (const observation of observations) {
    if (!isScreeningRepeatIndex(observation.repeatIndex) || observation.pairId === undefined) continue;
    const key = screeningBlockKey(observation.pairId, observation.repeatIndex);
    const block = byBlock.get(key) ?? [];
    block.push(observation);
    byBlock.set(key, block);
  }
  return byBlock;
}

function collectObservationIssues(
  observation: NormalizedObservation,
  blockKey: string,
  arm: FormalVerificationScreeningArm,
  identityMissing: FormalVerificationScreeningIdentityIssue[],
  identityMismatches: FormalVerificationScreeningIdentityIssue[],
  invalidTrials: string[],
  blockIssues: string[],
): void {
  const itemId = observation.itemId;
  for (const field of HASH_FIELDS) {
    if (observation[field] === undefined) {
      identityMissing.push({ blockKey, itemId, arm, field });
      blockIssues.push(`${itemId ?? "observation"} is missing ${field}`);
    }
  }
  for (const [field, expectedField, observedField] of IDENTITY_FIELDS) {
    const expected = observation[expectedField];
    const observed = observation[observedField];
    if (expected === undefined) {
      identityMissing.push({ blockKey, itemId, arm, field: expectedField });
    }
    if (observed === undefined) {
      identityMissing.push({ blockKey, itemId, arm, field: observedField });
    }
    if (expected !== undefined && observed !== undefined && expected !== observed) {
      identityMismatches.push({ blockKey, itemId, arm, field, expected, observed });
      blockIssues.push(`${itemId ?? "observation"} has ${field} identity mismatch`);
    }
  }
  if (observation.toolProjectionHash === undefined) {
    identityMissing.push({ blockKey, itemId, arm, field: "toolProjectionHash" });
  }
  if (observation.valid !== true) {
    invalidTrials.push(itemId ?? `observation-${observation.index}`);
    blockIssues.push(`${itemId ?? "observation"} is invalid`);
  }
  if (observation.fallbackUsed !== false) {
    invalidTrials.push(itemId ?? `observation-${observation.index}`);
    blockIssues.push(`${itemId ?? "observation"} used fallback`);
  }
  if (observation.hiddenOracleExhaustive !== true) {
    invalidTrials.push(itemId ?? `observation-${observation.index}`);
    blockIssues.push(`${itemId ?? "observation"} hidden oracle is not exhaustive`);
  }
  if (arm === "T" && observation.lemmaCheckPassed !== true) {
    invalidTrials.push(itemId ?? `observation-${observation.index}`);
    blockIssues.push(`${itemId ?? "observation"} treatment lemma_check/toolchain fact is not passed`);
  }
  if (arm === "T" && observation.treatmentToolchainHash === undefined) {
    identityMissing.push({ blockKey, itemId, arm, field: "treatmentToolchainHash" });
    blockIssues.push(`${itemId ?? "observation"} is missing treatmentToolchainHash`);
  }
  if (arm === "C0" && observation.treatmentToolchainHash !== undefined) {
    invalidTrials.push(itemId ?? `observation-${observation.index}`);
    blockIssues.push(`${itemId ?? "observation"} control cannot carry treatment toolchain identity`);
  }
  if (arm === "C0" && observation.lemmaCheckPassed === true) {
    invalidTrials.push(itemId ?? `observation-${observation.index}`);
    blockIssues.push(`${itemId ?? "observation"} control cannot claim lemma_check/toolchain treatment evidence`);
  }
  if (observation.itemId === undefined) {
    invalidTrials.push(`observation-${observation.index}`);
    blockIssues.push(`observation-${observation.index} is missing itemId`);
  }
}

function collectCrossArmIdentityIssues(
  blockKey: string,
  c0: NormalizedObservation | undefined,
  treatment: NormalizedObservation | undefined,
  identityMismatches: FormalVerificationScreeningIdentityIssue[],
): readonly string[] {
  if (!c0 || !treatment) return [];
  const issues: string[] = [];
  for (const field of CROSS_ARM_FIELDS) {
    const left = c0[field];
    const right = treatment[field];
    if (left !== undefined && right !== undefined && left !== right) {
      identityMismatches.push({
        blockKey,
        field,
        expected: left,
        observed: right,
      });
      issues.push(`C0/T ${field} identity mismatch`);
    }
  }
  return issues;
}

function observationOwnValidity(
  observation: NormalizedObservation,
  arm: FormalVerificationScreeningArm,
): boolean {
  if (observation.valid !== true || observation.fallbackUsed !== false) return false;
  if (observation.hiddenOracleExhaustive !== true) return false;
  if (arm === "T" && observation.lemmaCheckPassed !== true) return false;
  if (arm === "C0" && observation.lemmaCheckPassed === true) return false;
  if (arm === "T" && observation.treatmentToolchainHash === undefined) return false;
  if (arm === "C0" && observation.treatmentToolchainHash !== undefined) return false;
  if (observation.itemId === undefined || observation.pairId === undefined) return false;
  if (!isScreeningRepeatIndex(observation.repeatIndex)) return false;
  for (const field of HASH_FIELDS) if (observation[field] === undefined) return false;
  for (const [, expectedField, observedField] of IDENTITY_FIELDS) {
    if (observation[expectedField] === undefined || observation[observedField] === undefined) return false;
    if (observation[expectedField] !== observation[observedField]) return false;
  }
  if (observation.toolProjectionHash === undefined) return false;
  return typeof observation.hiddenPassed === "boolean";
}

function observationIdentityCoherent(observation: NormalizedObservation): boolean {
  if (observation.itemId === undefined || observation.pairId === undefined) return false;
  for (const field of HASH_FIELDS) if (observation[field] === undefined) return false;
  for (const [, expectedField, observedField] of IDENTITY_FIELDS) {
    if (observation[expectedField] === undefined || observation[observedField] === undefined) return false;
    if (observation[expectedField] !== observation[observedField]) return false;
  }
  return true;
}

/**
 * The arm projection is intentionally different between C0 and T, but it is
 * part of the fixed design rather than a per-trial outcome.  A drift inside
 * one arm or equality between the two arms invalidates the corresponding
 * blocks and remains visible as identity evidence.
 */
function collectProjectionIssues(
  observations: readonly NormalizedObservation[],
  plannedPairIds: ReadonlySet<string>,
  evaluations: readonly BlockEvaluation[],
  identityMismatches: FormalVerificationScreeningIdentityIssue[],
): ReadonlyMap<string, readonly string[]> {
  const issuesByBlock = new Map<string, string[]>();
  const projectionByArm = new Map<FormalVerificationScreeningArm, Array<{
    readonly observation: NormalizedObservation;
    readonly blockKey: string;
  }>>();
  for (const observation of observations) {
    if (!isScreeningArm(observation.arm)
      || !isScreeningRepeatIndex(observation.repeatIndex)
      || observation.pairId === undefined
      || !plannedPairIds.has(observation.pairId)
      || observation.toolProjectionHash === undefined) continue;
    const entries = projectionByArm.get(observation.arm) ?? [];
    entries.push({
      observation,
      blockKey: screeningBlockKey(observation.pairId, observation.repeatIndex),
    });
    projectionByArm.set(observation.arm, entries);
  }

  const expectedProjection = new Map<FormalVerificationScreeningArm, string>();
  for (const arm of ["C0", "T"] as const) {
    const entries = projectionByArm.get(arm) ?? [];
    const expected = entries[0]?.observation.toolProjectionHash;
    if (expected === undefined) continue;
    expectedProjection.set(arm, expected);
    for (const entry of entries) {
      const observed = entry.observation.toolProjectionHash;
      if (observed === undefined || observed === expected) continue;
      addProjectionIssue(
        issuesByBlock,
        identityMismatches,
        entry.blockKey,
        arm,
        expected,
        observed,
      );
    }
  }

  const c0Projection = expectedProjection.get("C0");
  const treatmentProjection = expectedProjection.get("T");
  if (c0Projection !== undefined && treatmentProjection !== undefined && c0Projection === treatmentProjection) {
    for (const block of evaluations) {
      const c0 = block.slots.C0.representative?.toolProjectionHash;
      const treatment = block.slots.T.representative?.toolProjectionHash;
      if (c0 === undefined || treatment === undefined || c0 !== treatment) continue;
      addProjectionIssue(
        issuesByBlock,
        identityMismatches,
        block.blockKey,
        "C0",
        c0Projection,
        treatmentProjection,
      );
      addProjectionIssue(
        issuesByBlock,
        identityMismatches,
        block.blockKey,
        "T",
        c0Projection,
        treatmentProjection,
      );
    }
  }
  const treatmentEntries = observations.filter((observation) =>
    observation.arm === "T"
    && isScreeningRepeatIndex(observation.repeatIndex)
    && observation.pairId !== undefined
    && plannedPairIds.has(observation.pairId)
    && observation.treatmentToolchainHash !== undefined);
  const expectedToolchainHash = treatmentEntries[0]?.treatmentToolchainHash;
  if (expectedToolchainHash !== undefined) {
    for (const observation of treatmentEntries) {
      if (observation.treatmentToolchainHash === expectedToolchainHash) continue;
      if (observation.pairId === undefined || !isScreeningRepeatIndex(observation.repeatIndex)) continue;
      const blockKey = screeningBlockKey(observation.pairId, observation.repeatIndex);
      const issues = issuesByBlock.get(blockKey) ?? [];
      issues.push("T treatmentToolchainHash is not stable");
      issuesByBlock.set(blockKey, issues);
      identityMismatches.push({
        blockKey,
        arm: "T",
        field: "treatmentToolchainHash",
        expected: expectedToolchainHash,
        observed: observation.treatmentToolchainHash,
      });
    }
  }
  return issuesByBlock;
}

function addProjectionIssue(
  issuesByBlock: Map<string, string[]>,
  identityMismatches: FormalVerificationScreeningIdentityIssue[],
  blockKey: string,
  arm: FormalVerificationScreeningArm,
  expected: string,
  observed: string,
): void {
  const issues = issuesByBlock.get(blockKey) ?? [];
  issues.push(`${arm} toolProjectionHash is not stable for the screening arm`);
  issuesByBlock.set(blockKey, issues);
  identityMismatches.push({
    blockKey,
    arm,
    field: "toolProjectionHash",
    expected,
    observed,
  });
}

function calculateArmMetrics(
  evaluations: readonly BlockEvaluation[],
  arm: FormalVerificationScreeningArm,
): FormalVerificationScreeningArmMetrics {
  const validFacts = evaluations
    .filter((block) => block.slots[arm].valid && block.identityCoherent)
    .map((block) => block.slots[arm].representative)
    .filter((observation): observation is NormalizedObservation => observation !== undefined);
  const validTrialCount = validFacts.length;
  const invalidTrialCount = evaluations.length - validTrialCount;
  const passedTrialCount = validFacts.filter((observation) => observation.hiddenPassed === true).length;
  const pass1 = ratio(passedTrialCount, validTrialCount);
  const pairDetails = pass2DetailsFor(evaluations, arm);
  return {
    validTrialCount,
    invalidTrialCount,
    pass1,
    validPairCount: pairDetails.validPairCount,
    passingPairCount: pairDetails.passingPairCount,
    pass2: pairDetails.rate,
  };
}

function pass2DetailsFor(
  evaluations: readonly BlockEvaluation[],
  arm: FormalVerificationScreeningArm,
): FormalVerificationScreeningPass2Details {
  const byPair = new Map<string, readonly BlockEvaluation[]>();
  for (const block of evaluations) {
    const pairBlocks = byPair.get(block.pairId) ?? [];
    byPair.set(block.pairId, [...pairBlocks, block]);
  }
  let validPairCount = 0;
  let passingPairCount = 0;
  for (const blocks of byPair.values()) {
    const repeats = new Map(blocks.map((block) => [block.repeatIndex, block] as const));
    const first = repeats.get(0);
    const second = repeats.get(1);
    const firstFact = first?.slots[arm].representative;
    const secondFact = second?.slots[arm].representative;
    const valid = first?.identityCoherent === true
      && second?.identityCoherent === true
      && first.slots[arm].valid
      && second.slots[arm].valid;
    if (!valid) continue;
    validPairCount += 1;
    if (firstFact?.hiddenPassed === true && secondFact?.hiddenPassed === true) passingPairCount += 1;
  }
  return {
    validPairCount,
    passingPairCount,
    rate: ratio(passingPairCount, validPairCount),
  };
}

function toBlockReport(block: BlockEvaluation): FormalVerificationScreeningBlock {
  return {
    blockKey: block.blockKey,
    pairId: block.pairId,
    repeatIndex: block.repeatIndex,
    observationCount: block.observations.length,
    armCounts: {
      C0: block.slots.C0.observations.length,
      T: block.slots.T.observations.length,
    },
    complete: block.complete,
    valid: block.valid,
    identityCoherent: block.identityCoherent,
    issues: block.issues,
  };
}

function buildIssues(
  reconciliation: FormalVerificationScreeningReconciliation,
  gates: FormalVerificationScreeningGates,
): readonly string[] {
  const issues: string[] = [];
  if (reconciliation.plannedPairIds.length !== FORMAL_VERIFICATION_SCREENING_PAIR_COUNT) {
    issues.push(`planned pair count must be ${FORMAL_VERIFICATION_SCREENING_PAIR_COUNT}`);
  }
  if (reconciliation.missingBlocks.length > 0) issues.push(`missing blocks: ${reconciliation.missingBlocks.join(", ")}`);
  if (reconciliation.missingArmSlots.length > 0) issues.push(`missing arm slots: ${reconciliation.missingArmSlots.join(", ")}`);
  if (reconciliation.duplicateSlots.length > 0) issues.push(`duplicate arm slots: ${reconciliation.duplicateSlots.join(", ")}`);
  if (reconciliation.extraObservations.length > 0) issues.push(`extra observations: ${reconciliation.extraObservations.join(", ")}`);
  if (reconciliation.invalidArms.length > 0) issues.push(`invalid arms: ${reconciliation.invalidArms.join(", ")}`);
  if (reconciliation.identityMissing.length > 0) issues.push("identity evidence is missing");
  if (reconciliation.identityMismatches.length > 0) issues.push("identity evidence does not reconcile");
  if (!gates.completeValidBlocks) issues.push("fewer than 90% of planned blocks are complete and valid");
  if (!gates.invalid) issues.push("invalid expected trial slots exceed 10%");
  if (!gates.c0Pass1) issues.push("C0 pass1 is outside the inclusive 0.20-0.80 screening range");
  if (!gates.c0OracleExhaustive) issues.push("C0 hidden oracle is not exhaustive for every planned trial");
  if (!gates.c0LemmaIsolation) issues.push("C0 contains treatment-only lemma_check/toolchain evidence");
  if (!gates.treatmentMechanicallySound) issues.push("T is not mechanically sound");
  return issues;
}

function comparisonHash(
  pairIds: readonly string[],
  observations: readonly NormalizedObservation[],
): string {
  const canonical = {
    policyId: "formal-verification-screening-v1",
    k: FORMAL_VERIFICATION_SCREENING_K,
    pairIds: [...pairIds].sort(),
    repeatIndices: [...FORMAL_VERIFICATION_SCREENING_REPEAT_INDICES],
    observations: observations
      .map((observation) => ({
        itemId: observation.itemId,
        pairId: observation.pairId,
        arm: observation.arm,
        repeatIndex: observation.repeatIndex,
        promptHash: observation.promptHash,
        fixtureHash: observation.fixtureHash,
        protocolHash: observation.protocolHash,
        expectedRoute: observation.expectedRoute,
        expectedProvider: observation.expectedProvider,
        expectedModel: observation.expectedModel,
        expectedAccount: observation.expectedAccount,
        budgetHash: observation.budgetHash,
        toolProjectionHash: observation.toolProjectionHash,
        verifierHash: observation.verifierHash,
        treatmentToolchainHash: observation.treatmentToolchainHash,
      }))
      .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right))),
  };
  return `sha256:${createHash("sha256").update(stableStringify(canonical)).digest("hex")}`;
}

function sortIdentityIssues(
  issues: readonly FormalVerificationScreeningIdentityIssue[],
): readonly FormalVerificationScreeningIdentityIssue[] {
  return [...issues].sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
}

function observationDescriptor(observation: NormalizedObservation): string {
  return `${observation.pairId ?? "<missing-pair>"}:${isScreeningRepeatIndex(observation.repeatIndex) ? observation.repeatIndex : "<missing-repeat>"}:${isScreeningArm(observation.arm) ? observation.arm : "<invalid-arm>"}`;
}

function isScreeningArm(value: unknown): value is FormalVerificationScreeningArm {
  return value === "C0" || value === "T";
}

function isScreeningRepeatIndex(value: unknown): value is FormalVerificationScreeningRepeatIndex {
  return value === 0 || value === 1;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
