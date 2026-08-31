import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  type CommandProcessRunner,
  type DevToolExecutionContext,
  type DevTool,
  getBuiltinEffectEnvelope,
  getSandboxContext,
  TOOL_SCHEMAS,
  type ToolInput,
  type ToolResult,
  toErrorResult,
  toSuccessResult,
} from "@kilnai/core";
import { SpawnCommandProcessRunner } from "../../tools/spawn-command-process-runner.js";
import { GentleAiClient } from "./gentle-ai-client.js";

export interface GentleReviewToolOptions {
  readonly executable: string;
  readonly expectedVersion: string;
  readonly expectedExecutableDigest: string;
  readonly repositoryRoot: string;
  readonly runner?: CommandProcessRunner;
  readonly timeoutMs?: number;
}

export function createGentleReviewTool(options: GentleReviewToolOptions): DevTool {
  const schema = TOOL_SCHEMAS.gentle_review;
  return {
    name: schema.name,
    description: schema.description,
    inputSchema: schema.inputSchema,
    effectEnvelope: getBuiltinEffectEnvelope(schema.name),
    async execute(input: ToolInput, sandbox?: unknown, context?: DevToolExecutionContext): Promise<ToolResult> {
      if (Object.keys(input.input).length > 0)
        return toErrorResult("gentle review resolves the current transaction and accepts no input fields");
      try {
        const sandboxRoot = getSandboxContext(sandbox)?.cwd;
        if (sandboxRoot === undefined || (await realpath(sandboxRoot)) !== (await realpath(options.repositoryRoot)))
          return toErrorResult("gentle review requires the configured repository root as sandbox.cwd");
        const executableDigest = `sha256:${createHash("sha256")
          .update(await readFile(options.executable))
          .digest("hex")}`;
        if (executableDigest !== options.expectedExecutableDigest)
          return toErrorResult("Gentle AI executable bytes drifted from configured digest");
        const observation = await new GentleAiClient(options.runner ?? new SpawnCommandProcessRunner(), {
          executable: options.executable,
          cwd: options.repositoryRoot,
          capabilitiesCwd: tmpdir(),
          expectedVersion: options.expectedVersion,
          expectedExecutableDigest: options.expectedExecutableDigest,
          timeoutMs: options.timeoutMs ?? 60_000,
        }).observeCurrent(context?.abortSignal);
        return toSuccessResult(
          `Gentle AI status observed for ${observation.candidate.targetIdentity}; action=${observation.outcome.action}. This is inferential review evidence only and grants no acceptance authority.`,
          observation,
        );
      } catch (error) {
        return toErrorResult(`gentle review failed closed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
