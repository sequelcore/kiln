import type { DomainConfig, DomainRegistry } from "@kilnai/core";
import type { KilnYaml } from "./kiln-yaml.js";

/** Options passed to the system prompt builder */
export interface SystemPromptOptions {
  readonly task: string;
  readonly domain: DomainConfig;
  readonly memorySnapshot?: string;
  readonly projectPath: string;
}

const DEFAULT_POLICY = { approval: "ask" as const, sandbox: "none" as const };

function defaultBuildSystemPrompt(opts: SystemPromptOptions): string {
  const { buildPreamble } = require("./wrapper/preamble-builder.js");
  return buildPreamble(
    {
      mode: "api-key",
      domain: opts.domain,
      systemPrompt: "",
      memorySnapshot: opts.memorySnapshot,
      mcpServerEntryPath: "",
      workingDirectory: opts.projectPath,
      task: opts.task,
    },
    DEFAULT_POLICY,
    undefined,
  );
}

/** Configuration for a Kiln-based CLI app */
export interface KilnAppConfig {
  readonly appName: string;              // "kiln", etc.
  readonly dirName: string;              // ".kiln", etc.
  readonly version: string;              // "0.1.0"
  readonly description: string;          // "AI coding orchestrator"
  readonly createRegistry: () => DomainRegistry;
  readonly buildSystemPrompt?: (opts: SystemPromptOptions) => string;
  readonly mcpServerName: string;        // "kiln", etc.
  readonly studioDistPath?: string;      // path to @kilnai/studio dist/ (auto-resolved in monorepo)
  readonly kilnYaml?: KilnYaml;          // pre-loaded kiln.yaml (optional; run.ts reads from disk if absent)
}

export { defaultBuildSystemPrompt };
