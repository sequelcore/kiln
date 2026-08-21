import { describe, expect, it } from "vitest";
import {
  assessLemmaScriptMutation,
  evaluateLemmaScriptDifferentialOracle,
  type LemmaScriptCaseManifest,
  type LemmaScriptObservation,
  parseLemmaScriptCases,
  parseLemmaScriptObservations,
} from "./lemma-script-differential-oracle.js";

const CASES = {
  schema: "kiln.lemma-script-qualification-v1",
  function: "accessPolicy",
  inputs: [
    { authenticated: false, canRead: false, expected: "deny" },
    { authenticated: false, canRead: true, expected: "deny" },
    { authenticated: true, canRead: false, expected: "deny" },
    { authenticated: true, canRead: true, expected: "allow" },
  ],
} as const satisfies LemmaScriptCaseManifest;

const OBSERVATIONS: readonly LemmaScriptObservation[] = [
  { key: "false,false", value: "deny" },
  { key: "false,true", value: "deny" },
  { key: "true,false", value: "deny" },
  { key: "true,true", value: "allow" },
];

const REVERSED_OBSERVATIONS = [...OBSERVATIONS].reverse();

describe("LemmaScript differential oracle", () => {
  it("accepts the exact v1 fixture and compares four rows independent of order", () => {
    const parsedCases = parseLemmaScriptCases(CASES);
    expect(parsedCases.status).toBe("valid");

    const result = evaluateLemmaScriptDifferentialOracle({
      cases: CASES,
      tsObservations: REVERSED_OBSERVATIONS,
      dafnyObservations: OBSERVATIONS,
    });

    expect(result.status).toBe("equivalent");
    expect(result.semanticEquivalence).toBe("equivalent_for_enumerated_domain");
    expect(result.benchmarkReady).toBe(false);
    expect(result).not.toHaveProperty("acceptance");
    expect(result.facts.comparisons).toHaveLength(4);
    expect(result.diagnostics).toEqual([]);
  });

  it("parses canonical evaluator lines and evaluator observation objects", () => {
    const output = [
      "kiln.lemma-script-typescript-evaluator/v1|authenticated=false|canRead=false|result=deny",
      "kiln.lemma-script-typescript-evaluator/v1|authenticated=false|canRead=true|result=deny",
      "kiln.lemma-script-typescript-evaluator/v1|authenticated=true|canRead=false|result=deny",
      "kiln.lemma-script-typescript-evaluator/v1|authenticated=true|canRead=true|result=allow",
    ].join("\n");
    const parsedLines = parseLemmaScriptObservations(`${output}\n`, "typescript");
    expect(parsedLines.status).toBe("valid");

    const parsedRows = parseLemmaScriptObservations(OBSERVATIONS, "typescript");
    expect(parsedRows.status).toBe("valid");
  });

  it.each([
    ["schema", { ...CASES, schema: "other" }],
    ["function", { ...CASES, function: "other" }],
    ["missing function", { schema: CASES.schema, inputs: CASES.inputs }],
    ["extra manifest field", { ...CASES, extra: true }],
    ["extra case field", { ...CASES, inputs: [...CASES.inputs.slice(0, 3), { ...CASES.inputs[3], extra: true }] }],
    [
      "unknown expected value",
      { ...CASES, inputs: [...CASES.inputs.slice(0, 3), { ...CASES.inputs[3], expected: "maybe" }] },
    ],
    [
      "duplicate case key",
      {
        ...CASES,
        inputs: [...CASES.inputs.slice(0, 3), { authenticated: true, canRead: false, expected: "deny" }],
      },
    ],
    ["missing case", { ...CASES, inputs: CASES.inputs.slice(0, 3) }],
  ] as const)("rejects malformed case manifest: %s", (_label, value) => {
    const result = parseLemmaScriptCases(value);

    expect(result.status).toBe("invalid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.message).toMatch(/case|schema|function|field|expected/i);
  });

  it.each([
    ["missing row", OBSERVATIONS.slice(0, 3)],
    ["duplicate row", [...OBSERVATIONS.slice(0, 3), { key: "true,false", value: "deny" }]],
    ["extra key", [...OBSERVATIONS, { key: "true,true", value: "allow" }]],
    ["unknown decision", [...OBSERVATIONS.slice(0, 3), { key: "true,true", value: "maybe" }]],
    ["malformed row", [{ key: "not-a-case", value: "deny" }]],
  ] as const)("rejects malformed observations: %s", (_label, value) => {
    const result = parseLemmaScriptObservations(value, "typescript");

    expect(result.status).toBe("invalid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("reports the exact rows where TS, Dafny, and expected disagree", () => {
    const dafny = OBSERVATIONS.map((observation) =>
      observation.key === "true,true" ? { ...observation, value: "deny" as const } : observation,
    );

    const result = evaluateLemmaScriptDifferentialOracle({
      cases: CASES,
      tsObservations: OBSERVATIONS,
      dafnyObservations: dafny,
    });

    expect(result.status).toBe("mismatch");
    expect(result.semanticEquivalence).toBe("mismatch");
    expect(result.benchmarkReady).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(["dafny-expected-mismatch"]));
    expect(result.diagnostics.map(({ message }) => message).join(" ")).toMatch(/true,true/);
  });

  it("returns invalid when either observation source cannot be parsed", () => {
    const result = evaluateLemmaScriptDifferentialOracle({
      cases: CASES,
      tsObservations: OBSERVATIONS,
      dafnyObservations: OBSERVATIONS.slice(0, 3),
    });

    expect(result.status).toBe("invalid");
    expect(result.semanticEquivalence).toBe("invalid");
    expect(result.benchmarkReady).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain("dafny-observations-invalid");
  });
});

describe("LemmaScript mutation assessment", () => {
  it("marks a mutator killed only when four valid rows differ from expected", () => {
    const mutant = OBSERVATIONS.map((observation) =>
      observation.key === "false,true" ? { ...observation, value: "allow" as const } : observation,
    );

    const result = assessLemmaScriptMutation({
      cases: CASES,
      observations: mutant,
      execution: "executed",
    });

    expect(result.status).toBe("killed");
    expect(result.benchmarkReady).toBe(false);
    expect(result.facts.validObservationCount).toBe(4);
    expect(result.facts.differingKeys).toEqual(["false,true"]);
  });

  it("does not call a compile or parse failure killed", () => {
    const result = assessLemmaScriptMutation({
      cases: CASES,
      observations: OBSERVATIONS,
      execution: "compile_failure",
    });

    expect(result.status).toBe("invalid");
    expect(result.benchmarkReady).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain("mutation-execution-invalid");
  });

  it("marks a fully valid non-differing mutator survived", () => {
    const result = assessLemmaScriptMutation({
      cases: CASES,
      observations: OBSERVATIONS,
      execution: "executed",
    });

    expect(result.status).toBe("survived");
    expect(result.facts.validObservationCount).toBe(4);
    expect(result.facts.differingKeys).toEqual([]);
  });
});
