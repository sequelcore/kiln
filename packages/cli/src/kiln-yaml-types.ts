export class KilnYamlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KilnYamlError";
  }
}

export interface KilnYamlMcpServer {
  type?: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface KilnYamlMcp {
  servers: Record<string, KilnYamlMcpServer>;
}

export interface KilnYamlModel {
  default?: string;
  fallback?: string[];
}

export interface KilnYamlPermissions {
  approval: "auto-approve" | "ask" | "deny";
  sandbox: "none" | "workspace-write" | "full";
}

export interface KilnYamlProvider {
  apiKeyEnv?: string;
}

export interface KilnYamlSkillGeneration {
  readonly enabled?: boolean;
  readonly model?: string;
  readonly complexityThreshold?: number;
}

export interface KilnYaml {
  readonly version: "1";
  readonly domain?: string;
  readonly provider?: string;
  readonly channels?: string[];
  readonly teamMode?: string;
  readonly requireApproval?: boolean;
  readonly maxDepth?: number;
  readonly parallelWorkers?: number;
  readonly mode?: string;
  readonly mcp?: KilnYamlMcp;
  readonly model?: KilnYamlModel;
  readonly permissions?: KilnYamlPermissions;
  readonly providers?: Record<string, KilnYamlProvider>;
  readonly skillGeneration?: KilnYamlSkillGeneration;
}
