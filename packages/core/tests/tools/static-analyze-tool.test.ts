import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TOOL_SCHEMAS } from "../../src/tools/domain/tool.js";
import { BUILTIN_TOOL_EFFECT_ENVELOPES } from "../../src/tools/domain/tool-effect-envelopes.js";
import {
  isStaticAnalysisToolResultMetadata,
  parseStaticAnalysisToolResultMetadata,
} from "../../src/tools/domain/tool-result-metadata.js";
import type {
  CommandProcessRequest,
  CommandProcessRunner,
  CommandProcessSink,
} from "../../src/tools/infrastructure/command-process.js";
import {
  createStaticAnalyzeTool,
  STATIC_ANALYZE_CAPABILITY,
} from "../../src/tools/infrastructure/verification/oxlint/static-analyze-tool.js";
import { STATIC_ANALYSIS_OBSERVATION_SCHEMA } from "../../src/verification/static/observation.js";
import { makeSandbox, makeTempDir, removeTempDir } from "./infrastructure/test-utils.js";

class ScriptedRunner implements CommandProcessRunner {
  request?: CommandProcessRequest;
  isolatedConfig?: string;

  constructor(private readonly diagnostics: readonly unknown[] = []) {}

  start(request: CommandProcessRequest, sink: CommandProcessSink) {
    this.request = request;
    this.isolatedConfig = readFileSync(join(request.cwd, ".kiln-oxlint.json"), "utf8");
    sink.output({
      stream: "stdout",
      text: JSON.stringify({
        diagnostics: this.diagnostics,
        number_of_files: 1,
        number_of_rules: 126,
        threads_count: 1,
        start_time: 0.001,
      }),
    });
    sink.finish({ exitCode: this.diagnostics.length === 0 ? 0 : 1 });
    return { stop: async () => {} };
  }
}

const digest = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("static_analyze registration", () => {
  it("accepts only a file and cannot claim an acceptance criterion", () => {
    const schema = TOOL_SCHEMAS.static_analyze.inputSchema as {
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(Object.keys(schema.properties)).toEqual(["file"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("declares the verifier process boundary and capability identity", () => {
    expect(BUILTIN_TOOL_EFFECT_ENVELOPES.static_analyze).toEqual(BUILTIN_TOOL_EFFECT_ENVELOPES.formal_verify);
    expect(STATIC_ANALYZE_CAPABILITY).toBe("verify.static");
  });
});

describe("static_analyze execution", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir !== undefined) await removeTempDir(dir);
    dir = undefined;
  });

  it("analyzes immutable copied bytes and emits facts-only candidate evidence", async () => {
    dir = await makeTempDir("kiln-static-analysis-");
    const source = "export const answer = 42;\n";
    await writeFile(join(dir, "solution.ts"), source);
    const runner = new ScriptedRunner();
    const result = await createStaticAnalyzeTool({
      executable: "oxlint",
      analyzerVersion: "1.80.0",
      runner,
    }).execute({ name: "static_analyze", input: { file: "solution.ts" } }, makeSandbox(dir));

    expect(result.isError).toBe(false);
    expect(runner.request?.cwd).not.toBe(dir);
    expect(runner.request?.args.at(-1)).toBe("solution.ts");
    expect(runner.isolatedConfig).toBe("{}\n");
    expect(existsSync(runner.request!.cwd)).toBe(false);
    expect(result.metadata).toMatchObject({
      schema: STATIC_ANALYSIS_OBSERVATION_SCHEMA,
      toolName: "static_analyze",
      kind: "static_analysis",
      analyzer: { name: "oxlint", version: "1.80.0" },
      profile: { id: "oxlint.correctness+suspicious/v1", rulesAnalyzed: 126 },
      outcome: "clean",
      subjects: [{ path: "solution.ts", contentDigest: digest(source) }],
      diagnostics: [],
      establishes: [],
    });
    expect(isStaticAnalysisToolResultMetadata(result.metadata)).toBe(true);
  });

  it("reports violations as successful observations rather than tool failures", async () => {
    dir = await makeTempDir("kiln-static-analysis-");
    await writeFile(join(dir, "solution.ts"), "debugger;\n");
    const runner = new ScriptedRunner([
      {
        message: "Unexpected debugger statement.",
        code: "eslint(no-debugger)",
        severity: "error",
        filename: "solution.ts",
        labels: [{ span: { line: 1, column: 1 } }],
      },
    ]);
    const result = await createStaticAnalyzeTool({
      executable: "oxlint",
      analyzerVersion: "1.80.0",
      runner,
    }).execute({ name: "static_analyze", input: { file: "solution.ts" } }, makeSandbox(dir));

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      outcome: "violations",
      diagnostics: [{ rule: "eslint(no-debugger)", severity: "error", line: 1, column: 1 }],
      establishes: [],
    });
  });

  it("fails closed without sandbox cwd or with an invalid analyzer version", async () => {
    const missingCwd = await createStaticAnalyzeTool({
      executable: "oxlint",
      analyzerVersion: "1.80.0",
      runner: new ScriptedRunner(),
    }).execute({ name: "static_analyze", input: { file: "solution.ts" } });
    const missingVersion = await createStaticAnalyzeTool({
      executable: "oxlint",
      analyzerVersion: " ",
      runner: new ScriptedRunner(),
    }).execute({ name: "static_analyze", input: { file: "solution.ts" } }, makeSandbox(process.cwd()));

    expect(missingCwd.isError).toBe(true);
    expect(missingVersion.isError).toBe(true);
  });

  it("rejects files outside the closed JavaScript and TypeScript source set", async () => {
    dir = await makeTempDir("kiln-static-analysis-");
    await writeFile(join(dir, "notes.txt"), "not source\n");

    const result = await createStaticAnalyzeTool({
      executable: "oxlint",
      analyzerVersion: "1.80.0",
      runner: new ScriptedRunner(),
    }).execute({ name: "static_analyze", input: { file: "notes.txt" } }, makeSandbox(dir));

    expect(result.isError).toBe(true);
    expect(result.output).toContain("JavaScript or TypeScript");
  });

  it("rejects candidate-controlled inline suppression before invoking Oxlint", async () => {
    dir = await makeTempDir("kiln-static-analysis-");
    await writeFile(join(dir, "solution.ts"), "/* oxlint-disable */\ndebugger;\n");
    const runner = new ScriptedRunner();

    const result = await createStaticAnalyzeTool({
      executable: "oxlint",
      analyzerVersion: "1.80.0",
      runner,
    }).execute({ name: "static_analyze", input: { file: "solution.ts" } }, makeSandbox(dir));

    expect(result.isError).toBe(true);
    expect(result.output).toContain("inline suppression");
    expect(runner.request).toBeUndefined();
    expect(result.metadata).toBeUndefined();
  });

  it("strictly rejects forged criterion mappings and extra fields", () => {
    const base = {
      schema: STATIC_ANALYSIS_OBSERVATION_SCHEMA,
      toolName: "static_analyze",
      kind: "static_analysis",
      analyzer: { name: "oxlint", version: "1.80.0" },
      profile: { id: "oxlint.correctness+suspicious/v1", rulesAnalyzed: 126 },
      outcome: "clean",
      subjects: [{ path: "solution.ts", contentDigest: digest("source") }],
      diagnostics: [],
      establishes: [],
    };

    expect(() => parseStaticAnalysisToolResultMetadata({ ...base, establishes: ["criterion-1"] })).toThrow(
      /establishes/u,
    );
    expect(() => parseStaticAnalysisToolResultMetadata({ ...base, accepted: true })).toThrow(/shape|extra/u);
  });
});
