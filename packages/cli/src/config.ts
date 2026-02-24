import type { DomainConfig, DomainRegistry } from "@kilnai/core";

/** Options passed to the system prompt builder */
export interface SystemPromptOptions {
  readonly task: string;
  readonly domain: DomainConfig;
  readonly memorySnapshot?: string;
  readonly projectPath: string;
}

/** Configuration for a Kiln-based CLI app */
export interface KilnAppConfig {
  readonly appName: string;              // "kiln", etc.
  readonly dirName: string;              // ".kiln", etc.
  readonly version: string;              // "0.1.0"
  readonly description: string;          // "AI coding orchestrator"
  readonly createRegistry: () => DomainRegistry;
  readonly buildSystemPrompt: (opts: SystemPromptOptions) => string;
  readonly mcpServerName: string;        // "kiln", etc.
  readonly studioDistPath?: string;      // path to @kilnai/studio dist/ (auto-resolved in monorepo)
}
