// Cross-app cognitive delegation handler (Phase 24)

import type { ProviderAdapter, A2AMessage } from "@kilnai/core";
import type {
  AppDelegation,
  AppDelegationResult,
  DelegationError,
} from "@kilnai/core";
import { validateDelegation } from "@kilnai/core";
import { A2AClient } from "../a2a/a2a-client.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOKENS = 4096;

/** Minimal info about a loaded app available as delegation target */
export interface DelegationTarget {
  readonly appName: string;
  readonly provider: ProviderAdapter;
  readonly systemPrompt: string;
}

/** Registry of apps available for delegation */
export interface DelegationRegistry {
  readonly targets: ReadonlyMap<string, DelegationTarget>;
}

/** Configuration for A2A delegation */
export interface A2ADelegationConfig {
  readonly type: "a2a";
  readonly agentUrl: string;
  readonly message: A2AMessage;
  readonly timeout?: number;
}

/** Extended delegation type for A2A routing */
export interface ExtendedDelegation extends AppDelegation {
  readonly delegationType?: "a2a";
  readonly agentUrl?: string;
  readonly a2aMessage?: A2AMessage;
}

/** Result of lightweight JSON Schema validation */
export interface SchemaValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validate response data against a simplified JSON Schema subset.
 * Checks type, required fields, and property types.
 */
export function validateResponseSchema(
  data: unknown,
  schema: Record<string, unknown>,
): SchemaValidationResult {
  const errors: string[] = [];

  if (schema.type === "object") {
    if (
      typeof data !== "object" ||
      data === null ||
      Array.isArray(data)
    ) {
      errors.push("Response must be a plain object");
      return { valid: false, errors };
    }

    const obj = data as Record<string, unknown>;

    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!(key in obj)) {
          errors.push(`Missing required field: ${key}`);
        }
      }
    }

    if (
      schema.properties !== null &&
      schema.properties !== undefined &&
      typeof schema.properties === "object" &&
      !Array.isArray(schema.properties)
    ) {
      const props = schema.properties as Record<string, Record<string, unknown>>;
      for (const [key, propSchema] of Object.entries(props)) {
        if (!(key in obj) || propSchema.type === undefined) {
          continue;
        }
        const value = obj[key];
        const expectedType = propSchema.type as string;
        let typeValid = true;

        switch (expectedType) {
          case "string":
            typeValid = typeof value === "string";
            break;
          case "number":
            typeValid = typeof value === "number";
            break;
          case "boolean":
            typeValid = typeof value === "boolean";
            break;
          case "array":
            typeValid = Array.isArray(value);
            break;
          case "object":
            typeValid =
              typeof value === "object" && !Array.isArray(value) && value !== null;
            break;
        }

        if (!typeValid) {
          errors.push(
            `Field '${key}' must be of type ${expectedType}, got ${typeof value}`,
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Execute a delegation request.
 * Routes to A2A or Kiln-native delegation based on delegationType field.
 * Returns AppDelegationResult on success, DelegationError on failure.
 */
export async function executeDelegation(
  delegation: ExtendedDelegation,
  registry: DelegationRegistry,
  a2aClient?: A2AClient,
): Promise<AppDelegationResult | DelegationError> {
  if (delegation.delegationType === "a2a") {
    if (!delegation.agentUrl) {
      return {
        code: "TARGET_APP_NOT_FOUND",
        message: "agentUrl is required for A2A delegation",
        fromApp: delegation.fromApp,
        toApp: delegation.toApp,
      };
    }

    const message: A2AMessage = delegation.a2aMessage ?? {
      role: "user",
      parts: [{ type: "text", text: delegation.task }],
    };

    return executeA2ADelegation(
      { type: "a2a", agentUrl: delegation.agentUrl, message, timeout: delegation.timeout },
      delegation.fromApp,
      a2aClient,
    );
  }

  return executeKilnDelegation(delegation, registry);
}

/**
 * Execute a Kiln-native delegation request.
 * Returns AppDelegationResult on success, DelegationError on failure.
 */
export async function executeKilnDelegation(
  delegation: AppDelegation,
  registry: DelegationRegistry,
): Promise<AppDelegationResult | DelegationError> {
  const { fromApp, toApp } = delegation;

  const validationErrors = validateDelegation(delegation);
  if (validationErrors.length > 0) {
    const message = validationErrors
      .map((e) => `${e.field}: ${e.message}`)
      .join("; ");
    return { code: "PROVIDER_ERROR", message, fromApp, toApp };
  }

  const target = registry.targets.get(toApp);
  if (!target) {
    return {
      code: "TARGET_APP_NOT_FOUND",
      message: `App '${toApp}' not found or not available for delegation`,
      fromApp,
      toApp,
    };
  }

  const delegationId = crypto.randomUUID();

  const systemPrompt =
    `${target.systemPrompt}\n\n--- Delegation Request ---\nFrom: ${fromApp}\nRespond with a JSON object matching the required schema.\n\nTask: ${delegation.task}` +
    (delegation.context ? `\n\nContext:\n${delegation.context}` : "");

  const startTime = performance.now();

  try {
    const timeoutMs = delegation.timeout ?? DEFAULT_TIMEOUT_MS;

    const response = await Promise.race([
      target.provider.createMessage({
        system: systemPrompt,
        messages: [{ role: "user" as const, content: delegation.task }],
        outputSchema: delegation.schema,
        maxTokens: DEFAULT_MAX_TOKENS,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DELEGATION_TIMEOUT")), timeoutMs),
      ),
    ]);

    const durationMs = performance.now() - startTime;

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      return {
        code: "SCHEMA_VALIDATION_FAILED",
        message: "Response is not valid JSON",
        delegationId,
        fromApp,
        toApp,
      };
    }

    const validation = validateResponseSchema(parsed, delegation.schema);
    if (!validation.valid) {
      return {
        code: "SCHEMA_VALIDATION_FAILED",
        message: validation.errors.join("; "),
        delegationId,
        fromApp,
        toApp,
      };
    }

    return {
      delegationId,
      fromApp,
      toApp,
      result: parsed as Record<string, unknown>,
      tokenUsage: {
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        cacheReadTokens: response.cacheReadTokens,
        cacheWriteTokens: response.cacheWriteTokens,
      },
      durationMs,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("DELEGATION_TIMEOUT")) {
      return {
        code: "TIMEOUT",
        message,
        delegationId,
        fromApp,
        toApp,
      };
    }

    return {
      code: "PROVIDER_ERROR",
      message,
      delegationId,
      fromApp,
      toApp,
    };
  }
}

/**
 * Execute an A2A delegation request to a remote agent.
 * Returns AppDelegationResult on success, DelegationError on failure.
 */
export async function executeA2ADelegation(
  a2aConfig: A2ADelegationConfig,
  fromApp: string,
  client?: A2AClient,
): Promise<AppDelegationResult | DelegationError> {
  const effectiveClient = client ?? new A2AClient();
  const delegationId = crypto.randomUUID();
  const startTime = performance.now();

  try {
    const task = await effectiveClient.sendTask(
      a2aConfig.agentUrl,
      a2aConfig.message,
      a2aConfig.timeout ?? DEFAULT_TIMEOUT_MS,
    );

    const durationMs = performance.now() - startTime;

    if (task.status.state !== "completed") {
      return {
        code: "PROVIDER_ERROR",
        message: `A2A task ended with state: ${task.status.state}. ${task.status.message ?? ""}`,
        delegationId,
        fromApp,
        toApp: a2aConfig.agentUrl,
      };
    }

    let result: Record<string, unknown> = {};
    if (task.artifacts && task.artifacts.length > 0) {
      const firstArtifact = task.artifacts[0];
      if (firstArtifact?.parts && firstArtifact.parts.length > 0) {
        const firstPart = firstArtifact.parts[0];
        if (firstPart?.type === "data") {
          result = firstPart.data;
        } else if (firstPart?.type === "text") {
          try {
            result = JSON.parse(firstPart.text) as Record<string, unknown>;
          } catch {
            result = { text: firstPart.text };
          }
        }
      }
    }

    return {
      delegationId,
      fromApp,
      toApp: a2aConfig.agentUrl,
      result,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      durationMs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      code: "PROVIDER_ERROR",
      message,
      delegationId,
      fromApp,
      toApp: a2aConfig.agentUrl,
    };
  }
}
