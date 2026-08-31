import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, sep } from "node:path";
import {
  analyzeTypeScriptQuality,
  type DevToolExecutionContext,
  type DevTool,
  getBuiltinEffectEnvelope,
  getSandboxContext,
  QUALITY_PROFILE_ORDER,
  type QualityProfileName,
  qualityAnalysisToolMetadata,
  requireString,
  resolvePath,
  TOOL_SCHEMAS,
  type ToolInput,
  type ToolResult,
  toErrorResult,
  toSuccessResult,
  validateReadPath,
} from "@kilnai/core";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

export interface QualityAnalyzeToolOptions {
  readonly profiles: readonly QualityProfileName[];
  readonly analyzerVersion: string;
}

export function createQualityAnalyzeTool(options: QualityAnalyzeToolOptions): DevTool {
  const schema = TOOL_SCHEMAS.quality_analyze;
  return {
    name: schema.name,
    description: schema.description,
    inputSchema: schema.inputSchema,
    ...(getBuiltinEffectEnvelope(schema.name) === undefined
      ? {}
      : { effectEnvelope: getBuiltinEffectEnvelope(schema.name) }),
    async execute(input: ToolInput, sandbox?: unknown, context?: DevToolExecutionContext): Promise<ToolResult> {
      if (context?.abortSignal?.aborted) return toErrorResult("quality analysis was cancelled before execution");
      const file = requireString(input, "file");
      if (!file.ok) return file.result;
      if (!hasValidProfiles(options.profiles))
        return toErrorResult("quality analysis requires unique compiled profiles in canonical order");
      if (options.analyzerVersion.trim().length === 0) return toErrorResult("quality analyzer version is required");
      const sandboxContext = getSandboxContext(sandbox);
      if (!sandboxContext?.cwd) return toErrorResult("quality analysis requires sandbox.cwd to bind artifact coverage");
      try {
        const sandboxRoot = await realpath(sandboxContext.cwd);
        const requestedPath = resolvePath(file.value, sandbox);
        const denied = validateReadPath(requestedPath, sandbox);
        if (denied) return toErrorResult(denied);
        const sourcePath = await realpath(requestedPath);
        const sourceStat = await lstat(sourcePath);
        if (!sourceStat.isFile()) return toErrorResult("quality analysis input must be a regular file");
        if (!isWithin(sandboxRoot, sourcePath))
          return toErrorResult("quality analysis input must be inside sandbox.cwd");
        if (!SUPPORTED_EXTENSIONS.has(extname(sourcePath).toLowerCase()))
          return toErrorResult("quality analysis input must be a TypeScript source file");
        if (sourceStat.size > MAX_SOURCE_BYTES)
          return toErrorResult(`quality analysis input exceeds ${MAX_SOURCE_BYTES} bytes`);
        const source = await readFile(sourcePath);
        const artifactPath = toPosixPath(relative(sandboxRoot, sourcePath));
        const sourceText = new TextDecoder("utf-8", { fatal: true }).decode(source);
        const analysis = analyzeTypeScriptQuality(artifactPath, sourceText, options.profiles);
        if (context?.abortSignal?.aborted) return toErrorResult("quality analysis was cancelled during execution");
        const diagnostics = analysis.profiles.reduce((count, profile) => count + profile.diagnostics.length, 0);
        const metadata = qualityAnalysisToolMetadata({
          analyzer: {
            name: "kiln-quality",
            version: options.analyzerVersion,
            parser: { name: "@typescript/typescript6", version: analysis.parserVersion },
          },
          artifact: {
            kind: "typescript",
            path: artifactPath,
            contentDigest: `sha256:${createHash("sha256").update(source).digest("hex")}`,
          },
          outcome: diagnostics === 0 ? "no_diagnostics" : "diagnostics",
          profiles: analysis.profiles,
        });
        const output =
          diagnostics === 0
            ? "No configured quality diagnostics. This evidence is limited to the configured profiles; it does not establish overall quality or accept the work."
            : `${diagnostics} configured quality diagnostic${diagnostics === 1 ? "" : "s"}. This is evidence only; it does not accept the work.`;
        return toSuccessResult(output, metadata);
      } catch (error) {
        return toErrorResult(
          `quality analysis failed closed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

function hasValidProfiles(profiles: readonly QualityProfileName[]): boolean {
  if (profiles.length < 1 || profiles.length > QUALITY_PROFILE_ORDER.length) return false;
  return profiles.every((profile, index) => {
    const position = QUALITY_PROFILE_ORDER.indexOf(profile);
    const previous = index === 0 ? -1 : QUALITY_PROFILE_ORDER.indexOf(profiles[index - 1]!);
    return position >= 0 && position > previous;
  });
}

function isWithin(root: string, candidate: string): boolean {
  const nested = relative(root, candidate);
  return nested.length === 0 || (!nested.startsWith("..") && !isAbsolute(nested));
}
function toPosixPath(path: string): string {
  return sep === "\\" ? path.replaceAll("\\", "/") : path;
}
