/**
 * `static_analyze` runs one fixed Oxlint profile over immutable copied bytes.
 * It reports diagnostics and coverage facts only; it never accepts work or
 * maps its observation to an acceptance criterion.
 */

import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type CommandProcessRunner,
  type DevTool,
  getBuiltinEffectEnvelope,
  getSandboxContext,
  requireString,
  resolvePath,
  STATIC_ANALYSIS_PROFILE,
  staticAnalysisToolMetadata,
  TOOL_SCHEMAS,
  type ToolInput,
  type ToolResult,
  toErrorResult,
  toSuccessResult,
  validateReadPath,
} from "@kilnai/core";
import { SpawnCommandProcessRunner } from "../../tools/spawn-command-process-runner.js";
import { OXLINT_ISOLATED_CONFIG, OXLINT_ISOLATED_CONFIG_FILE, OxlintAnalyzer } from "./oxlint-analyzer.js";

export const STATIC_ANALYZE_CAPABILITY = "verify.static" as const;

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const INLINE_SUPPRESSION = /\b(?:oxlint|eslint)-disable(?:-next-line|-line)?\b/u;

export interface StaticAnalyzeToolOptions {
  /** Absolute or native executable path resolved from operator configuration. */
  readonly executable: string;
  /** Pinned Oxlint version observed before this tool was registered. */
  readonly analyzerVersion: string;
  readonly runner?: CommandProcessRunner;
  readonly timeoutMs?: number;
}

export function createStaticAnalyzeTool(options: StaticAnalyzeToolOptions): DevTool {
  const schema = TOOL_SCHEMAS.static_analyze;
  return {
    name: schema.name,
    description: schema.description,
    inputSchema: schema.inputSchema,
    ...(getBuiltinEffectEnvelope(schema.name) === undefined
      ? {}
      : { effectEnvelope: getBuiltinEffectEnvelope(schema.name) }),
    async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
      const file = requireString(input, "file");
      if (!file.ok) return file.result;
      if (typeof options.analyzerVersion !== "string" || options.analyzerVersion.trim().length === 0) {
        return toErrorResult("static analysis analyzer version is required");
      }
      const sandboxContext = getSandboxContext(sandbox);
      if (sandboxContext?.cwd === undefined) {
        return toErrorResult("static analysis requires sandbox.cwd to bind subject coverage");
      }

      let snapshotRoot: string | undefined;
      let result: ToolResult = toErrorResult("static analysis did not produce a result");
      try {
        const sandboxRoot = await realpath(sandboxContext.cwd);
        const sandboxStat = await lstat(sandboxRoot);
        if (!sandboxStat.isDirectory()) {
          return toErrorResult("static analysis sandbox.cwd must be a directory");
        }
        const requestedPath = resolvePath(file.value, sandbox);
        const denied = validateReadPath(requestedPath, sandbox);
        if (denied !== undefined) return toErrorResult(denied);
        const sourcePath = await realpath(requestedPath);
        const sourceStat = await lstat(sourcePath);
        if (!sourceStat.isFile()) return toErrorResult("static analysis input must be a regular file");
        if (!isWithin(sandboxRoot, sourcePath)) {
          return toErrorResult("static analysis input must be inside sandbox.cwd");
        }
        if (!SUPPORTED_EXTENSIONS.has(extname(sourcePath).toLowerCase())) {
          return toErrorResult("static analysis input must be a JavaScript or TypeScript source file");
        }
        if (sourceStat.size > MAX_SOURCE_BYTES) {
          return toErrorResult(`static analysis input exceeds ${MAX_SOURCE_BYTES} bytes`);
        }

        const subjectPath = toPosixPath(relative(sandboxRoot, sourcePath));
        const source = await readFile(sourcePath);
        if (INLINE_SUPPRESSION.test(source.toString("utf8"))) {
          return toErrorResult(
            "static analysis input contains an inline suppression directive; candidate-controlled analyzer policy is not admitted",
          );
        }
        const contentDigest = digestBytes(source);
        snapshotRoot = await mkdtemp(join(tmpdir(), "kiln-static-analyze-"));
        const snapshotPath = resolve(snapshotRoot, subjectPath);
        if (!isWithin(snapshotRoot, snapshotPath)) {
          throw new Error("static analysis subject cannot be represented in an isolated snapshot");
        }
        await mkdir(dirname(snapshotPath), { recursive: true });
        await writeFile(snapshotPath, source, { mode: 0o444 });
        await chmod(snapshotPath, 0o444);
        const isolatedConfigPath = join(snapshotRoot, OXLINT_ISOLATED_CONFIG_FILE);
        await writeFile(isolatedConfigPath, OXLINT_ISOLATED_CONFIG, { mode: 0o444 });
        await chmod(isolatedConfigPath, 0o444);

        const analyzer = new OxlintAnalyzer(options.runner ?? new SpawnCommandProcessRunner(), {
          executable: options.executable,
          cwd: snapshotRoot,
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });
        const run = await analyzer.analyze({ file: toPlatformPath(subjectPath) });
        if (run.status !== "completed") {
          result = toErrorResult(`static analysis did not complete (${run.status}): ${run.failure ?? "no detail"}`);
        } else if ((await digestFile(snapshotPath)) !== contentDigest) {
          result = toErrorResult("static analysis snapshot changed during analysis");
        } else {
          const diagnostics = run.diagnostics.map((diagnostic) => ({
            ...(diagnostic.rule === undefined ? {} : { rule: diagnostic.rule }),
            severity: diagnostic.severity,
            message: diagnostic.message,
            file: subjectPath,
            ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
            ...(diagnostic.column === undefined ? {} : { column: diagnostic.column }),
          }));
          const metadata = staticAnalysisToolMetadata({
            analyzer: { name: "oxlint", version: options.analyzerVersion },
            profile: { id: STATIC_ANALYSIS_PROFILE, rulesAnalyzed: run.rulesAnalyzed },
            outcome: diagnostics.length === 0 ? "clean" : "violations",
            subjects: [{ path: subjectPath, contentDigest }],
            diagnostics,
          });
          result = toSuccessResult(renderRun(run.rulesAnalyzed, diagnostics), metadata);
        }
      } catch (error) {
        result = toErrorResult(`static analysis failed closed: ${errorMessage(error)}`);
      }

      if (snapshotRoot !== undefined) {
        try {
          await rm(snapshotRoot, { recursive: true, force: true });
        } catch (error) {
          return toErrorResult(`static analysis snapshot cleanup failed: ${errorMessage(error)}`);
        }
      }
      return result;
    },
  };
}

function renderRun(
  rulesAnalyzed: number,
  diagnostics: readonly {
    readonly rule?: string;
    readonly message: string;
    readonly file: string;
    readonly line?: number;
    readonly column?: number;
  }[],
): string {
  if (diagnostics.length === 0) {
    return `${rulesAnalyzed} static-analysis rules completed with no diagnostics. This reports analyzer output only; work governance decides whether it satisfies any acceptance criterion.`;
  }
  return [
    `${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"} from ${rulesAnalyzed} static-analysis rules:`,
    ...diagnostics.map((diagnostic) => {
      const location =
        diagnostic.line === undefined
          ? diagnostic.file
          : `${diagnostic.file}:${diagnostic.line}${diagnostic.column === undefined ? "" : `:${diagnostic.column}`}`;
      return `  ${location} ${diagnostic.rule ?? "unclassified"}: ${diagnostic.message}`;
    }),
    "This reports analyzer output only; work governance decides whether it satisfies any acceptance criterion.",
  ].join("\n");
}

async function digestFile(path: string): Promise<string> {
  return digestBytes(await readFile(path));
}

function digestBytes(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function isWithin(root: string, candidate: string): boolean {
  const nested = relative(root, candidate);
  return nested.length === 0 || (!nested.startsWith("..") && !isAbsolute(nested));
}

function toPosixPath(path: string): string {
  return sep === "\\" ? path.replaceAll("\\", "/") : path;
}

function toPlatformPath(path: string): string {
  return sep === "\\" ? path.replaceAll("/", "\\") : path;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
