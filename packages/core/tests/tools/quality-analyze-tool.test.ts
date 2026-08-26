import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createQualityAnalyzeTool } from "../../src/tools/infrastructure/verification/quality/quality-analyze-tool.js";
import { analyzeTypeScriptQuality } from "../../src/tools/infrastructure/verification/quality/typescript-quality-analyzer.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("TypeScript quality analyzer", () => {
  it("distinguishes laundering from other chained assertions without duplicate diagnostics", () => {
    const result = analyzeTypeScriptQuality(
      "subject.ts",
      [
        "const a = input as unknown as User;",
        "const b = input as Source as Target;",
        "const c = input as User;",
        "const d = input satisfies User;",
      ].join("\n"),
      ["type-integrity"],
    );
    expect(result.profiles[0]?.diagnostics.map((diagnostic) => diagnostic.rule.name)).toEqual([
      "widen-then-assert",
      "chained-type-assertion",
    ]);
  });

  it("fails closed on syntax that the parser cannot analyze", () => {
    expect(() => analyzeTypeScriptQuality("subject.ts", "const value = ;", ["type-integrity"])).toThrow(
      /parse failed/iu,
    );
  });

  it("reports high per-function cyclomatic complexity as a review signal", () => {
    const branches = Array.from({ length: 20 }, (_, index) => `if (value === ${index}) return ${index};`).join("\n");
    const result = analyzeTypeScriptQuality(
      "subject.ts",
      `export function route(value: number): number {\n${branches}\nreturn -1;\n}`,
      ["complexity"],
    );

    expect(result.profiles).toMatchObject([
      {
        name: "complexity",
        revision: "v1",
        diagnostics: [
          {
            rule: { name: "high-cyclomatic-complexity", revision: "v1" },
            message: expect.stringContaining("complexity 21"),
            line: 1,
          },
        ],
      },
    ]);
  });

  it("does not inflate a function with decisions owned by a nested function", () => {
    const nestedBranches = Array.from({ length: 20 }, (_, index) => `if (value === ${index}) return ${index};`).join(
      "\n",
    );
    const result = analyzeTypeScriptQuality(
      "subject.ts",
      `export function outer(value: number): number {\nconst inner = () => {\n${nestedBranches}\nreturn -1;\n};\nreturn inner();\n}`,
      ["complexity"],
    );

    expect(result.profiles[0]?.diagnostics).toHaveLength(1);
    expect(result.profiles[0]?.diagnostics[0]?.message).toContain("inner");
    expect(result.profiles[0]?.diagnostics[0]?.message).not.toContain("outer");
  });

  it("counts default values and optional-chain branches using classic ESLint semantics", () => {
    const optionalBranches = Array.from({ length: 10 }, (_, index) => `value?.p${index}`).join(" ?? ");
    const defaults = Array.from({ length: 10 }, (_, index) => `p${index} = ${index}`).join(", ");
    const result = analyzeTypeScriptQuality(
      "subject.ts",
      `export function inspect({ ${defaults} }: Record<string, number>, value?: Record<string, number>) { return ${optionalBranches}; }`,
      ["complexity"],
    );

    expect(result.profiles[0]?.diagnostics[0]?.message).toContain("complexity 30");
  });

  it("measures class field initializers separately from their enclosing function", () => {
    const branches = Array.from({ length: 21 }, (_, index) => `flag${index}`).join(" || ");
    const result = analyzeTypeScriptQuality(
      "subject.ts",
      `export function outer() { class Subject { field = ${branches}; } return Subject; }`,
      ["complexity"],
    );

    expect(result.profiles[0]?.diagnostics).toHaveLength(1);
    expect(result.profiles[0]?.diagnostics[0]?.message).toContain("field initializer");
    expect(result.profiles[0]?.diagnostics[0]?.message).not.toContain("outer");
  });

  it("reports focused Vitest calls and literally empty test bodies", () => {
    const result = analyzeTypeScriptQuality(
      "subject.test.ts",
      [
        'import { describe, it as scenario, test } from "vitest";',
        'describe.only("suite", () => {});',
        'scenario("empty", () => {});',
        'test("delegated assertion", () => verifyBehavior());',
      ].join("\n"),
      ["test-integrity"],
    );

    expect(result.profiles[0]?.diagnostics.map((diagnostic) => diagnostic.rule.name)).toEqual([
      "focused-test",
      "empty-test-body",
    ]);
  });

  it("reports a focused parameterized test once at the defining call", () => {
    const result = analyzeTypeScriptQuality(
      "subject.test.ts",
      ['import { test } from "vitest";', 'test.only.each([1, 2])("case %s", (value) => verify(value));'].join("\n"),
      ["test-integrity"],
    );

    expect(result.profiles[0]?.diagnostics).toHaveLength(1);
    expect(result.profiles[0]?.diagnostics[0]?.rule.name).toBe("focused-test");
  });

  it("keeps legitimate disabled, conditional, mocked, and helper-asserted tests quiet", () => {
    const result = analyzeTypeScriptQuality(
      "subject.test.ts",
      [
        'import { expect, test, vi } from "vitest";',
        'test.skip("documented platform gap", () => expect(true).toBe(true));',
        'test.todo("future behavior");',
        'test.skipIf(process.platform === "win32")("portable behavior", () => expect(true).toBe(true));',
        'test("mocked boundary", () => { vi.fn(); verifyBehavior(); });',
      ].join("\n"),
      ["test-integrity"],
    );

    expect(result.profiles[0]?.diagnostics).toEqual([]);
  });
});

describe("quality_analyze", () => {
  it("reports candidate-bound facts from every configured profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-quality-"));
    roots.push(root);
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "value.ts"), "export const value = input as unknown as User;\n");
    const tool = createQualityAnalyzeTool({
      profiles: ["type-integrity", "complexity", "test-integrity"],
      analyzerVersion: "3.0.0-beta.1",
    });
    const result = await tool.execute({ name: "quality_analyze", input: { file: "src/value.ts" } }, { cwd: root });
    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      schema: "kiln.quality-analysis-observation/v1",
      toolName: "quality_analyze",
      kind: "static_quality_analysis",
      artifact: {
        kind: "typescript",
        path: "src/value.ts",
        contentDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      },
      outcome: "diagnostics",
      establishes: [],
    });
    expect(
      (result.metadata as { profiles: readonly { diagnostics: readonly unknown[] }[] }).profiles[0]?.diagnostics,
    ).toHaveLength(1);
    expect(
      (result.metadata as { profiles: readonly { name: string }[] }).profiles.map((profile) => profile.name),
    ).toEqual(["type-integrity", "complexity", "test-integrity"]);
  });

  it("rejects unsupported artifacts and missing workspace binding", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-quality-boundary-"));
    roots.push(root);
    await writeFile(join(root, "value.js"), "export const value = 1;\n");
    const tool = createQualityAnalyzeTool({ profiles: ["type-integrity"], analyzerVersion: "3.0.0-beta.1" });
    expect(
      (await tool.execute({ name: "quality_analyze", input: { file: "value.js" } }, { cwd: root })).output,
    ).toMatch(/TypeScript source/iu);
    expect((await tool.execute({ name: "quality_analyze", input: { file: "value.js" } })).output).toMatch(
      /sandbox\.cwd/iu,
    );
  });

  it("fails closed instead of analyzing replacement characters for invalid UTF-8", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-quality-encoding-"));
    roots.push(root);
    await writeFile(join(root, "value.ts"), Uint8Array.from([0xff, 0xfe]));
    const result = await createQualityAnalyzeTool({
      profiles: ["type-integrity"],
      analyzerVersion: "3.0.0-beta.1",
    }).execute({ name: "quality_analyze", input: { file: "value.ts" } }, { cwd: root });
    expect(result.isError).toBe(true);
    expect(result.metadata).toBeUndefined();
    expect(result.output).toMatch(/failed closed/iu);
  });
});
