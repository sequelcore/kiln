import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DAFNY_OBSERVATION_SCHEMA,
  LEMMA_SCRIPT_ACCESS_POLICY_FUNCTION,
  TYPESCRIPT_OBSERVATION_SCHEMA,
} from "./lemma-script-differential-oracle.js";
import type { LemmaScriptDifferentialRunnerInput } from "./lemma-script-differential-runner.js";
import { runLemmaScriptDifferential } from "./lemma-script-differential-runner.js";
import {
  type LemmaScriptProcessRequest,
  type LemmaScriptProcessResult,
  type LemmaScriptProcessRunner,
  runLemmaScriptQualification,
} from "./lemma-script-qualification.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const EVALUATOR_SCRIPT = resolve(REPOSITORY_ROOT, "scripts/lemma-script-typescript-evaluator.ts");
const temporaryRoots: string[] = [];
const typedInfo = {
  schema: 1,
  lemmascript: "0.9.0",
  file: "staged-source.ts",
  backendDirective: null,
  typeDecls: [{ name: "AccessDecision", kind: "string-union", values: ["allow", "deny"] }],
  externs: [],
  constants: [],
  functions: [
    {
      name: LEMMA_SCRIPT_ACCESS_POLICY_FUNCTION,
      exported: true,
      typeParams: [],
      params: [
        { name: "authenticated", tsType: "boolean", ty: { kind: "bool" } },
        { name: "canRead", tsType: "boolean", ty: { kind: "bool" } },
      ],
      returnTy: { kind: "string", values: ["allow", "deny"] },
      requires: [],
      ensures: [{ kind: "bool", value: true, ty: { kind: "bool" } }],
      decreases: null,
      contract: [],
      isPure: true,
      forcePure: false,
      autohavoc: false,
      bodyKinds: ["return", "conditional", "bool", "str"],
    },
  ],
  classes: [],
  dafny: {},
};
const generatedDafny = `datatype AccessDecision = allow | deny

function accessPolicy(authenticated: bool, canRead: bool): AccessDecision
{
  if (authenticated && canRead) then AccessDecision.allow else AccessDecision.deny
}
`;
const cases = {
  schema: "kiln.lemma-script-qualification-v1",
  function: LEMMA_SCRIPT_ACCESS_POLICY_FUNCTION,
  inputs: [
    { authenticated: false, canRead: false, expected: "deny" },
    { authenticated: false, canRead: true, expected: "deny" },
    { authenticated: true, canRead: false, expected: "deny" },
    { authenticated: true, canRead: true, expected: "allow" },
  ],
} as const;
const tsOutput = [
  `${TYPESCRIPT_OBSERVATION_SCHEMA}|authenticated=false|canRead=false|result=deny`,
  `${TYPESCRIPT_OBSERVATION_SCHEMA}|authenticated=false|canRead=true|result=deny`,
  `${TYPESCRIPT_OBSERVATION_SCHEMA}|authenticated=true|canRead=false|result=deny`,
  `${TYPESCRIPT_OBSERVATION_SCHEMA}|authenticated=true|canRead=true|result=allow`,
].join("\n");
const dafnyOutput = [
  `${DAFNY_OBSERVATION_SCHEMA}|authenticated=false|canRead=false|result=AccessDecision.deny`,
  `${DAFNY_OBSERVATION_SCHEMA}|authenticated=false|canRead=true|result=AccessDecision.deny`,
  `${DAFNY_OBSERVATION_SCHEMA}|authenticated=true|canRead=false|result=AccessDecision.deny`,
  `${DAFNY_OBSERVATION_SCHEMA}|authenticated=true|canRead=true|result=AccessDecision.allow`,
].join("\n");
const mutantDafnyOutput = [
  `${DAFNY_OBSERVATION_SCHEMA}|authenticated=false|canRead=false|result=AccessDecision.deny`,
  `${DAFNY_OBSERVATION_SCHEMA}|authenticated=false|canRead=true|result=AccessDecision.allow`,
  `${DAFNY_OBSERVATION_SCHEMA}|authenticated=true|canRead=false|result=AccessDecision.allow`,
  `${DAFNY_OBSERVATION_SCHEMA}|authenticated=true|canRead=true|result=AccessDecision.allow`,
].join("\n");

interface Scenario {
  readonly cleanDafnyOutput?: string;
  readonly mutantDafnyOutput?: string;
  readonly mutantExitCode?: number;
  readonly mutateSourceOnEvaluator?: boolean;
  readonly mutateLscOnVersion?: boolean;
  readonly duplicateDafnyOutput?: boolean;
}

interface Fixture {
  readonly root: string;
  readonly input: LemmaScriptDifferentialRunnerInput;
  readonly paths: {
    readonly source: string;
    readonly cases: string;
    readonly lsc: string;
    readonly dafny: string;
    readonly java: string;
    readonly javac: string;
    readonly jar: string;
  };
  readonly calls: LemmaScriptProcessRequest[];
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeFixture(scenario: Scenario = {}): {
  readonly fixture: Fixture;
  readonly processRunner: LemmaScriptProcessRunner;
} {
  const root = mkdtempSync(join(tmpdir(), "kiln-lemma-script-differential-runner-test-"));
  temporaryRoots.push(root);
  const javaBin = join(root, "java-bin");
  const source = join(root, "staged-source.ts");
  const casesPath = join(root, "cases.json");
  const lsc = join(root, "lsc.js");
  const dafny = join(root, "dafny.exe");
  const java = join(javaBin, "java.exe");
  const javac = join(javaBin, "javac.exe");
  const jar = join(javaBin, "jar.exe");
  mkdirSync(javaBin);
  writeFileSync(
    source,
    'export function accessPolicy(authenticated: boolean, canRead: boolean): "allow" | "deny" { return authenticated && canRead ? "allow" : "deny"; }\n',
  );
  writeFileSync(casesPath, JSON.stringify(cases));
  for (const path of [lsc, dafny, java, javac, jar]) writeFileSync(path, "fixture");
  const input: LemmaScriptDifferentialRunnerInput = {
    sourcePath: source,
    caseManifestPath: casesPath,
    lscScriptPath: lsc,
    dafnyExecutable: dafny,
    javaExecutable: java,
    javacExecutable: javac,
    jarExecutable: jar,
    expectedLemmaScriptVersion: "0.9.0",
    expectedDafnyVersion: "4.11.0",
    expectedJavaVersion: "17.0.1",
    timeoutMs: 1_000,
  };
  const paths = { source, cases: casesPath, lsc, dafny, java, javac, jar };
  const calls: LemmaScriptProcessRequest[] = [];
  const processRunner: LemmaScriptProcessRunner = async (request) => {
    calls.push(request);
    const [first, second, third, fourth, fifth] = request.args;
    if (request.executable === process.execPath && second === "version") {
      if (scenario.mutateLscOnVersion) writeFileSync(lsc, "mutated lsc");
      return success("0.9.0\n");
    }
    if (request.executable === dafny && first === "--version") return success("Dafny 4.11.0\n");
    if (request.executable === java && first === "--version") return success("java 17.0.1\n");
    if (request.executable === javac && first === "--version") return success("javac 17.0.1\n");
    if (request.executable === jar && first === "--version") return success("jar 17.0.1\n");
    if (request.executable === process.execPath && second === "info" && third === "--typed") {
      return success(JSON.stringify(typedInfo));
    }
    if (request.executable === process.execPath && second === "gen" && third === "--backend=dafny") {
      const stagedSource = request.args.at(-1);
      if (stagedSource === undefined) return failure();
      const stem = stagedSource.slice(0, -".ts".length);
      writeFileSync(`${stem}.dfy.gen`, generatedDafny);
      writeFileSync(`${stem}.dfy`, generatedDafny);
      return success("generated\n");
    }
    if (request.executable === dafny && first === "verify") {
      const logArgument = request.args.find((argument) => argument.startsWith("csv;LogFileName="));
      const logName = logArgument?.slice("csv;LogFileName=".length);
      if (logName !== undefined) {
        writeFileSync(
          join(request.cwd, logName),
          "TestResult.DisplayName,TestResult.Result,TestResult.Duration,TestResult.ResourceCount,TestResult.VC\naccessPolicy (correctness),Passed,00:00:00.001,1,1\n",
        );
      }
      return success();
    }
    if (request.executable === process.execPath && first === "run" && request.args.includes(EVALUATOR_SCRIPT)) {
      if (scenario.mutateSourceOnEvaluator) writeFileSync(source, "mutated source\n");
      return success(`${tsOutput}\n`);
    }
    if (
      request.executable === dafny &&
      first === "run" &&
      second === "--target" &&
      third === "java" &&
      fourth === "--no-verify"
    ) {
      if (!request.env?.PATH?.startsWith(javaBin)) return failure();
      const programPath = fifth ?? "";
      if (basename(programPath) === "mutant.dfy") {
        if (scenario.mutantExitCode !== undefined) return { ...success(), exitCode: scenario.mutantExitCode };
        return success(scenario.mutantDafnyOutput ?? mutantDafnyOutput);
      }
      const output = scenario.cleanDafnyOutput ?? dafnyOutput;
      return success(scenario.duplicateDafnyOutput ? `${output}\n${output}` : `${output}\n`);
    }
    return failure();
  };
  return { fixture: { root, input, paths, calls }, processRunner };
}

function success(stdout = ""): LemmaScriptProcessResult {
  return { exitCode: 0, signal: null, stdout, stderr: "", timedOut: false };
}

function failure(): LemmaScriptProcessResult {
  return { exitCode: 1, signal: null, stdout: "", stderr: "synthetic process failure", timedOut: false };
}

describe("runLemmaScriptDifferential", () => {
  it("runs qualification, the staged TypeScript child, clean Dafny, and a killed mutant", async () => {
    const { fixture, processRunner } = makeFixture();

    const result = await runLemmaScriptDifferential(fixture.input, { processRunner });

    expect(result.status).toBe("equivalent");
    expect(result.semanticEquivalence).toBe("equivalent_for_enumerated_domain");
    expect(result.mutation.status).toBe("killed");
    expect(result.benchmarkReady).toBe(false);
    expect(result.facts.versions).toEqual({
      lemmaScript: { expected: "0.9.0", observed: "0.9.0" },
      dafny: { expected: "4.11.0", observed: "4.11.0" },
      java: { expected: "17.0.1", observed: "17.0.1" },
      javac: "17.0.1",
      jar: "17.0.1",
    });
    expect(result.facts.digests.source).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.facts.digests.manifest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.facts.digests.cleanProgram).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(result)).not.toContain(fixture.root);
  });

  it("rejects Java tools that do not share one regular non-symlink bin directory", async () => {
    const { fixture, processRunner } = makeFixture();
    const otherJava = join(fixture.root, "other-java.exe");
    writeFileSync(otherJava, "fixture");

    const result = await runLemmaScriptDifferential({ ...fixture.input, javaExecutable: otherJava }, { processRunner });

    expect(result.status).toBe("invalid");
    expect(result.diagnostics.join(" ")).toMatch(/Java|bin|directory/i);
    expect(fixture.calls).toHaveLength(0);
  });

  it("reports a valid clean mismatch while preserving the mutation evidence", async () => {
    const { fixture, processRunner } = makeFixture({
      cleanDafnyOutput: dafnyOutput.replace("result=AccessDecision.allow", "result=AccessDecision.deny"),
    });

    const result = await runLemmaScriptDifferential(fixture.input, { processRunner });

    expect(result.status).toBe("mismatch");
    expect(result.semanticEquivalence).toBe("mismatch");
    expect(result.mutation.status).toBe("killed");
  });

  it.each([
    ["survived", { mutantDafnyOutput: dafnyOutput }],
    ["compile failure", { mutantExitCode: 1 }],
    ["missing observations", { cleanDafnyOutput: dafnyOutput.split("\n").slice(0, 3).join("\n") }],
    ["duplicate observations", { duplicateDafnyOutput: true }],
  ] as const)("fails closed for mutant/observation evidence: %s", async (_label, scenario) => {
    const { fixture, processRunner } = makeFixture(scenario);

    const result = await runLemmaScriptDifferential(fixture.input, { processRunner });

    expect(result.status).toBe("invalid");
    expect(result.mutation.status).not.toBe("killed");
  });

  it("fails closed when an observed artifact drifts before endpoint rehash", async () => {
    const { fixture, processRunner } = makeFixture({ mutateSourceOnEvaluator: true });

    const result = await runLemmaScriptDifferential(fixture.input, { processRunner });

    expect(result.status).toBe("invalid");
    expect(result.diagnostics.join(" ")).toMatch(/digest|drift|source/i);
  });

  it("fails closed when the observed LemmaScript entrypoint drifts during qualification", async () => {
    const { fixture, processRunner } = makeFixture({ mutateLscOnVersion: true });

    const result = await runLemmaScriptDifferential(fixture.input, { processRunner });

    expect(result.status).toBe("invalid");
    expect(result.diagnostics.join(" ")).toMatch(/qualification/i);
  });

  it("returns a typed cleanup failure without exposing the temporary path", async () => {
    const { fixture, processRunner } = makeFixture();

    const result = await runLemmaScriptDifferential(fixture.input, {
      processRunner,
      cleanupWorkspace: async () => {
        throw new Error("synthetic cleanup failure");
      },
    });

    expect(result.status).toBe("invalid");
    expect(result.diagnostics.join(" ")).toMatch(/cleanup/i);
    expect(JSON.stringify(result)).not.toContain(fixture.root);
  });

  it("keeps staged fixtures portable", () => {
    const { fixture } = makeFixture();
    expect(readFileSync(fixture.paths.source, "utf8")).not.toContain(fixture.root);
    expect(existsSync(fixture.paths.cases)).toBe(true);
  });
});

describe("qualification process environment", () => {
  it("preserves the existing process runner contract for a supplied environment", async () => {
    const { fixture } = makeFixture();
    const requests: LemmaScriptProcessRequest[] = [];
    const result = await runLemmaScriptQualification(fixture.input as never, {
      processRunner: async (request) => {
        requests.push(request);
        return failure();
      },
    });

    expect(result.status).toBe("failed");
    expect(requests.every((request) => request.env === undefined)).toBe(true);
  });
});
