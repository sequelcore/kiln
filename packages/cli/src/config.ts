import type { DomainConfig, DomainRegistry } from "@kilnai/core";
import type { KilnYaml, KilnHooksConfig } from "./kiln-yaml.js";

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
  readonly createRegistry: () => DomainRegistry;
  readonly buildSystemPrompt?: (opts: SystemPromptOptions) => string;
  readonly studioDistPath?: string;
  readonly kilnYaml?: KilnYaml;
  readonly hooks?: KilnHooksConfig;
}

export { defaultBuildSystemPrompt };
