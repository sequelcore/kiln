// Guardrail validation: validate agent output against JSON Schema subset
// Pure functions, zero external dependencies

import { KilnError } from "../engine/errors.js";

/** Result of guardrail validation */
export interface GuardrailResult {
  readonly passed: boolean;
  readonly errors: readonly string[];
  readonly retryFeedback?: string;
}

/**
 * Validate structured output against a JSON Schema subset.
 * Supports: type, required, properties, enum, minLength, maxLength,
 * minimum, maximum, items. Max recursion depth: 5.
 */
export function validateJsonSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path = "$",
  depth = 0,
): GuardrailResult {
  if (depth > 5) {
    return { passed: true, errors: [] };
  }

  const errors: string[] = [];

  // type check
  if (schema.type !== undefined) {
    const schemaType = schema.type as string;
    if (!checkType(value, schemaType)) {
      errors.push(`${path}: expected type "${schemaType}", got ${typeof value}`);
      return makeResult(errors);
    }
  }

  // enum check
  if (schema.enum !== undefined && Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) {
      errors.push(`${path}: value must be one of [${schema.enum.join(", ")}]`);
    }
  }

  // string constraints
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${path}: string length ${value.length} < minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(`${path}: string length ${value.length} > maxLength ${schema.maxLength}`);
    }
  }

  // number constraints
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path}: value ${value} < minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${path}: value ${value} > maximum ${schema.maximum}`);
    }
  }

  // object: required + properties
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!(key in obj)) {
          errors.push(`${path}: missing required property "${key}"`);
        }
      }
    }

    if (typeof schema.properties === "object" && schema.properties !== null) {
      const props = schema.properties as Record<string, Record<string, unknown>>;
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in obj) {
          const subResult = validateJsonSchema(obj[key], propSchema, `${path}.${key}`, depth + 1);
          errors.push(...subResult.errors);
        }
      }
    }
  }

  // array: items
  if (Array.isArray(value) && typeof schema.items === "object" && schema.items !== null) {
    const itemSchema = schema.items as Record<string, unknown>;
    for (let i = 0; i < value.length; i++) {
      const subResult = validateJsonSchema(value[i], itemSchema, `${path}[${i}]`, depth + 1);
      errors.push(...subResult.errors);
    }
  }

  return makeResult(errors);
}

/**
 * Validate capability output against its schema.
 * Convenience wrapper around validateJsonSchema.
 */
export function validateOutput(
  output: unknown,
  schema: Record<string, unknown>,
): GuardrailResult {
  return validateJsonSchema(output, schema);
}

/**
 * Run guardrail validation with retry loop.
 * Calls the handler, validates output, retries with feedback on failure.
 */
export async function withGuardrail<T>(
  handler: (feedback?: string) => Promise<T>,
  schema: Record<string, unknown>,
  maxRetries = 3,
  onRetry?: (attempt: number, feedback: string) => void,
): Promise<T> {
  let lastFeedback: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await handler(lastFeedback);
    const validation = validateJsonSchema(result, schema);

    if (validation.passed) {
      return result;
    }

    if (attempt < maxRetries) {
      lastFeedback = validation.retryFeedback ?? validation.errors.join("; ");
      onRetry?.(attempt + 1, lastFeedback);
    } else {
      throw new KilnError("GUARDRAIL_FAILED", `Output validation failed after ${maxRetries + 1} attempts: ${validation.errors.join("; ")}`, {
        context: { errors: validation.errors, attempts: maxRetries + 1 },
      });
    }
  }

  // Unreachable, but TypeScript needs it
  throw new KilnError("GUARDRAIL_FAILED", "Guardrail loop exhausted");
}

function checkType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number" && (expected !== "integer" || Number.isInteger(value));
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function makeResult(errors: string[]): GuardrailResult {
  return {
    passed: errors.length === 0,
    errors,
    retryFeedback: errors.length > 0
      ? `Validation failed: ${errors.join("; ")}. Please fix and try again.`
      : undefined,
  };
}
