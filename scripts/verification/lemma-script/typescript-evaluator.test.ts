import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TYPESCRIPT_OBSERVATION_SCHEMA } from "./differential-oracle.js";
import {
  type LemmaScriptTypescriptEvaluatorInput,
  main,
  runLemmaScriptTypescriptEvaluator,
} from "./typescript-evaluator.js";

const temporaryRoots: string[] = [];
const outputPrefix = TYPESCRIPT_OBSERVATION_SCHEMA;

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface FixtureOptions {
  readonly source?: string;
  readonly rows?: readonly unknown[];
  readonly schema?: unknown;
  readonly functionName?: unknown;
}

async function createFixture(options: FixtureOptions = {}): Promise<{
  readonly root: string;
  readonly sourcePath: string;
  readonly manifestPath: string;
  readonly input: LemmaScriptTypescriptEvaluatorInput;
}> {
  const root = await mkdtemp(join(tmpdir(), "kiln-lemma-script-typescript-evaluator-test-"));
  temporaryRoots.push(root);
  const sourcePath = join(root, "staged-source.ts");
  const manifestPath = join(root, "cases.json");
  await writeFile(
    sourcePath,
    options.source ??
      'export function accessPolicy(authenticated: boolean, canRead: boolean): "allow" | "deny" {\n' +
        '  return authenticated && canRead ? "allow" : "deny";\n' +
        "}\n",
    "utf8",
  );
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema: options.schema ?? "kiln.lemma-script-qualification-v1",
      function: options.functionName ?? "accessPolicy",
      inputs: options.rows ?? [
        { authenticated: false, canRead: false, expected: "allow" },
        { authenticated: false, canRead: true, expected: "allow" },
        { authenticated: true, canRead: false, expected: "allow" },
        { authenticated: true, canRead: true, expected: "deny" },
      ],
    }),
    "utf8",
  );
  return {
    root,
    sourcePath,
    manifestPath,
    input: { sourcePath, functionName: "accessPolicy", caseManifestPath: manifestPath },
  };
}

function expectedLines(results: readonly string[] = ["deny", "deny", "deny", "allow"]): string[] {
  const domains = [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ] as const;
  return domains.map(
    ([authenticated, canRead], index) =>
      `${outputPrefix}|authenticated=${authenticated}|canRead=${canRead}|result=${results[index]}`,
  );
}

describe("runLemmaScriptTypescriptEvaluator", () => {
  it("imports the exact source and emits only the four canonical boolean observations", async () => {
    const fixture = await createFixture();

    const result = await runLemmaScriptTypescriptEvaluator(fixture.input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual(expectedLines());
    expect(result.output).toBe(`${expectedLines().join("\n")}\n`);
  });

  it("does not use expected values to decide results and uses canonical domain order", async () => {
    const fixture = await createFixture({
      rows: [
        { authenticated: true, canRead: true, expected: "deny" },
        { authenticated: false, canRead: true, expected: "allow" },
        { authenticated: true, canRead: false, expected: "allow" },
        { authenticated: false, canRead: false, expected: "allow" },
      ],
    });

    const result = await runLemmaScriptTypescriptEvaluator(fixture.input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual(expectedLines());
  });

  it("suppresses source stdout and stderr so only evaluator lines are observable", async () => {
    const fixture = await createFixture({
      source:
        'console.log("/synthetic/private/source-output");\n' +
        'console.error("/synthetic/private/source-error");\n' +
        'export function accessPolicy(authenticated: boolean, canRead: boolean): "allow" | "deny" {\n' +
        '  return authenticated && canRead ? "allow" : "deny";\n' +
        "}\n",
    });

    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    let stdout = "";
    let stderr = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      const result = await runLemmaScriptTypescriptEvaluator(fixture.input);
      expect(result.ok).toBe(true);
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    }
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  it.each([
    [
      "missing a domain",
      [
        { authenticated: false, canRead: false },
        { authenticated: false, canRead: true },
        { authenticated: true, canRead: false },
      ],
    ],
    [
      "duplicates a domain",
      [
        { authenticated: false, canRead: false },
        { authenticated: false, canRead: false },
        { authenticated: true, canRead: false },
        { authenticated: true, canRead: true },
      ],
    ],
    [
      "contains an extra domain",
      [
        { authenticated: false, canRead: false },
        { authenticated: false, canRead: true },
        { authenticated: true, canRead: false },
        { authenticated: true, canRead: true },
        { authenticated: true, canRead: true, extra: true },
      ],
    ],
  ] as const)("fails closed when the manifest %s", async (_label, rows) => {
    const fixture = await createFixture({ rows });

    const result = await runLemmaScriptTypescriptEvaluator(fixture.input);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_manifest");
    expect(result.message).not.toContain(fixture.root);
  });

  it.each([
    [
      "missing",
      [
        { authenticated: false, canRead: false },
        { authenticated: false, canRead: true },
        { authenticated: true, canRead: true },
      ],
    ],
    [
      "non-boolean",
      [
        { authenticated: "false", canRead: false },
        { authenticated: false, canRead: true },
        { authenticated: true, canRead: false },
        { authenticated: true, canRead: true },
      ],
    ],
    [
      "not an object",
      [
        false,
        { authenticated: false, canRead: true },
        { authenticated: true, canRead: false },
        { authenticated: true, canRead: true },
      ],
    ],
  ] as const)("rejects a malformed %s manifest", async (_label, rows) => {
    const fixture = await createFixture({ rows });

    const result = await runLemmaScriptTypescriptEvaluator(fixture.input);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_manifest");
  });

  it.each([
    ["absent", "export const unrelated = 1;", "export unavailable"],
    ["non-callable", "export const accessPolicy = 1;", "export unavailable"],
    [
      "throws",
      "export function accessPolicy(): never { throw new Error('/synthetic/private/secret'); }",
      "evaluation failed",
    ],
    [
      "returns a Promise",
      "export function accessPolicy(): Promise<string> { return Promise.resolve('allow'); }",
      "promise result",
    ],
    ["returns an invalid value", "export function accessPolicy(): string { return 'maybe'; }", "invalid result"],
  ] as const)("fails closed when the source export %s", async (_label, source, expectedMessage) => {
    const fixture = await createFixture({ source });

    const result = await runLemmaScriptTypescriptEvaluator(fixture.input);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(expectedMessage);
    expect(result.message).not.toContain("operator");
    expect(result.message).not.toContain(fixture.root);
  });

  it("rejects non-absolute, symlinked, and non-TypeScript paths before importing", async () => {
    const fixture = await createFixture();
    const sourceLink = join(fixture.root, "source-link.ts");
    await symlink(fixture.sourcePath, sourceLink);

    const cases: readonly LemmaScriptTypescriptEvaluatorInput[] = [
      { ...fixture.input, sourcePath: "relative.ts" },
      { ...fixture.input, sourcePath: sourceLink },
      { ...fixture.input, sourcePath: fixture.sourcePath.replace(/\.ts$/u, ".TS") },
      { ...fixture.input, caseManifestPath: "cases.json" },
    ];
    for (const input of cases) {
      const result = await runLemmaScriptTypescriptEvaluator(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid_input");
    }
  });
});

describe("main", () => {
  it("rejects unknown and duplicate options without writing paths to stdout or stderr", async () => {
    const fixture = await createFixture();
    const required = [
      `--source=${fixture.sourcePath}`,
      "--function=accessPolicy",
      `--manifest=${fixture.manifestPath}`,
    ];
    const originalWrite = process.stdout.write;
    const originalErrorWrite = process.stderr.write;
    let stdout = "";
    let stderr = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      await expect(main([...required, "--unknown=value"])).resolves.toBe(1);
      await expect(main([...required, required[0] ?? ""])).resolves.toBe(1);
    } finally {
      process.stdout.write = originalWrite;
      process.stderr.write = originalErrorWrite;
    }
    expect(stdout).toBe("");
    expect(stderr).not.toContain(fixture.root);
    expect(stderr).not.toContain("Error:");
  });

  it("writes exactly canonical lines for a successful child invocation", async () => {
    const fixture = await createFixture();
    const output: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await expect(
        main([`--source=${fixture.sourcePath}`, "--function=accessPolicy", `--manifest=${fixture.manifestPath}`]),
      ).resolves.toBe(0);
    } finally {
      process.stdout.write = originalWrite;
    }
    expect(output.join("")).toBe(`${expectedLines().join("\n")}\n`);
  });

  it("keeps the fixture portable by not embedding the temporary root in source or manifest assertions", async () => {
    const fixture = await createFixture();
    const source = await readFile(fixture.sourcePath, "utf8");
    const manifest = await readFile(fixture.manifestPath, "utf8");
    expect(source).not.toContain(fixture.root);
    expect(manifest).not.toContain(fixture.root);
  });
});
