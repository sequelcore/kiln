import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLemmaCheckTool,
  type LemmaCheckQualificationResult,
  type LemmaCheckSubprocessRequest,
  type LemmaCheckSubprocessResult,
  type LemmaCheckToolOptions,
} from "./lemma-check-tool.js";

const temporaryRoots: string[] = [];
const DIGEST = "sha256:" + "a".repeat(64);

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("lemma_check", () => {
  it("exposes an empty-only model schema and fixes the candidate/tool arguments at the host", async () => {
    const fixture = createFixture();
    const requests: LemmaCheckSubprocessRequest[] = [];
    const tool = createLemmaCheckTool(fixture.workspacePath, {
      ...fixture.options,
      runner: async (request) => {
        requests.push(request);
        return successfulSubprocess(fixture.qualificationResult);
      },
    });

    expect(tool.name).toBe("lemma_check");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });

    const result = await tool.execute({ name: "lemma_check", input: {} });
    expect(result.isError).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.args).toEqual(expect.arrayContaining([
      expect.stringContaining("lemma-script-qualification"),
      `--source=${join(fixture.workspacePath, "src", "solution.ts")}`,
      "--functions=accessPolicy",
      "--lsc-version=0.6.0",
      "--dafny-version=4.11.0",
      "--timeout-ms=1234",
    ]));
    expect(requests[0]?.args.some((argument) => argument.includes("file") || argument.includes("path"))).toBe(false);

    const rejected = await tool.execute({ name: "lemma_check", input: { file: "other.ts" } });
    expect(rejected.isError).toBe(true);
    expect(JSON.parse(rejected.output)).toMatchObject({ stage: "input", status: "failed" });
    expect(requests).toHaveLength(1);
  });

  it("rejects a candidate symlink and any workspace escape before running the subprocess", async () => {
    const fixture = createFixture();
    const outside = mkdtempSync(join(tmpdir(), "lemma-check-outside-"));
    temporaryRoots.push(outside);
    rmSync(join(fixture.workspacePath, "src", "solution.ts"));
    symlinkSync(join(outside, "missing.ts"), join(fixture.workspacePath, "src", "solution.ts"));
    const requests: LemmaCheckSubprocessRequest[] = [];
    const tool = createLemmaCheckTool(fixture.workspacePath, {
      ...fixture.options,
      runner: async (request) => {
        requests.push(request);
        return successfulSubprocess(fixture.qualificationResult);
      },
    });

    const result = await tool.execute({ name: "lemma_check", input: {} });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.output)).toMatchObject({ stage: "input", status: "failed" });
    expect(requests).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(fixture.workspacePath);
  });

  it("captures exact pre/post source digests and fails closed on source drift", async () => {
    const fixture = createFixture();
    const candidatePath = join(fixture.workspacePath, "src", "solution.ts");
    const before = digest(readFileSync(candidatePath));
    const requests: LemmaCheckSubprocessRequest[] = [];
    const tool = createLemmaCheckTool(fixture.workspacePath, {
      ...fixture.options,
      runner: async (request) => {
        requests.push(request);
        writeFileSync(candidatePath, "export function accessPolicy(): boolean { return false; }\n");
        return successfulSubprocess({
          ...fixture.qualificationResult,
          facts: {
            ...fixture.qualificationResult.facts,
            digests: { ...fixture.qualificationResult.facts.digests, source: before },
          },
        });
      },
    });

    const result = await tool.execute({ name: "lemma_check", input: {} });
    const output = JSON.parse(result.output) as Record<string, unknown>;
    expect(result.isError).toBe(true);
    expect(output).toMatchObject({ kind: "pipeline_failed", status: "failed", stage: "source_drift" });
    expect(output).toHaveProperty("digests.sourceBefore", before);
    expect(output).toHaveProperty("digests.sourceAfter", expect.stringMatching(/^sha256:[a-f0-9]{64}$/u));
    expect(output).toHaveProperty("diagnosticCodes", ["source-drift"]);
    expect(requests).toHaveLength(1);
  });

  it.each([
    ["process", { exitCode: 2, signal: null, stdout: "", stderr: "failed at C:\\secret\\tool", timedOut: false }],
    ["timeout", { exitCode: null, signal: "SIGTERM", stdout: "", stderr: "", timedOut: true }],
  ] as const)("fails closed for qualification %s", async (stage, processResult) => {
    const fixture = createFixture();
    const tool = createLemmaCheckTool(fixture.workspacePath, {
      ...fixture.options,
      runner: async () => processResult,
    });
    const result = await tool.execute({ name: "lemma_check", input: {} });
    const output = JSON.parse(result.output) as Record<string, unknown>;
    expect(result.isError).toBe(true);
    expect(output.status).toBe("failed");
    expect(output.stage).toBe(stage);
    expect(JSON.stringify(output)).not.toContain("secret");
    expect(JSON.stringify(output)).not.toMatch(/[A-Za-z]:[\\/]/u);
  });

  it("fails closed on malformed qualification output and preserves bounded policy diagnostics", async () => {
    const malformedFixture = createFixture();
    const malformed = createLemmaCheckTool(malformedFixture.workspacePath, {
      ...malformedFixture.options,
      runner: async () => successfulSubprocessText("not-json"),
    });
    const malformedResult = await malformed.execute({ name: "lemma_check", input: {} });
    expect(JSON.parse(malformedResult.output)).toMatchObject({ stage: "output_parse", status: "failed" });

    const policyFixture = createFixture();
    const policy = createLemmaCheckTool(policyFixture.workspacePath, {
      ...policyFixture.options,
      runner: async () => successfulSubprocess({
        ...policyFixture.qualificationResult,
        kind: "policy_ineligible",
        status: "ineligible",
        stage: "policy",
        facts: {
          ...policyFixture.qualificationResult.facts,
          policyEligible: false,
          policyDiagnosticCodes: ["generated-trust-pattern", "not-a-code"],
        },
      }),
    });
    const policyResult = await policy.execute({ name: "lemma_check", input: {} });
    const output = JSON.parse(policyResult.output) as Record<string, unknown>;
    expect(output).toMatchObject({
      status: "failed",
      kind: "pipeline_failed",
      stage: "output_parse",
      policyEligible: false,
      diagnosticCodes: ["unsupported-policy"],
      semanticEquivalence: "unresolved",
      benchmarkReady: false,
    });
    expect(output).not.toHaveProperty("message");
    expect(JSON.stringify(output)).not.toMatch(/acceptance|establishes|criterion|Assurance|generated.*\.dfy|verification\.csv/iu);
  });

  it("preserves a validated policy-ineligible result from the qualification process exit code", async () => {
    const fixture = createFixture();
    const qualification = {
      ...fixture.qualificationResult,
      kind: "policy_ineligible" as const,
      status: "ineligible" as const,
      stage: "policy",
      facts: {
        ...fixture.qualificationResult.facts,
        policyEligible: false,
        policyDiagnosticCodes: ["numeric-semantics"],
      },
    };
    const tool = createLemmaCheckTool(fixture.workspacePath, {
      ...fixture.options,
      runner: async () => ({
        exitCode: 1,
        signal: null,
        stdout: JSON.stringify(qualification),
        stderr: "",
        timedOut: false,
      }),
    });

    const result = await tool.execute({ name: "lemma_check", input: {} });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.output)).toMatchObject({
      kind: "policy_ineligible",
      status: "ineligible",
      stage: "policy",
      policyEligible: false,
      diagnosticCodes: ["numeric-semantics"],
      benchmarkReady: false,
    });
  });

  it("returns only compact facts and never exposes generated artifacts or absolute paths", async () => {
    const fixture = createFixture();
    const tool = createLemmaCheckTool(fixture.workspacePath, {
      ...fixture.options,
      runner: async () => successfulSubprocess(fixture.qualificationResult),
    });
    const result = await tool.execute({ name: "lemma_check", input: {} });
    const output = JSON.parse(result.output) as Record<string, unknown>;
    expect(output).toMatchObject({
      status: "passed",
      kind: "pipeline_passed",
      stage: "complete",
      versions: {
        lemmaScript: { expected: "0.6.0", observed: "0.6.0" },
        dafny: { expected: "4.11.0", observed: "4.11.0" },
      },
      digests: {
        source: digest(Buffer.from("export function accessPolicy(): boolean { return true; }\n")),
        generated: DIGEST,
        lemmaScriptExecutable: DIGEST,
        dafnyExecutable: DIGEST,
        dependencyBinding: DIGEST,
      },
      policyEligible: true,
      diagnosticCodes: [],
      verification: { correctnessChecks: { total: 1, passed: 1, failed: 0, inconclusive: 0 } },
      semanticEquivalence: "unresolved",
      benchmarkReady: false,
    });
    expect(JSON.stringify(output)).not.toContain(fixture.workspacePath);
    expect(JSON.stringify(output)).not.toMatch(/\.dfy(?:\.gen)?|verification\.csv|acceptance|establishes|criterion|Assurance/iu);
    expect(output).not.toHaveProperty("bytes");
    expect(output).not.toHaveProperty("candidate");
  });
});

interface Fixture {
  readonly workspacePath: string;
  readonly options: LemmaCheckToolOptions;
  readonly qualificationResult: LemmaCheckQualificationResult;
  readonly sourceDigest: string;
}

function createFixture(): Fixture {
  const workspacePath = mkdtempSync(join(tmpdir(), "lemma-check-tool-test-"));
  temporaryRoots.push(workspacePath);
  mkdirSync(join(workspacePath, "src"), { recursive: true });
  writeFileSync(join(workspacePath, "src", "solution.ts"), "export function accessPolicy(): boolean { return true; }\n");
  const toolRoot = join(workspacePath, "toolchain");
  mkdirSync(toolRoot, { recursive: true });
  const lscScriptPath = join(toolRoot, "lsc.js");
  const dafnyExecutable = join(toolRoot, "dafny");
  writeFileSync(lscScriptPath, "lsc fixture\n");
  writeFileSync(dafnyExecutable, "dafny fixture\n");
  const sourceDigest = digest(readFileSync(join(workspacePath, "src", "solution.ts")));
  const qualificationResult: LemmaCheckQualificationResult = {
    kind: "pipeline_passed",
    status: "passed",
    stage: "complete",
    semanticEquivalence: "unresolved",
    benchmarkReady: false,
    facts: {
      effectiveTimeoutMs: 1234,
      versions: {
        lemmaScript: { expected: "0.6.0", observed: "0.6.0" },
        dafny: { expected: "4.11.0", observed: "4.11.0" },
      },
      digests: {
        source: sourceDigest,
        generated: DIGEST,
        proof: DIGEST,
        lemmaScriptExecutable: DIGEST,
        dafnyExecutable: DIGEST,
      },
      processes: [{
        label: "lemmascript_version",
        argvRoles: ["lsc_script", "version"],
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdoutDigest: DIGEST,
        stderrDigest: DIGEST,
      }],
      dependencyBinding: {
        schema: "kiln.lemma-script-dependency-binding/v1",
        digest: DIGEST,
        manifestFileCount: 1,
        packageCount: 1,
        runtime: { role: "bun", digest: DIGEST, byteLength: 1 },
        allowedCommands: ["gen --backend=dafny", "info --typed", "version"],
      },
      policyEligible: true,
      policyDiagnosticCodes: [],
      verification: {
        status: "passed",
        correctnessChecks: { total: 1, passed: 1, failed: 0, inconclusive: 0 },
        diagnostics: 0,
      },
    },
  };
  return {
    workspacePath,
    sourceDigest,
    qualificationResult,
    options: {
      requiredFunctionNames: ["accessPolicy"],
      timeoutMs: 1234,
      toolchain: {
        lemmaScriptPackageRoot: workspacePath,
        lscScriptPath,
        dafnyExecutable,
        expectedLemmaScriptVersion: "0.6.0",
        expectedDafnyVersion: "4.11.0",
      },
      qualificationScriptPath: join(workspacePath, "lemma-script-qualification.ts"),
    },
  };
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function successfulSubprocess(result: LemmaCheckQualificationResult): LemmaCheckSubprocessResult {
  return successfulSubprocessText(JSON.stringify(result));
}

function successfulSubprocessText(stdout: string): LemmaCheckSubprocessResult {
  return { exitCode: 0, signal: null, stdout, stderr: "", timedOut: false };
}
