import { describe, expect, it } from "vitest";
import {
  CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
  normalizeAndDigestCapabilityJsonSchema,
} from "@kilnai/core/capabilities";
import {
  canReplayPortableInvocation,
  createPortableInvocationBinding,
  digestPortable,
  isRuntimeOwnedPortableInvocationSettlement,
  settlePortableInvocation,
  type PortableInvocationBinding,
} from "../../src/capabilities/portable-execution.js";

const DIGEST_A = `sha256:${"a".repeat(64)}` as const;
const DIGEST_B = `sha256:${"b".repeat(64)}` as const;
const DIGEST_C = `sha256:${"c".repeat(64)}` as const;
const INPUT_SCHEMA = {
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
} as const;
const OUTPUT_SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
} as const;

function schemaDigest(schema: Record<string, unknown>, direction: "input" | "output"): `sha256:${string}` {
  const result = normalizeAndDigestCapabilityJsonSchema(schema, direction, { requireObjectType: true });
  if (!result.ok || !result.present) throw new Error("Fixture schema must normalize.");
  return result.digest;
}

const INPUT_DIGEST = schemaDigest(INPUT_SCHEMA, "input");
const OUTPUT_DIGEST = schemaDigest(OUTPUT_SCHEMA, "output");

function binding(overrides: Partial<Parameters<typeof createPortableInvocationBinding>[0]> = {}): PortableInvocationBinding {
  return createPortableInvocationBinding({
    generationId: DIGEST_A,
    catalogDigest: DIGEST_B,
    capabilityId: "fixture.capability",
    revision: "v1",
    descriptorDigest: DIGEST_C,
    toolName: "fixture_tool",
    implementationIdentityDigest: DIGEST_A,
    inputSchemaDigest: INPUT_DIGEST,
    outputSchemaDigest: OUTPUT_DIGEST,
    inputSchema: INPUT_SCHEMA,
    outputSchema: OUTPUT_SCHEMA,
    toolCallScopeId: "scope-1",
    toolCallId: "call-1",
    input: { value: "candidate" },
    limits: { maxInputBytes: 16_384, maxOutputBytes: 16_384, maxDurationMs: 1_000, maxArtifacts: 0 },
    idempotency: "idempotent",
    ...overrides,
  });
}

describe("portable invocation contract", () => {
  it("defers candidate schema failure to invocation preparation", () => {
    const admitted = binding({ input: {} });
    expect(admitted.inputDigest).toBe(digestPortable({}));
  });

  it("creates a frozen settlement with sanitized terminal text and output digest", () => {
    const result = settlePortableInvocation({
      binding: binding(),
      port: "cli",
      status: "completed",
      dispatch: "terminally-observed",
      startedAt: "2026-08-30T10:00:00.000Z",
      settledAt: "2026-08-30T10:00:00.100Z",
      durationMs: 100,
      stdout: "Bearer top-secret-token\nvalue",
      stderr: "authorization=hidden",
      outputDigest: DIGEST_C,
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(result.stdout).not.toContain("top-secret-token");
    expect(result.stderr).toContain("authorization=<redacted>");
    expect(result.outputDigest).toBe(DIGEST_C);
    expect(result.settlementId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.outputBytes).toBeLessThanOrEqual(result.limits.maxOutputBytes);
    expect(isRuntimeOwnedPortableInvocationSettlement(result)).toBe(true);
    expect(isRuntimeOwnedPortableInvocationSettlement(structuredClone(result))).toBe(false);
  });

  it("allows replay only for explicit idempotent postures", () => {
    expect(canReplayPortableInvocation(binding({ idempotency: "idempotent" }))).toBe(true);
    expect(canReplayPortableInvocation(binding({ idempotency: "unknown" }))).toBe(false);
    expect(canReplayPortableInvocation(binding({
      idempotency: "conditionally-idempotent",
      idempotencyKey: "request-1",
      replayPosture: "allow",
    }))).toBe(true);
    expect(() => binding({ idempotency: "conditionally-idempotent", replayPosture: "allow" })).toThrow(/replay key/u);
  });

  it("supports an absent output schema without inventing a schema digest", () => {
    const result = binding({
      outputSchema: undefined,
      outputSchemaDigest: CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
    });
    expect(result.outputValidator).toBeUndefined();
  });
});
