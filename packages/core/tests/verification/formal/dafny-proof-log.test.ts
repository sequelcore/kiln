import { describe, expect, it } from "vitest";
import {
  correctnessEfforts,
  parseDafnyProofDiagnostics,
  parseDafnyProofEfforts,
  parseDafnyProofLog,
} from "../../../src/verification/formal/dafny-proof-log.js";

/**
 * Captured from Dafny 4.11.0 `--log-format csv` over a bounded-work scope
 * policy model. Paths and identifiers are synthetic.
 */
const PASSING_CSV = [
  "TestResult.DisplayName,TestResult.Outcome,TestResult.Duration,TestResult.ResourceCount,RandomSeed",
  "pathWithinRoot (well-formedness),Passed,00:00:00.6639600,12208,0",
  "pathWithinRoot_ensures (correctness),Passed,00:00:00.6530133,13020,0",
  "matchesAnyRoot (well-formedness),Passed,00:00:00.6465027,16984,0",
  "matchesAnyRoot (correctness),Passed,00:00:00.0254137,34930,0",
  "admitsPath (well-formedness),Passed,00:00:00.0237934,22608,0",
  "admitsPath (correctness),Passed,00:00:00.0230392,26991,0",
].join("\n");

const FAILING_CSV = [
  "TestResult.DisplayName,TestResult.Outcome,TestResult.Duration,TestResult.ResourceCount,RandomSeed",
  "pathWithinRoot (well-formedness),Passed,00:00:00.7088794,12208,0",
  "matchesAnyRoot (correctness),Passed,00:00:00.0330696,34930,0",
  "admitsPath (correctness),Failed,00:00:00.0555078,30121,0",
].join("\n");

/** Captured from `--json-output`, with the absolute workspace path removed. */
const FAILING_JSON = [
  JSON.stringify({
    type: "diagnostic",
    value: {
      location: {
        filename: "scope-policy.dfy",
        range: { start: { pos: 1669, line: 44, character: 4 }, end: { pos: 1681, line: 44, character: 16 } },
      },
      severity: 1,
      defaultFormatMessage: "a postcondition could not be proved on this return path",
      source: "Verifier",
      relatedInformation: [
        {
          location: { filename: "scope-policy.dfy", range: { start: { line: 39, character: 113 } } },
          defaultFormatMessage: "this is the postcondition that could not be proved",
        },
      ],
    },
  }),
  JSON.stringify({ type: "status", value: "\nDafny program verifier finished with 5 verified, 2 errors\n" }),
].join("\n");

describe("parseDafnyProofEfforts", () => {
  it("parses every effort from a passing run", () => {
    expect(parseDafnyProofEfforts(PASSING_CSV)).toHaveLength(6);
  });

  it("splits the display name into symbol and check", () => {
    const [first] = parseDafnyProofEfforts(PASSING_CSV);
    expect(first).toEqual({
      symbol: "pathWithinRoot",
      check: "well-formedness",
      outcome: "passed",
      durationMs: 664,
      resourceCount: 12208,
    });
  });

  it("marks a failed effort as failed", () => {
    const failed = parseDafnyProofEfforts(FAILING_CSV).filter((e) => e.outcome === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.symbol).toBe("admitsPath");
    expect(failed[0]?.check).toBe("correctness");
  });

  it("treats an unrecognized outcome as inconclusive rather than passing", () => {
    const csv = "TestResult.DisplayName,TestResult.Outcome,TestResult.Duration,TestResult.ResourceCount,RandomSeed\nf (correctness),Skipped,00:00:00.1000000,10,0";
    expect(parseDafnyProofEfforts(csv)[0]?.outcome).toBe("inconclusive");
  });

  it("skips malformed rows instead of inventing an effort", () => {
    const csv = "TestResult.DisplayName,TestResult.Outcome,TestResult.Duration,TestResult.ResourceCount,RandomSeed\nno parentheses,Passed,00:00:00.1,10,0\ngood (correctness),Passed,00:00:00.1000000,10,0";
    const efforts = parseDafnyProofEfforts(csv);
    expect(efforts).toHaveLength(1);
    expect(efforts[0]?.symbol).toBe("good");
  });

  it("returns nothing for an empty log", () => {
    expect(parseDafnyProofEfforts("")).toEqual([]);
  });

  it("converts the duration to milliseconds", () => {
    const csv = "TestResult.DisplayName,TestResult.Outcome,TestResult.Duration,TestResult.ResourceCount,RandomSeed\nf (correctness),Passed,00:01:02.5000000,10,0";
    expect(parseDafnyProofEfforts(csv)[0]?.durationMs).toBe(62500);
  });
});

describe("parseDafnyProofDiagnostics", () => {
  it("extracts the failure location and message", () => {
    const [diagnostic] = parseDafnyProofDiagnostics(FAILING_JSON);
    expect(diagnostic).toEqual({
      file: "scope-policy.dfy",
      line: 44,
      character: 4,
      message: "a postcondition could not be proved on this return path",
      related: ["this is the postcondition that could not be proved"],
    });
  });

  it("ignores status records", () => {
    expect(parseDafnyProofDiagnostics(FAILING_JSON)).toHaveLength(1);
  });

  it("skips unparseable lines rather than throwing", () => {
    expect(parseDafnyProofDiagnostics('{"type":"diagnostic"\nnot json')).toEqual([]);
  });
});

describe("correctnessEfforts", () => {
  it("keeps only the efforts that discharge ensures clauses", () => {
    const log = parseDafnyProofLog({ csv: PASSING_CSV });
    expect(correctnessEfforts(log).map((effort) => effort.symbol)).toEqual([
      "pathWithinRoot_ensures",
      "matchesAnyRoot",
      "admitsPath",
    ]);
  });
});
