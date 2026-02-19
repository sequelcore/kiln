// Engine primitive: Capability -- an MCP tool that agents can invoke

/** Safety annotations that drive engine policies */
export interface CapabilityAnnotations {
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
}

/** An MCP tool with schema, tags, and safety annotations */
export interface Capability {
  readonly name: string;
  readonly description: string;
  readonly schema: Record<string, unknown>;
  readonly tags: readonly string[];
  readonly annotations?: CapabilityAnnotations;
  readonly type?: string;        // "delegation" for cross-app delegation
  readonly targetApp?: string;   // target app name in the gateway
  readonly task?: string;        // task description sent to target
  readonly timeout?: number;     // timeout in seconds
}
