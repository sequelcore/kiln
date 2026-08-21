import { describe, expect, it } from "vitest";
import {
  buildDafnyDifferentialProgram,
  DAFNY_DIFFERENTIAL_OUTPUT_SCHEMA,
  type DafnyObservation,
  mutateDafnyTranslation,
  parseLemmaScriptObservationLines,
} from "./lemma-script-dafny-differential.js";

const GENERATED_DAFNY = `
function accessPolicy(authenticated: bool, canRead: bool): string
{
  if (authenticated && canRead) then "allow" else "deny"
}
`;

const CANONICAL_ROWS: readonly string[] = [
  `${DAFNY_DIFFERENTIAL_OUTPUT_SCHEMA}|authenticated=false|canRead=false|result=AccessDecision.deny`,
  `${DAFNY_DIFFERENTIAL_OUTPUT_SCHEMA}|authenticated=false|canRead=true|result=AccessDecision.deny`,
  `${DAFNY_DIFFERENTIAL_OUTPUT_SCHEMA}|authenticated=true|canRead=false|result=AccessDecision.deny`,
  `${DAFNY_DIFFERENTIAL_OUTPUT_SCHEMA}|authenticated=true|canRead=true|result=AccessDecision.allow`,
];

describe("Dafny differential driver", () => {
  it("derives Main with four accessPolicy calls and does not hardcode expected results", () => {
    const result = buildDafnyDifferentialProgram(GENERATED_DAFNY);

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.program.startsWith(GENERATED_DAFNY)).toBe(true);
    expect(result.program).toContain("method Main()");
    expect(result.derivedMain.match(/accessPolicy\(/gu)).toHaveLength(4);
    expect(result.derivedMain).not.toContain("allow");
    expect(result.derivedMain).not.toContain("deny");
    expect(result.facts.callCount).toBe(4);
  });

  it("parses Java stdout with only explicitly known Dafny noise", () => {
    const stdout = [
      "Dafny program verifier finished with 0 verified, 0 errors",
      "",
      CANONICAL_ROWS[2],
      CANONICAL_ROWS[0],
      CANONICAL_ROWS[3],
      CANONICAL_ROWS[1],
      "",
    ].join("\n");

    const result = parseLemmaScriptObservationLines(stdout);

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.observations.map(({ key, result: decision }) => `${key}:${decision}`)).toEqual([
      "false,false:deny",
      "false,true:deny",
      "true,false:deny",
      "true,true:allow",
    ]);
    expect(result.observations[0]?.line).toBe(
      `${DAFNY_DIFFERENTIAL_OUTPUT_SCHEMA}|authenticated=false|canRead=false|result=deny`,
    );
  });

  it.each([
    ["missing row", CANONICAL_ROWS.slice(0, 3).join("\n")],
    ["duplicate row", [...CANONICAL_ROWS, CANONICAL_ROWS[0]].join("\n")],
    [
      "unknown result",
      CANONICAL_ROWS.map((line, index) =>
        index === 2 ? line.replace("AccessDecision.deny", "AccessDecision.maybe") : line,
      ).join("\n"),
    ],
    ["unknown stdout", [...CANONICAL_ROWS, "unexpected runtime text"].join("\n")],
  ] as const)("rejects malformed stdout: %s", (_label, stdout) => {
    const result = parseLemmaScriptObservationLines(stdout);

    expect(result.status).toBe("invalid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("Dafny mutation calibration", () => {
  it("replaces exactly one executable conjunction with disjunction", () => {
    const result = mutateDafnyTranslation(GENERATED_DAFNY);

    expect(result.status).toBe("mutated");
    if (result.status !== "mutated") return;
    expect(result.source).toContain("if (authenticated || canRead) then");
    expect(result.source.match(/if \(authenticated \|\| canRead\) then/gu)).toHaveLength(1);
  });

  it.each([
    ["no executable occurrence", GENERATED_DAFNY.replace("authenticated && canRead", "authenticated || canRead")],
    [
      "multiple executable occurrences",
      `${GENERATED_DAFNY}\nfunction other(authenticated: bool, canRead: bool): string { if (authenticated && canRead) then "x" else "y" }`,
    ],
  ] as const)("returns typed invalid for %s", (_label, source) => {
    const result = mutateDafnyTranslation(source);

    expect(result.status).toBe("invalid");
    expect(result.diagnostics.map(({ code }) => code)).toContain("mutation-occurrence-count");
  });

  it("does not mutate an occurrence inside a comment", () => {
    const source = `// if (authenticated && canRead) then\n${GENERATED_DAFNY}`;

    const result = mutateDafnyTranslation(source);

    expect(result.status).toBe("mutated");
    if (result.status !== "mutated") return;
    expect(result.source.startsWith("// if (authenticated && canRead) then")).toBe(true);
  });
});

it("keeps the observation type independent from expected values", () => {
  const observation: DafnyObservation = {
    key: "false,false",
    authenticated: false,
    canRead: false,
    result: "deny",
    line: CANONICAL_ROWS[0] ?? "",
  };
  expect(observation).not.toHaveProperty("expected");
});
