import { describe, expect, it } from "vitest";
import {
  evaluateFormalVerificationScreening,
  type FormalVerificationScreeningObservation,
} from "../../src/eval/formal-verification-screening.js";

const PAIR_IDS = Array.from({ length: 8 }, (_, index) => `pair-${index + 1}`);

function observation(
  pairId: string,
  repeatIndex: 0 | 1,
  arm: "C0" | "T",
  overrides: Partial<FormalVerificationScreeningObservation> = {},
): FormalVerificationScreeningObservation {
  return {
    itemId: `${pairId}-${arm}-${repeatIndex}`,
    pairId,
    arm,
    repeatIndex,
    valid: true,
    promptHash: `prompt-${pairId}`,
    fixtureHash: `fixture-${pairId}`,
    protocolHash: "protocol-v1",
    expectedRoute: "route-fixed",
    observedRoute: "route-fixed",
    expectedProvider: "provider-fixed",
    observedProvider: "provider-fixed",
    expectedModel: "model-fixed",
    observedModel: "model-fixed",
    expectedAccount: "account-fixed",
    observedAccount: "account-fixed",
    fallbackUsed: false,
    budgetHash: "budget-v1",
    toolProjectionHash: `tools-${arm}`,
    verifierHash: "verifier-v1",
    sealedToolchainHash: "toolchain-v1",
    ...(arm === "T" ? { treatmentToolchainHash: "toolchain-v1" } : {}),
    hiddenOracleExhaustive: true,
    lemmaCheckPassed: arm === "T",
    hiddenPassed: arm === "T" || (pairId === "pair-1" && repeatIndex === 0),
    sealedDafnyPassed: true,
    contractDigestUnchanged: true,
    trustPolicyClean: true,
    ...overrides,
  };
}

function completeObservations(): FormalVerificationScreeningObservation[] {
  return PAIR_IDS.flatMap((pairId, pairIndex) => [0, 1].flatMap((repeatIndex) => [
    observation(pairId, repeatIndex as 0 | 1, "C0", {
      hiddenPassed: pairIndex < 4,
    }),
    observation(pairId, repeatIndex as 0 | 1, "T", {
      hiddenPassed: pairIndex % 2 === 0,
    }),
  ]));
}

describe("formal verification C0/T screening", () => {
  it("reports a mechanically ready complete screen and defines pass2 over valid pairs", () => {
    const report = evaluateFormalVerificationScreening(completeObservations(), { pairIds: PAIR_IDS });

    expect(report).toMatchObject({
      policyId: "formal-verification-screening-v2",
      k: 2,
      plannedBlockCount: 16,
      benchmarkReady: false,
      claimCeiling: "mechanical-validity-screening-only",
      screeningReady: true,
      invalidCompleteBlockRate: 0,
      gates: {
        completeValidBlocks: true,
        invalid: true,
        c0Pass1: true,
        treatmentMechanicallySound: true,
        all: true,
      },
    });
    expect(report.reconciliation.completeValidBlockCount).toBe(16);
    expect(report.arms.C0).toMatchObject({
      validTrialCount: 16,
      invalidTrialCount: 0,
      hiddenPass1: 0.5,
      sealedDafnyPass1: 1,
      qualifiedPass1: 0.5,
    });
    expect(report.arms.T).toMatchObject({
      validTrialCount: 16,
      invalidTrialCount: 0,
      hiddenPass1: 0.5,
      sealedDafnyPass1: 1,
      qualifiedPass1: 0.5,
    });
    expect(report.pass2).toEqual({ C0: 0.5, T: 0.5 });
    expect(report.pass2Details).toEqual({
      C0: { validPairCount: 8, passingPairCount: 4, rate: 0.5 },
      T: { validPairCount: 8, passingPairCount: 4, rate: 0.5 },
    });
  });

  it("reconciles missing, duplicate, extra, invalid-arm, and identity-drift facts visibly", () => {
    const facts = completeObservations();
    const missing = facts.findIndex((fact) => fact.pairId === "pair-1" && fact.repeatIndex === 0 && fact.arm === "T");
    facts.splice(missing, 1);
    facts.push(facts.find((fact) => fact.pairId === "pair-2" && fact.repeatIndex === 0 && fact.arm === "C0")!);
    facts.push({ ...facts[0]!, pairId: "unplanned", itemId: "extra" });
    facts.push({ ...facts[1]!, arm: "X" as never, itemId: "invalid-arm" });
    const identityIndex = facts.findIndex((fact) => fact.pairId === "pair-3" && fact.repeatIndex === 1 && fact.arm === "T");
    facts[identityIndex] = { ...facts[identityIndex]!, observedModel: "different-model" };

    const report = evaluateFormalVerificationScreening(facts, { pairIds: PAIR_IDS });

    expect(report.screeningReady).toBe(false);
    expect(report.reconciliation.missingArmSlots).toContain("pair-1:0:T");
    expect(report.reconciliation.duplicateSlots).toContain("pair-2:0:C0");
    expect(report.reconciliation.extraObservations).toEqual(expect.arrayContaining([
      "unplanned:0:C0",
    ]));
    expect(report.reconciliation.invalidArms).toContain("invalid-arm");
    expect(report.reconciliation.identityMismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ blockKey: "pair-3:1", arm: "T", field: "model" }),
    ]));
    expect(report.reconciliation.completeValidBlockCount).toBeLessThan(16);
  });

  it("fails closed for missing identity, fallback, non-exhaustive treatment, and invalid trials", () => {
    const facts = completeObservations();
    const treatment = facts.findIndex((fact) => fact.pairId === "pair-1" && fact.repeatIndex === 0 && fact.arm === "T");
    facts[treatment] = {
      ...facts[treatment]!,
      observedAccount: "wrong-account",
      hiddenOracleExhaustive: false,
      fallbackUsed: true,
    };
    const control = facts.findIndex((fact) => fact.pairId === "pair-2" && fact.repeatIndex === 0 && fact.arm === "C0");
    facts[control] = { ...facts[control]!, valid: false, expectedRoute: "" };

    const report = evaluateFormalVerificationScreening(facts, { pairIds: PAIR_IDS });

    expect(report.screeningReady).toBe(false);
    expect(report.gates.treatmentMechanicallySound).toBe(false);
    expect(report.reconciliation.identityMissing).toEqual(expect.arrayContaining([
      expect.objectContaining({ blockKey: "pair-2:0", arm: "C0", field: "expectedRoute" }),
    ]));
    expect(report.reconciliation.identityMismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ blockKey: "pair-1:0", arm: "T", field: "account" }),
    ]));
    expect(report.arms.T.invalidTrialCount).toBeGreaterThan(0);
    expect(report.reconciliation.invalidTrialRate).toBeGreaterThan(0);
  });

  it("requires distinct stable tool projections and host-owned lemma facts", () => {
    const facts = completeObservations();
    const drifting = facts.findIndex((fact) => fact.pairId === "pair-8" && fact.repeatIndex === 1 && fact.arm === "T");
    facts[drifting] = { ...facts[drifting]!, toolProjectionHash: "tools-treatment-drift" };
    const report = evaluateFormalVerificationScreening(facts, { pairIds: PAIR_IDS });

    expect(report.screeningReady).toBe(false);
    expect(report.gates.treatmentMechanicallySound).toBe(false);
    expect(report.reconciliation.identityMismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ blockKey: "pair-8:1", arm: "T", field: "toolProjectionHash" }),
    ]));

    const c0Lemma = completeObservations();
    const c0Index = c0Lemma.findIndex((fact) => fact.arm === "C0");
    c0Lemma[c0Index] = { ...c0Lemma[c0Index]!, lemmaCheckPassed: true };
    const c0Report = evaluateFormalVerificationScreening(c0Lemma, { pairIds: PAIR_IDS });
    expect(c0Report.screeningReady).toBe(false);
    expect(c0Report.reconciliation.invalidTrials).toContain(c0Lemma[c0Index]!.itemId);

    const driftingToolchain = completeObservations();
    const toolchainIndex = driftingToolchain.findIndex((fact) =>
      fact.pairId === "pair-7" && fact.repeatIndex === 1 && fact.arm === "T");
    driftingToolchain[toolchainIndex] = {
      ...driftingToolchain[toolchainIndex]!,
      treatmentToolchainHash: "toolchain-drift",
    };
    const toolchainReport = evaluateFormalVerificationScreening(driftingToolchain, { pairIds: PAIR_IDS });
    expect(toolchainReport.screeningReady).toBe(false);
    expect(toolchainReport.reconciliation.identityMismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ blockKey: "pair-7:1", arm: "T", field: "treatmentToolchainHash" }),
    ]));

    const sealedDrift = completeObservations();
    for (const arm of ["C0", "T"] as const) {
      const sealedIndex = sealedDrift.findIndex((fact) =>
        fact.pairId === "pair-6" && fact.repeatIndex === 1 && fact.arm === arm);
      sealedDrift[sealedIndex] = {
        ...sealedDrift[sealedIndex]!,
        sealedToolchainHash: "sealed-toolchain-drift",
        ...(arm === "T" ? { treatmentToolchainHash: "sealed-toolchain-drift" } : {}),
      };
    }
    const sealedReport = evaluateFormalVerificationScreening(sealedDrift, { pairIds: PAIR_IDS });
    expect(sealedReport.screeningReady).toBe(false);
    expect(sealedReport.reconciliation.identityMismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ blockKey: "pair-6:1", field: "sealedToolchainHash" }),
    ]));
  });

  it("keeps comparisonHash canonical and independent of outcome facts", () => {
    const facts = completeObservations();
    const baseline = evaluateFormalVerificationScreening(facts, { pairIds: PAIR_IDS });
    const changedOutcome = facts.map((fact) => ({
      ...fact,
      valid: !fact.valid,
      hiddenPassed: !fact.hiddenPassed,
      fallbackUsed: !fact.fallbackUsed,
      observedRoute: "different-route",
      observedProvider: "different-provider",
      observedModel: "different-model",
      observedAccount: "different-account",
      hiddenOracleExhaustive: !fact.hiddenOracleExhaustive,
      lemmaCheckPassed: !fact.lemmaCheckPassed,
      sealedDafnyPassed: !fact.sealedDafnyPassed,
      contractDigestUnchanged: !fact.contractDigestUnchanged,
      trustPolicyClean: !fact.trustPolicyClean,
    }));
    const changed = evaluateFormalVerificationScreening(changedOutcome, { pairIds: PAIR_IDS });

    expect(baseline.comparisonHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(changed.comparisonHash).toBe(baseline.comparisonHash);
  });

  it("scores qualified correctness from independent functional, Dafny, contract, and trust facts", () => {
    const facts = completeObservations();
    const dafnyFailure = facts.findIndex((fact) => fact.pairId === "pair-1" && fact.arm === "C0");
    const contractFailure = facts.findIndex((fact) => fact.pairId === "pair-2" && fact.arm === "C0");
    const trustFailure = facts.findIndex((fact) => fact.pairId === "pair-3" && fact.arm === "C0");
    facts[dafnyFailure] = { ...facts[dafnyFailure]!, sealedDafnyPassed: false };
    facts[contractFailure] = { ...facts[contractFailure]!, contractDigestUnchanged: false };
    facts[trustFailure] = { ...facts[trustFailure]!, trustPolicyClean: false };

    const report = evaluateFormalVerificationScreening(facts, { pairIds: PAIR_IDS });

    expect(report.arms.C0.hiddenPass1).toBe(0.5);
    expect(report.arms.C0.qualifiedPass1).toBeLessThan(report.arms.C0.hiddenPass1);
    expect(report.pass1.C0).toBe(report.arms.C0.qualifiedPass1);
    expect(report.reconciliation.invalidTrialCount).toBe(0);
  });

  it("invalidates missing sealed host observations without treating a negative result as infrastructure failure", () => {
    const missing = completeObservations();
    const missingIndex = missing.findIndex((fact) => fact.arm === "C0");
    missing[missingIndex] = {
      ...missing[missingIndex]!,
      sealedDafnyPassed: undefined as never,
    };
    const missingReport = evaluateFormalVerificationScreening(missing, { pairIds: PAIR_IDS });
    expect(missingReport.reconciliation.invalidTrials).toContain(missing[missingIndex]!.itemId);

    const negative = completeObservations();
    const negativeIndex = negative.findIndex((fact) => fact.arm === "C0");
    negative[negativeIndex] = {
      ...negative[negativeIndex]!,
      sealedDafnyPassed: false,
      contractDigestUnchanged: false,
      trustPolicyClean: false,
    };
    const negativeReport = evaluateFormalVerificationScreening(negative, { pairIds: PAIR_IDS });
    expect(negativeReport.reconciliation.invalidTrials).not.toContain(negative[negativeIndex]!.itemId);
  });
});
