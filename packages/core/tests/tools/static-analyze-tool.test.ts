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
  OXLINT_ISOLATED_CONFIG,
  OXLINT_ISOLATED_CONFIG_FILE,
} from "../../src/tools/infrastructure/verification/oxlint/oxlint-analyzer.js";
import {
  createStaticAnalyzeTool,
  STATIC_ANALYZE_CAPABILITY,
} from "../../src/tools/infrastructure/verification/oxlint/static-analyze-tool.js";
import {
  STATIC_ANALYSIS_OBSERVATION_SCHEMA,
  STATIC_ANALYSIS_PROFILE,
  STATIC_ANALYSIS_PROFILE_CONFIG_DIGEST,
} from "../../src/verification/static/observation.js";
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
        number_of_rules: 106,
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
  it("binds the complete profile JSON to its published configuration digest", () => {
    expect(`sha256:${createHash("sha256").update(OXLINT_ISOLATED_CONFIG).digest("hex")}`).toBe(
      STATIC_ANALYSIS_PROFILE_CONFIG_DIGEST,
    );
  });

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

  it("uses a closed, native, non-type-aware Sequel TypeScript profile", () => {
    const config = JSON.parse(OXLINT_ISOLATED_CONFIG) as {
      readonly plugins: readonly string[];
      readonly rules: Record<string, unknown>;
      readonly [key: string]: unknown;
    };

    expect(Object.keys(config)).toEqual(["plugins", "rules"]);
    expect(config.plugins).toEqual(["oxc", "typescript", "unicorn"]);
    expect(Object.keys(config.rules)).toHaveLength(105);
    expect(config.rules).toMatchObject({
      "no-debugger": "error",
      "no-unused-vars": "error",
      "no-unsafe-optional-chaining": "error",
      "max-lines": ["error", { max: 500 }],
      "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
      "max-depth": ["error", { max: 4 }],
      "max-nested-callbacks": ["error", { max: 4 }],
      "unicorn/max-nested-calls": ["error", { max: 3 }],
      "max-params": ["error", { max: 4, countThis: "never" }],
      "max-statements": ["error", { max: 40 }],
      "max-classes-per-file": ["error", { max: 1 }],
      "typescript/no-explicit-any": "error",
      "typescript/ban-ts-comment": [
        "error",
        {
          minimumDescriptionLength: 3,
          "ts-check": false,
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
        },
      ],
    });
    expect(config.rules).not.toHaveProperty("complexity");
    expect(config.rules).not.toHaveProperty("vitest/no-focused-tests");
    expect(config.rules).not.toHaveProperty("typescript/no-unnecessary-type-assertion");
    expect(config.rules).not.toHaveProperty("typescript/no-unsafe-assignment");
    expect(config).not.toHaveProperty("jsPlugins");
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
    expect(runner.request?.args).toEqual([
      "--format",
      "json",
      "--config",
      OXLINT_ISOLATED_CONFIG_FILE,
      "--disable-nested-config",
      "--no-ignore",
      "--report-unused-disable-directives-severity",
      "error",
      "solution.ts",
    ]);
    expect(runner.isolatedConfig).toBe(OXLINT_ISOLATED_CONFIG);
    expect(existsSync(runner.request!.cwd)).toBe(false);
    expect(result.metadata).toMatchObject({
      schema: STATIC_ANALYSIS_OBSERVATION_SCHEMA,
      toolName: "static_analyze",
      kind: "static_analysis",
      analyzer: { name: "oxlint", version: "1.80.0" },
      profile: { id: STATIC_ANALYSIS_PROFILE, rulesAnalyzed: 106 },
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

  it("reports structural and TypeScript safety diagnostics from the fixed profile", async () => {
    dir = await makeTempDir("kiln-static-analysis-");
    const source =
      "export function build(value: any, a: number, b: number, c: number, d: number, e: number) { return value; }\n";
    await writeFile(join(dir, "solution.ts"), source);
    const runner = new ScriptedRunner([
      {
        message: "Function 'build' has too many parameters (6). Maximum allowed is 4.",
        code: "eslint(max-params)",
        severity: "error",
        filename: "solution.ts",
        labels: [{ span: { line: 1, column: 17 } }],
      },
      {
        message: "Unexpected `any`. Specify a different type.",
        code: "typescript(no-explicit-any)",
        severity: "error",
        filename: "solution.ts",
        labels: [{ span: { line: 1, column: 30 } }],
      },
    ]);
    const result = await createStaticAnalyzeTool({
      executable: "oxlint",
      analyzerVersion: "1.80.0",
      runner,
    }).execute({ name: "static_analyze", input: { file: "solution.ts" } }, makeSandbox(dir));

    expect(result.isError).toBe(false);
    expect(result.metadata).toMatchObject({
      profile: { id: STATIC_ANALYSIS_PROFILE, rulesAnalyzed: 106 },
      outcome: "violations",
      diagnostics: [
        { rule: "eslint(max-params)", severity: "error", line: 1, column: 17 },
        { rule: "typescript(no-explicit-any)", severity: "error", line: 1, column: 30 },
      ],
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
      profile: { id: STATIC_ANALYSIS_PROFILE, rulesAnalyzed: 106 },
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
