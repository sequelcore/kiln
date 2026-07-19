import type { DomainConfig, DomainRegistry } from "@kilnai/core";
import type { ContextCandidate } from "@kilnai/core";
import type { ManagedInvocationToolOptions } from "@kilnai/runtime";
import type { KilnYaml, KilnHooksConfig } from "./kiln-yaml.js";
import type { ProjectedContext } from "./application/context-types.js";

/** Options passed to the system prompt builder */
export interface SystemPromptOptions {
  readonly task: string;
  readonly domain: DomainConfig;
  readonly projectedContext: ProjectedContext;
  readonly projectPath: string;
}

const DEFAULT_POLICY = { approval: "on-request" as const, sandbox: "read-only" as const };

function defaultBuildSystemPrompt(opts: SystemPromptOptions): string {
  const { buildPreamble } = require("./wrapper/preamble-builder.js");
  return buildPreamble(
    {
      mode: "api-key",
      domain: opts.domain,
      systemPrompt: "",
      projectedContext: opts.projectedContext,
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
  readonly contextCandidates?: readonly ContextCandidate[];
  /** Validated IANA timezone used to derive dynamic operator-turn context. */
  readonly operatorTimeZone?: string;
  readonly studioDistPath?: string;
  readonly kilnYaml?: KilnYaml;
  readonly hooks?: KilnHooksConfig;
  readonly managedInvocation?: ManagedInvocationToolOptions;
}

export { defaultBuildSystemPrompt };
