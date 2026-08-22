// Cross-app cognitive delegation handler

import type { AgentResponse } from "@kilnai/core";
import type { CreateMessageOptions } from "@kilnai/core/agents";
import type {
  AppDelegation,
  AppDelegationResult,
  DelegationError,
} from "@kilnai/core";
import { KilnError, validateDelegation } from "@kilnai/core";
import { Message, TaskState, taskStateToJSON } from "@a2a-js/sdk";
import type { Part, SendMessageResult, Task } from "@a2a-js/sdk";
import { A2AClient, A2ATimeoutError, type A2AClientPort } from "../a2a/a2a-client.js";

const DEFAULT_TIMEOUT_MS = 120_000;
/** Max output tokens for LLM calls during cross-app delegation */
const DELEGATION_MAX_TOKENS = 4096;
const A2A_MAX_ARTIFACTS = 16;
const A2A_MAX_PARTS = 64;
const A2A_MAX_TEXT_BYTES = 1_048_576;
const A2A_MAX_DATA_BYTES = 1_048_576;
const A2A_MAX_DATA_DEPTH = 32;
const A2A_MAX_DATA_NODES = 10_000;
const A2A_MAX_COLLECTION_ENTRIES = 1_024;
const A2A_CANCEL_TIMEOUT_MS = 5_000;

/** Minimal info about a loaded app available as delegation target */
export interface DelegationTarget {
  readonly appName: string;
  readonly systemPrompt: string;
  /** Runtime-owned admitted execution; raw provider material never escapes the target boundary. */
  readonly execute: (input: {
    readonly fromApp: string;
    readonly task: string;
    readonly request: CreateMessageOptions;
  }) => Promise<AgentResponse>;
}

/** Registry of apps available for delegation */
export interface DelegationRegistry {
  readonly targets: ReadonlyMap<string, DelegationTarget>;
}

/** Configuration for A2A delegation */
export interface A2ADelegationConfig {
  readonly type: "a2a";
  readonly agentUrl: string;
  readonly message: Message;
  readonly timeout?: number;
}

/** Extended delegation type for A2A routing */
export interface ExtendedDelegation extends AppDelegation {
  readonly delegationType?: "a2a";
  readonly agentUrl?: string;
  readonly a2aMessage?: Message;
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
  a2aClient?: A2AClientPort,
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

    const message = delegation.a2aMessage ?? Message.fromJSON({
      kind: "message",
      messageId: crypto.randomUUID(),
      role: "ROLE_USER",
      parts: [{ kind: "text", text: delegation.task }],
    });

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
      target.execute({
        fromApp,
        task: delegation.task,
        request: {
        system: systemPrompt,
        messages: [{ role: "user" as const, parts: [{ type: "text" as const, text: delegation.task }] }],
        outputSchema: delegation.schema,
        maxTokens: DELEGATION_MAX_TOKENS,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DELEGATION_TIMEOUT")), timeoutMs),
      ),
    ]);

    const durationMs = performance.now() - startTime;

    let parsed: unknown;
    try {
      const responseText = response.parts.map(p => p.type === "text" ? p.text : "").join("");
      parsed = JSON.parse(responseText);
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
  client?: A2AClientPort,
): Promise<AppDelegationResult | DelegationError> {
  const effectiveClient = client ?? new A2AClient();
  const delegationId = crypto.randomUUID();
  const startTime = performance.now();

  try {
    const response = await effectiveClient.sendMessage(
      a2aConfig.agentUrl,
      a2aConfig.message,
      a2aConfig.timeout ?? DEFAULT_TIMEOUT_MS,
    );

    const durationMs = performance.now() - startTime;

    if (isTask(response) && response.status?.state !== TaskState.TASK_STATE_COMPLETED) {
      await cancelTaskBestEffort(effectiveClient, a2aConfig.agentUrl, response.id);
      return {
        code: "PROVIDER_ERROR",
        message: response.status === undefined
          ? "A2A task returned without a status"
          : `A2A task ended with state: ${taskStateToJSON(response.status.state)}`,
        delegationId,
        fromApp,
        toApp: a2aConfig.agentUrl,
      };
    }

    const extraction = extractA2AResult(response);
    if (extraction.result === undefined) {
      return {
        code: "PROVIDER_ERROR",
        message: extraction.error ?? "A2A response returned no extractable output",
        delegationId,
        fromApp,
        toApp: a2aConfig.agentUrl,
      };
    }

    return {
      delegationId,
      fromApp,
      toApp: a2aConfig.agentUrl,
      result: extraction.result,
      durationMs,
    };
  } catch (err) {
    if (err instanceof A2ATimeoutError) {
      return {
        code: "TIMEOUT",
        message: "A2A delegation timed out",
        delegationId,
        fromApp,
        toApp: a2aConfig.agentUrl,
      };
    }
    const message = err instanceof KilnError ? err.message : "A2A delegation failed";
    return {
      code: "PROVIDER_ERROR",
      message,
      delegationId,
      fromApp,
      toApp: a2aConfig.agentUrl,
    };
  }
}

function isTask(response: SendMessageResult): response is Task {
  return "status" in response;
}

function extractA2AResult(
  response: SendMessageResult,
): { readonly result?: Record<string, unknown>; readonly error?: string } {
  if (isTask(response)) {
    if (response.artifacts.length === 0) {
      return { error: "A2A task completed with no extractable output" };
    }
    if (response.artifacts.length > A2A_MAX_ARTIFACTS) {
      return { error: "A2A response exceeded the artifact limit" };
    }
    return extractA2AParts(iterateTaskParts(response));
  }
  return extractA2AParts(iterateParts(response.parts));
}

function* iterateTaskParts(response: Task): Generator<Part, void, undefined> {
  let partCount = 0;
  for (const artifact of response.artifacts) {
    for (const part of artifact.parts) {
      partCount += 1;
      if (partCount > A2A_MAX_PARTS) throw new A2AExtractionLimitError("A2A response exceeded the part limit");
      yield part;
    }
  }
}

function* iterateParts(parts: readonly Part[]): Generator<Part, void, undefined> {
  if (parts.length > A2A_MAX_PARTS) throw new A2AExtractionLimitError("A2A response exceeded the part limit");
  yield* parts;
}

class A2AExtractionLimitError extends Error {}

function extractA2AParts(parts: Iterable<Part>): { readonly result?: Record<string, unknown>; readonly error?: string } {
  try {
    let sawPart = false;
    for (const part of parts) {
      sawPart = true;
      const content = part.content;
      if (content === undefined) return { error: "A2A response contained a malformed part" };
      if (content.$case === "data") {
        if (!isRecord(content.value)) return { error: "A2A response data part must contain an object" };
        if (!isBoundedJsonObject(content.value)) return { error: "A2A response data exceeds structural limits" };
        return { result: content.value };
      }
      if (content.$case === "text") {
        if (new TextEncoder().encode(content.value).byteLength > A2A_MAX_TEXT_BYTES) return { error: "A2A response exceeded the text size limit" };
        try {
          const parsed: unknown = JSON.parse(content.value);
          if (!isRecord(parsed)) return { error: "A2A text part JSON must contain an object" };
          if (!isBoundedJsonObject(parsed)) return { error: "A2A response data exceeds structural limits" };
          return { result: parsed };
        } catch {
          return { result: { text: content.value } };
        }
      }
    }
    return { error: sawPart ? "A2A response returned no extractable output" : "A2A response returned no extractable output" };
  } catch (error) {
    return { error: error instanceof A2AExtractionLimitError ? error.message : "A2A response data exceeds structural limits" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function cancelTaskBestEffort(
  client: A2AClientPort,
  agentUrl: string,
  taskId: string,
): Promise<void> {
  if (taskId === "") return;
  try {
    await client.cancelTask(agentUrl, taskId, A2A_CANCEL_TIMEOUT_MS);
  } catch {
    // Preserve the primary non-completed task diagnosis.
  }
}

function isBoundedJsonObject(root: Record<string, unknown>): boolean {
  try {
    const seen = new WeakSet<object>();
    const pending: Array<{ readonly value: unknown; readonly depth: number }> = [
      { value: root, depth: 0 },
    ];
    let nodes = 0;

    while (pending.length > 0) {
      const current = pending.pop()!;
      nodes += 1;
      if (nodes > A2A_MAX_DATA_NODES || current.depth > A2A_MAX_DATA_DEPTH) return false;

      const value = current.value;
      if (value === null || typeof value === "string" || typeof value === "boolean") continue;
      if (typeof value === "number") {
        if (!Number.isFinite(value)) return false;
        continue;
      }
      if (typeof value !== "object") return false;
      if (seen.has(value)) return false;
      seen.add(value);

      if (Array.isArray(value)) {
        if (value.length > A2A_MAX_COLLECTION_ENTRIES) return false;
        for (const child of value) pending.push({ value: child, depth: current.depth + 1 });
        continue;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return false;
      const entries = Object.entries(value);
      if (entries.length > A2A_MAX_COLLECTION_ENTRIES) return false;
      for (const [, child] of entries) pending.push({ value: child, depth: current.depth + 1 });
    }

    const serialized = JSON.stringify(root);
    return serialized !== undefined && new TextEncoder().encode(serialized).byteLength <= A2A_MAX_DATA_BYTES;
  } catch {
    return false;
  }
}
