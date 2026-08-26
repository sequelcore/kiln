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
    );
    expect(result.profiles[0]?.diagnostics.map((diagnostic) => diagnostic.rule.name)).toEqual([
      "widen-then-assert",
      "chained-type-assertion",
    ]);
  });

  it("fails closed on syntax that the parser cannot analyze", () => {
    expect(() => analyzeTypeScriptQuality("subject.ts", "const value = ;")).toThrow(/parse failed/iu);
  });
});

describe("quality_analyze", () => {
  it("reports candidate-bound facts from every configured profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-quality-"));
    roots.push(root);
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "value.ts"), "export const value = input as unknown as User;\n");
    const tool = createQualityAnalyzeTool({ profiles: ["type-integrity"], analyzerVersion: "3.0.0-beta.1" });
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
