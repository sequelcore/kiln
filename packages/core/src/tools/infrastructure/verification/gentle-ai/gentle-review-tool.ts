import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { type DevTool, TOOL_SCHEMAS, type ToolInput, type ToolResult } from "../../../domain/tool.js";
import { getBuiltinEffectEnvelope } from "../../../domain/tool-effect-envelopes.js";
import { type CommandProcessRunner, SpawnCommandProcessRunner } from "../../command-process.js";
import { getSandboxContext, requireString, toErrorResult, toSuccessResult } from "../../tool-helpers.js";
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
    async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
      const lineageId = requireString(input, "lineageId");
      if (!lineageId.ok) return lineageId.result;
      const targetIdentity = requireString(input, "targetIdentity");
      if (!targetIdentity.ok) return targetIdentity.result;
      const runtimeAgent = requireString(input, "runtimeAgent");
      if (!runtimeAgent.ok) return runtimeAgent.result;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(lineageId.value) || !/^sha256:[a-f0-9]{64}$/u.test(targetIdentity.value))
        return toErrorResult("gentle review requires canonical lineageId and targetIdentity values");
      if (!["claude-code", "codex", "opencode", "pi"].includes(runtimeAgent.value))
        return toErrorResult("gentle review requires a supported runtimeAgent");
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
        }).observe({
          lineageId: lineageId.value,
          expectedTargetIdentity: targetIdentity.value,
          runtimeAgent: runtimeAgent.value as "claude-code" | "codex" | "opencode" | "pi",
        });
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
