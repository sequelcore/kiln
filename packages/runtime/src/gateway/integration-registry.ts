// Infrastructure: registry for integration adapters
// Adapters are registered at gateway startup, looked up per-request

import type { IntegrationAdapter, IntegrationOperation } from "@kilnai/core";
import type { ToolDefinition } from "@kilnai/core";
import { KilnError } from "@kilnai/core";

export interface ResolvedOperation {
  readonly adapter: IntegrationAdapter;
  readonly operation: IntegrationOperation;
}

export class IntegrationRegistry {
  private readonly adapters = new Map<string, IntegrationAdapter>();

  register(adapter: IntegrationAdapter): void {
    if (this.adapters.has(adapter.provider)) {
      throw new KilnError("CONFIG_INVALID", `Integration adapter already registered: "${adapter.provider}"`, {
        context: { provider: adapter.provider },
      });
    }
    this.adapters.set(adapter.provider, adapter);
  }

  get(provider: string): IntegrationAdapter | undefined {
    return this.adapters.get(provider);
  }

  has(provider: string): boolean {
    return this.adapters.has(provider);
  }

  resolveOperation(toolName: string): ResolvedOperation | undefined {
    for (const [provider, adapter] of this.adapters) {
      const prefix = `${provider}_`;
      if (toolName.startsWith(prefix)) {
        const opName = toolName.slice(prefix.length);
        const operation = adapter.operations.find((op) => op.name === opName);
        if (operation) return { adapter, operation };
      }
    }
    return undefined;
  }

  all(): readonly IntegrationAdapter[] {
    return [...this.adapters.values()];
  }

  getToolDefinitions(provider: string, operationFilter?: readonly string[]): ToolDefinition[] {
    const adapter = this.adapters.get(provider);
    if (!adapter) return [];

    const ops =
      operationFilter && operationFilter.length > 0
        ? adapter.operations.filter((op) => operationFilter.includes(op.name))
        : adapter.operations;

    return ops.map((op) => ({
      name: `${provider}_${op.name}`,
      description: op.description,
      inputSchema: op.inputSchema,
      tags: new Set<string>(["integration", provider]),
    }));
  }
}
