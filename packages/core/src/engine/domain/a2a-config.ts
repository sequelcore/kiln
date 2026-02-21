// A2A config types -- Agent Card and protocol types per A2A spec

export interface A2ACapabilitySchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
}

export interface A2AAuthConfig {
  readonly schemes: readonly string[];
  readonly credentials?: string;
}

export interface AgentCard {
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly version: string;
  readonly capabilities: readonly A2ACapabilitySchema[];
  readonly inputModes?: readonly string[];
  readonly outputModes?: readonly string[];
  readonly authentication?: A2AAuthConfig;
}

export interface A2ATaskStatus {
  readonly state: "submitted" | "working" | "input-required" | "completed" | "failed" | "canceled";
  readonly message?: string;
  readonly timestamp: string;
}

export interface A2AArtifact {
  readonly name?: string;
  readonly parts: readonly A2APart[];
}

export type A2APart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "data"; readonly data: Record<string, unknown>; readonly mimeType?: string };

export interface A2ATask {
  readonly id: string;
  readonly status: A2ATaskStatus;
  readonly artifacts?: readonly A2AArtifact[];
  readonly history?: readonly A2AMessage[];
}

export interface A2AMessage {
  readonly role: "user" | "agent";
  readonly parts: readonly A2APart[];
}

export interface A2AValidationError {
  readonly field: string;
  readonly message: string;
}

export function validateAgentCard(card: AgentCard): A2AValidationError[] {
  const errors: A2AValidationError[] = [];

  if (!card.name || typeof card.name !== "string") {
    errors.push({ field: "name", message: "must be a non-empty string" });
  }
  if (!card.description || typeof card.description !== "string") {
    errors.push({ field: "description", message: "must be a non-empty string" });
  }
  if (!card.url || typeof card.url !== "string") {
    errors.push({ field: "url", message: "must be a non-empty string" });
  }
  if (!card.version || typeof card.version !== "string") {
    errors.push({ field: "version", message: "must be a non-empty string" });
  }
  if (!card.capabilities || !Array.isArray(card.capabilities)) {
    errors.push({ field: "capabilities", message: "must be an array" });
  } else {
    for (let i = 0; i < card.capabilities.length; i++) {
      const cap = card.capabilities[i]!;
      if (!cap.name || typeof cap.name !== "string") {
        errors.push({ field: `capabilities[${i}].name`, message: "must be a non-empty string" });
      }
      if (!cap.description || typeof cap.description !== "string") {
        errors.push({ field: `capabilities[${i}].description`, message: "must be a non-empty string" });
      }
    }
  }

  return errors;
}
