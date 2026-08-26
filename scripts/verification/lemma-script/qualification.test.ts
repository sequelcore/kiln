import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildLemmaScriptChildEnvironment,
  type LemmaScriptProcessRequest,
  type LemmaScriptProcessResult,
  type LemmaScriptQualificationInput,
  main,
  runLemmaScriptQualification,
} from "./qualification.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");
const FIXTURE_PARENT = resolve(REPOSITORY_ROOT, "..");
const FIXTURE_SOURCE = resolve(import.meta.dirname, "fixtures/qualification-v1/access-policy.ts");
const TYPED_INFO = {
  schema: 1,
  lemmascript: "0.9.0",
  file: "access-policy.ts",
  backendDirective: null,
  typeDecls: [{ name: "AccessDecision", kind: "string-union", values: ["allow", "deny"] }],
  externs: [],
  constants: [],
  functions: [
    {
      name: "accessPolicy",
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
const generatedDafny = "method accessPolicy() { }\n";
const temporaryRoots: string[] = [];

type VerificationMode = "passed" | "no_checks" | "failed" | "inconclusive" | "missing_log" | "diagnostics";

interface ProcessRunnerOptions {
  readonly generated?: string;
  readonly proof?: string;
  readonly omitGenerated?: boolean;
  readonly omitProof?: boolean;
  readonly verification?: VerificationMode;
  readonly dafnyVersion?: string;
  readonly mutateProofDuringVerification?: boolean;
  readonly mutateLemmaScriptDuringVersion?: boolean;
  readonly mutateDependencyDuringVersion?: boolean;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createToolInputs(): { readonly input: LemmaScriptQualificationInput; readonly root: string } {
  const root = mkdtempSync(join(FIXTURE_PARENT, ".lemma-script-qualification-test-"));
  temporaryRoots.push(root);
  const lscScriptPath = join(root, "tools", "dist", "lsc.js");
  const dafnyExecutable = join(root, "dafny");
  mkdirSync(join(root, "tools", "dist"), { recursive: true });
  mkdirSync(join(root, "node_modules", "lemmascript"), { recursive: true });
  mkdirSync(join(root, "node_modules", "runtime-dependency"), { recursive: true });
  mkdirSync(join(root, "tools", "node_modules", "lemmascript"), { recursive: true });
  writeFileSync(lscScriptPath, "#!/usr/bin/env node\n", "utf8");
  writeFileSync(dafnyExecutable, "dafny fixture executable\n", "utf8");
  writeFileSync(
    join(root, "node_modules", "lemmascript", "package.json"),
    '{"name":"lemmascript","version":"0.6.0"}\n',
  );
  writeFileSync(join(root, "node_modules", "lemmascript", "index.js"), "export const version = '0.6.0';\n");
  writeFileSync(
    join(root, "node_modules", "runtime-dependency", "package.json"),
    '{"name":"runtime-dependency","version":"1.0.0"}\n',
  );
  writeFileSync(join(root, "node_modules", "runtime-dependency", "index.js"), "export const runtime = true;\n");
  writeFileSync(
    join(root, "tools", "node_modules", "lemmascript", "package.json"),
    '{"name":"lemmascript","version":"0.5.9"}\n',
  );
  writeFileSync(join(root, "tools", "node_modules", "lemmascript", "index.js"), "export const version = '0.5.9';\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "lemma-host",
      version: "1.0.0",
      bin: { lsc: "tools/dist/lsc.js" },
      dependencies: { lemmascript: "0.6.0", "runtime-dependency": "1.0.0" },
    }),
  );
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      name: "lemma-host",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "lemma-host",
          version: "1.0.0",
          dependencies: { lemmascript: "0.6.0", "runtime-dependency": "1.0.0" },
        },
        "node_modules/lemmascript": { version: "0.6.0", dependencies: {} },
        "node_modules/runtime-dependency": { version: "1.0.0", dependencies: {} },
      },
    }),
  );
  writeFileSync(
    join(root, "tools", "package-lock.json"),
    JSON.stringify({
      name: "lemma-tools",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": { name: "lemma-tools", version: "1.0.0", dependencies: { lemmascript: "0.5.9" } },
        "node_modules/lemmascript": { version: "0.5.9", dependencies: {} },
      },
    }),
  );
  return {
    root,
    input: {
      sourcePath: FIXTURE_SOURCE,
      lemmaScriptPackageRoot: root,
      lscScriptPath,
      dafnyExecutable,
      expectedLemmaScriptVersion: "0.9.0",
      expectedDafnyVersion: "4.11.0",
      requiredFunctionNames: ["accessPolicy"],
    },
  };
}

function successfulProcessResult(stdout = ""): LemmaScriptProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout,
    stderr: "",
    timedOut: false,
  };
}

function processRunnerFor(
  calls: LemmaScriptProcessRequest[],
  options: ProcessRunnerOptions = {},
): (request: LemmaScriptProcessRequest) => Promise<LemmaScriptProcessResult> {
  return async (request) => {
    calls.push(request);
    const [first, second, third] = request.args;
    if (second === "version") {
      if (options.mutateLemmaScriptDuringVersion) writeFileSync(request.args[0] ?? "", "changed lsc bytes\n", "utf8");
      if (options.mutateDependencyDuringVersion)
        writeFileSync(
          join(request.cwd, "node_modules", "runtime-dependency", "index.js"),
          "export const runtime = false;\n",
        );
      return successfulProcessResult("0.9.0\n");
    }
    if (first === "--version") return successfulProcessResult(`Dafny ${options.dafnyVersion ?? "4.11.0"}\n`);
    if (second === "info" && third === "--typed") return successfulProcessResult(JSON.stringify(TYPED_INFO));
    if (second === "gen" && third === "--backend=dafny") {
      const stagedSource = request.args.at(-1);
      if (stagedSource === undefined) throw new Error("test runner did not receive staged source");
      const stem = stagedSource.slice(0, -".ts".length);
      if (!options.omitGenerated) writeFileSync(`${stem}.dfy.gen`, options.generated ?? generatedDafny, "utf8");
      if (!options.omitProof)
        writeFileSync(`${stem}.dfy`, options.proof ?? options.generated ?? generatedDafny, "utf8");
      return successfulProcessResult("generated\n");
    }
    if (first === "verify") {
      const mode = options.verification ?? "passed";
      const logArgument = request.args.find((arg) => arg.startsWith("csv;LogFileName=", 0));
      const logName = logArgument?.slice("csv;LogFileName=".length);
      if (mode !== "missing_log" && logName !== undefined)
        writeFileSync(join(request.cwd, logName), verificationCsv(mode), "utf8");
      const proofPath = request.args.at(-1);
      if (options.mutateProofDuringVerification && proofPath !== undefined)
        writeFileSync(proofPath, "mutated by verifier\n", "utf8");
      const jsonOutput =
        mode === "diagnostics"
          ? `${JSON.stringify({ type: "diagnostic", value: { location: { filename: "access-policy.dfy", range: { start: { line: 1, character: 1 } } }, defaultFormatMessage: "verification diagnostic" } })}\n`
          : "";
      return successfulProcessResult(jsonOutput);
    }
    throw new Error(`unexpected process request: ${request.executable} ${request.args.join(" ")}`);
  };
}

function verificationCsv(mode: VerificationMode): string {
  if (mode === "no_checks" || mode === "missing_log") {
    return "TestResult.DisplayName,TestResult.Result,TestResult.Duration,TestResult.ResourceCount,TestResult.VC\n";
  }
  const outcome = mode === "failed" ? "Failed" : mode === "inconclusive" ? "Inconclusive" : "Passed";
  return `TestResult.DisplayName,TestResult.Result,TestResult.Duration,TestResult.ResourceCount,TestResult.VC\naccessPolicy (correctness),${outcome},00:00:00.001,1,1\n`;
}

function inputWith(
  input: LemmaScriptQualificationInput,
  changes: Partial<LemmaScriptQualificationInput>,
): LemmaScriptQualificationInput {
  return { ...input, ...changes };
}

describe("runLemmaScriptQualification", () => {
  it("runs the bounded facts-only pipeline and records exact observations", async () => {
    const { input } = createToolInputs();
    const calls: LemmaScriptProcessRequest[] = [];
    const result = await runLemmaScriptQualification(input, {
      processRunner: processRunnerFor(calls),
    });
    expect(result.kind).toBe("pipeline_passed");
    expect(result.semanticEquivalence).toBe("unresolved");
    expect(result.benchmarkReady).toBe(false);
    expect(result.facts.effectiveTimeoutMs).toBe(30_000);
    expect(result.facts.policyEligible).toBe(true);
    expect(result.facts.versions).toEqual({
      lemmaScript: { expected: "0.9.0", observed: "0.9.0" },
      dafny: { expected: "4.11.0", observed: "4.11.0" },
    });
    expect(result.facts.digests.source).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.facts.digests.generated).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.facts.digests.proof).toBe(result.facts.digests.generated);
    expect(result.facts.digests.lemmaScriptExecutable).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.facts.digests.dafnyExecutable).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.facts.dependencyBinding).toEqual({
      schema: "kiln.lemma-script-dependency-binding/v1",
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      manifestFileCount: expect.any(Number),
      packageCount: 3,
      runtime: {
        role: "bun",
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        byteLength: expect.any(Number),
      },
      allowedCommands: ["gen --backend=dafny", "info --typed", "version"],
    });
    expect(JSON.stringify(result.facts.dependencyBinding)).not.toContain(input.lemmaScriptPackageRoot);
    expect(result.facts.processes.map(({ label, argvRoles }) => ({ label, argvRoles }))).toEqual([
      { label: "lemmascript_version", argvRoles: ["lsc_script", "version"] },
      { label: "dafny_version", argvRoles: ["dafny_executable", "--version"] },
      { label: "lemmascript_typed_info", argvRoles: ["lsc_script", "info", "--typed", "staged_source"] },
      { label: "lemmascript_generate_dafny", argvRoles: ["lsc_script", "gen", "--backend=dafny", "staged_source"] },
      {
        label: "dafny_verify",
        argvRoles: ["dafny_executable", "verify", "--json-output", "--log-format", "verification_log", "staged_proof"],
      },
    ]);
    expect(result).not.toHaveProperty("candidate");
    expect(result).not.toHaveProperty("contract");
    expect(result).not.toHaveProperty("criterion");
    expect(result).not.toHaveProperty("acceptance");
    expect(calls).toHaveLength(5);
    expect(calls[0]?.cwd).toBe(input.lemmaScriptPackageRoot);
    const lscCalls = calls.filter(({ executable }) => executable === process.execPath);
    expect(lscCalls.every(({ cwd }) => cwd === input.lemmaScriptPackageRoot)).toBe(true);
    expect(lscCalls.every(({ env }) => env !== undefined)).toBe(true);
    expect(
      lscCalls.every(({ env }) =>
        Object.keys(env ?? {}).every((key) => !/^(?:NODE_OPTIONS|NODE_PATH)$/iu.test(key) && !/^BUN_/iu.test(key)),
      ),
    ).toBe(true);
    expect(new Set(lscCalls.map(({ env }) => env))).toHaveLength(1);
    expect(JSON.stringify(result.facts.processes)).not.toContain(input.lscScriptPath);
    expect(JSON.stringify(result.facts.processes)).not.toContain(input.dafnyExecutable);
    expect(JSON.stringify(result.facts.processes)).not.toContain("access-policy.dfy");
    expect(
      result.facts.processes.every(
        ({ stdoutDigest, stderrDigest }) =>
          /^sha256:[a-f0-9]{64}$/u.test(stdoutDigest) && /^sha256:[a-f0-9]{64}$/u.test(stderrDigest),
      ),
    ).toBe(true);
    expect(result.facts.verification).toEqual({
      status: "passed",
      correctnessChecks: { total: 1, passed: 1, failed: 0, inconclusive: 0 },
      diagnostics: 0,
    });
  }, 15_000);

  it("normalizes Dafny build metadata without normalizing LemmaScript version output", async () => {
    const { input } = createToolInputs();
    const result = await runLemmaScriptQualification(input, {
      processRunner: processRunnerFor([], { dafnyVersion: "4.11.0+build.7" }),
    });

    expect(result.kind).toBe("pipeline_passed");
    expect(result.facts.versions.dafny.observed).toBe("4.11.0");
  });

  it.each([
    ["no_checks", "no_checks"],
    ["failed", "failed"],
    ["inconclusive", "inconclusive"],
    ["missing_log", "log_missing"],
    ["diagnostics", "diagnostics"],
  ] as const)("fails closed for Dafny %s evidence", async (mode, expectedStatus) => {
    const { input } = createToolInputs();
    const result = await runLemmaScriptQualification(input, {
      processRunner: processRunnerFor([], { verification: mode }),
    });

    expect(result.kind).toBe("pipeline_failed");
    expect(result.stage).toBe("dafny_verification");
    expect(result.facts.verification?.status).toBe(expectedStatus);
    expect(result.benchmarkReady).toBe(false);
  });

  it("detects verifier mutation of the proof bytes", async () => {
    const { input } = createToolInputs();
    const result = await runLemmaScriptQualification(input, {
      processRunner: processRunnerFor([], { mutateProofDuringVerification: true }),
    });

    expect(result.kind).toBe("pipeline_failed");
    expect(result.stage).toBe("proof_integrity");
  });

  it("requires both generated and proof artifacts", async () => {
    const { input } = createToolInputs();
    const missingGenerated = await runLemmaScriptQualification(input, {
      processRunner: processRunnerFor([], { omitGenerated: true }),
    });
    const missingProof = await runLemmaScriptQualification(input, {
      processRunner: processRunnerFor([], { omitProof: true }),
    });

    expect(missingGenerated.kind).toBe("pipeline_failed");
    expect(missingGenerated.stage).toBe("generation");
    expect(missingProof.kind).toBe("pipeline_failed");
    expect(missingProof.stage).toBe("proof_integrity");
  });

  it("detects LemmaScript executable mutation after invocation", async () => {
    const { input } = createToolInputs();
    const result = await runLemmaScriptQualification(input, {
      processRunner: processRunnerFor([], { mutateLemmaScriptDuringVersion: true }),
    });

    expect(result.kind).toBe("pipeline_failed");
    expect(result.stage).toBe("tool_integrity");
  });

  it("detects transitive dependency mutation during qualification", async () => {
    const { input } = createToolInputs();
    const result = await runLemmaScriptQualification(input, {
      processRunner: processRunnerFor([], { mutateDependencyDuringVersion: true }),
    });

    expect(result.kind).toBe("pipeline_failed");
    expect(result.stage).toBe("tool_integrity");
  });

  it("fails closed on a generated/proof byte mismatch and does not invoke Dafny", async () => {
    const { input } = createToolInputs();
    const calls: LemmaScriptProcessRequest[] = [];
    const result = await runLemmaScriptQualification(input, {
      processRunner: processRunnerFor(calls, { proof: `${generatedDafny}// proof addition\n` }),
    });

    expect(result.kind).toBe("pipeline_failed");
    expect(result.stage).toBe("proof_integrity");
    expect(result.semanticEquivalence).toBe("unresolved");
    expect(result.benchmarkReady).toBe(false);
    expect(calls.some(({ args }) => args[0] === "verify")).toBe(false);
  });

  it("does not invoke Dafny when the qualification policy blocks the generated artifact", async () => {
    const { input } = createToolInputs();
    const calls: LemmaScriptProcessRequest[] = [];
    const result = await runLemmaScriptQualification(input, {
      processRunner: processRunnerFor(calls, { generated: "assume true;\n" }),
    });

    expect(result.kind).toBe("policy_ineligible");
    expect(result.semanticEquivalence).toBe("unresolved");
    expect(result.benchmarkReady).toBe(false);
    expect(result.facts.policyEligible).toBe(false);
    expect(result.facts.policyDiagnosticCodes).toEqual(["generated-trust-pattern"]);
    expect(calls.some(({ args }) => args[0] === "verify")).toBe(false);
  });

  it("does not invoke any process when a required path is relative", async () => {
    const { input } = createToolInputs();
    const calls: LemmaScriptProcessRequest[] = [];
    const result = await runLemmaScriptQualification(inputWith(input, { sourcePath: "relative.ts" }), {
      processRunner: processRunnerFor(calls),
    });

    expect(result.kind).toBe("invalid_input");
    expect(result.stage).toBe("input");
    expect(calls).toHaveLength(0);
  });

  it("does not invoke any process when the dependency binding is invalid", async () => {
    const { input, root } = createToolInputs();
    writeFileSync(
      join(root, "node_modules", "runtime-dependency", "package.json"),
      '{"name":"runtime-dependency","version":"2.0.0"}\n',
    );
    const calls: LemmaScriptProcessRequest[] = [];

    const result = await runLemmaScriptQualification(input, { processRunner: processRunnerFor(calls) });

    expect(result.kind).toBe("invalid_input");
    expect(result.stage).toBe("input");
    expect(calls).toHaveLength(0);
  });

  it("rejects forbidden operator environment influence before any process call", async () => {
    const { input } = createToolInputs();
    const calls: LemmaScriptProcessRequest[] = [];
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--trace-warnings";
    try {
      const result = await runLemmaScriptQualification(input, { processRunner: processRunnerFor(calls) });

      expect(result.kind).toBe("invalid_input");
      expect(result.stage).toBe("input");
      expect(calls).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
    }
  });

  it("builds a portable narrow child environment without leaking unrelated variables", () => {
    expect(buildLemmaScriptChildEnvironment({ PATH: "portable", HOME: "portable", SECRET: "hidden" })).toEqual({
      PATH: "portable",
      HOME: "portable",
    });
  });

  it("rejects a symlink in every executable/source input position", async () => {
    const { input, root } = createToolInputs();
    const symlink = join(root, "source-link.ts");
    symlinkSync(input.sourcePath, symlink);
    const calls: LemmaScriptProcessRequest[] = [];
    const result = await runLemmaScriptQualification(inputWith(input, { sourcePath: symlink }), {
      processRunner: processRunnerFor(calls),
    });

    expect(result.kind).toBe("invalid_input");
    expect(result.stage).toBe("input");
    expect(calls).toHaveLength(0);
  });

  it("requires a lowercase .ts source and unique required function names", async () => {
    const { input, root } = createToolInputs();
    const javascriptSource = join(root, "source.js");
    copyFileSync(input.sourcePath, javascriptSource);
    const uppercaseTypeScriptSource = join(root, "source.TS");
    copyFileSync(input.sourcePath, uppercaseTypeScriptSource);
    const calls: LemmaScriptProcessRequest[] = [];
    const wrongExtension = await runLemmaScriptQualification(inputWith(input, { sourcePath: javascriptSource }), {
      processRunner: processRunnerFor(calls),
    });
    const wrongCaseExtension = await runLemmaScriptQualification(
      inputWith(input, { sourcePath: uppercaseTypeScriptSource }),
      { processRunner: processRunnerFor(calls) },
    );
    const duplicateFunctions = await runLemmaScriptQualification(
      inputWith(input, { requiredFunctionNames: ["accessPolicy", "accessPolicy"] }),
      {
        processRunner: processRunnerFor(calls),
      },
    );

    expect(wrongExtension.kind).toBe("invalid_input");
    expect(wrongCaseExtension.kind).toBe("invalid_input");
    expect(duplicateFunctions.kind).toBe("invalid_input");
    expect(calls).toHaveLength(0);
  });

  it("rejects unknown and duplicate CLI options", async () => {
    const { input } = createToolInputs();
    const required = [
      `--source=${input.sourcePath}`,
      `--lsc-root=${input.lemmaScriptPackageRoot}`,
      `--lsc=${input.lscScriptPath}`,
      `--dafny=${input.dafnyExecutable}`,
      "--lsc-version=0.9.0",
      "--dafny-version=4.11.0",
      "--functions=accessPolicy",
    ];

    await expect(main([...required, "--unknown=value"])).resolves.toBe(1);
    await expect(main([...required, `--source=${input.sourcePath}`])).resolves.toBe(1);
    await expect(main(required.filter((option) => !option.startsWith("--lsc-root=")))).resolves.toBe(1);
  });

  it("returns a typed cleanup failure instead of rejecting", async () => {
    const { input } = createToolInputs();
    const result = await runLemmaScriptQualification(input, {
      processRunner: processRunnerFor([]),
      cleanupWorkspace: async (workspacePath) => {
        rmSync(workspacePath, { recursive: true, force: true });
        throw new Error("cleanup unavailable");
      },
    });

    expect(result.kind).toBe("pipeline_failed");
    expect(result.stage).toBe("cleanup");
    expect(result.benchmarkReady).toBe(false);
  });

  it("uses the explicit timeout for every process invocation", async () => {
    const { input } = createToolInputs();
    const calls: LemmaScriptProcessRequest[] = [];
    const result = await runLemmaScriptQualification(inputWith(input, { timeoutMs: 1234 }), {
      processRunner: processRunnerFor(calls),
    });

    expect(result.facts.effectiveTimeoutMs).toBe(1234);
    expect(calls.every(({ timeoutMs }) => timeoutMs === 1234)).toBe(true);
  });
});
