// AgentCardGenerator: auto-generates A2A Agent Card from App config

import type { App } from "@kilnai/core";
import type { AgentCard, A2ACapabilitySchema } from "@kilnai/core";

export interface AgentCardOptions {
  readonly baseUrl: string;
  readonly version?: string;
  readonly description?: string;
}

export function generateAgentCard(app: App, options: AgentCardOptions): AgentCard {
  const capabilities: A2ACapabilitySchema[] = [];

  for (const team of Object.values(app.teams)) {
    for (const cap of team.capabilities) {
      capabilities.push({
        name: cap.name,
        description: cap.description,
        ...(Object.keys(cap.schema).length > 0 ? { inputSchema: cap.schema } : {}),
        ...(cap.outputSchema ? { outputSchema: cap.outputSchema } : {}),
      });
    }
  }

  return {
    name: app.name,
    description: options.description ?? `${app.name} AI agent`,
    url: options.baseUrl,
    version: options.version ?? "1.0.0",
    capabilities,
  };
}
