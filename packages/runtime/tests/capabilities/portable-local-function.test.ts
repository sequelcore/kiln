import { describe, expect, it, vi } from "vitest";
import {
  CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
  normalizeAndDigestCapabilityJsonSchema,
} from "@kilnai/core/capabilities";
import {
  createLocalFunctionPortableInvocationPort,
  createTrustedRuntimeBuiltinPortableInvocationPort,
} from "../../src/capabilities/portable-local-function.js";
import { createPortableInvocationBinding } from "../../src/capabilities/portable-execution.js";

const A = `sha256:${"a".repeat(64)}` as const;
const B = `sha256:${"b".repeat(64)}` as const;
const C = `sha256:${"c".repeat(64)}` as const;
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

function makeBinding(overrides: Record<string, unknown> = {}) {
  return createPortableInvocationBinding({
    generationId: A,
    catalogDigest: B,
    capabilityId: "fixture.capability",
    revision: "v1",
    descriptorDigest: C,
    toolName: "fixture_tool",
    implementationIdentityDigest: A,
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

describe("PortableLocalFunctionInvocationPort", () => {
  it("freezes the admitted input and validates the typed output", async () => {
    let frozen = false;
    const port = createLocalFunctionPortableInvocationPort({
      handler: async (input) => {
        frozen = Object.isFrozen(input);
        return { ok: true };
      },
      now: () => "2026-08-30T10:00:00.000Z",
      monotonicNow: () => 100,
    });
    const result = await port.invoke({ binding: makeBinding(), input: { value: "candidate" } });
    expect(frozen).toBe(true);
    expect(result.output).toEqual({ ok: true });
    expect(result.settlement.status).toBe("completed");
    expect(result.settlement.port).toBe("local-function");
  });

  it("preserves an explicit CLI semantic kind for a hardened process-backed handler", async () => {
    const port = createLocalFunctionPortableInvocationPort({
      kind: "cli",
      handler: () => ({ ok: true }),
    });
    const result = await port.invoke({ binding: makeBinding(), input: { value: "candidate" } });
    expect(result.settlement.port).toBe("cli");
  });

  it("settles missing trusted context before invoking the Runtime builtin", async () => {
    const executor = vi.fn(async () => ({ output: "ok", isError: false, metadata: {} }));
    const port = createTrustedRuntimeBuiltinPortableInvocationPort({ executor, kind: "local-function" });
    const result = await port.invoke({
      binding: makeBinding({ outputSchema: undefined, outputSchemaDigest: CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST }),
      input: { value: "candidate" },
    });
    expect(result.settlement.status).toBe("failed");
    expect(result.settlement.diagnosticCode).toBe("missing_context");
    expect(executor).not.toHaveBeenCalled();
  });

  it("passes trusted Runtime context process-locally and keeps it out of settlement", async () => {
    const context = { authority: { secret: "must-not-serialize" } };
    const executor = vi.fn(async (_input, received) => ({
      output: received !== context
        && (received as unknown as typeof context | undefined)?.authority === context.authority
        && received?.abortSignal instanceof AbortSignal
        ? "ok"
        : "wrong",
      isError: false,
      metadata: {},
    }));
    const port = createTrustedRuntimeBuiltinPortableInvocationPort({ executor, kind: "local-function" });
    const result = await port.invoke({
      binding: makeBinding({ outputSchema: undefined, outputSchemaDigest: CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST }),
      input: { value: "candidate" },
      trustedContext: context,
    });
    expect(result.output?.output).toBe("ok");
    expect(JSON.stringify(result.settlement)).not.toContain("must-not-serialize");
  });

  it("propagates the port-owned timeout signal through the Runtime builtin bridge", async () => {
    let receivedSignal: AbortSignal | undefined;
    const executor = vi.fn(async (_input, context) => {
      receivedSignal = context?.abortSignal;
      await new Promise<void>(() => undefined);
      return { output: "unreachable", isError: false };
    });
    const port = createTrustedRuntimeBuiltinPortableInvocationPort({ executor, kind: "local-function" });
    const result = await port.invoke({
      binding: makeBinding({
        outputSchema: undefined,
        outputSchemaDigest: CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
        limits: { maxInputBytes: 16_384, maxOutputBytes: 16_384, maxDurationMs: 10, maxArtifacts: 0 },
      }),
      input: { value: "candidate" },
      trustedContext: { authority: { secret: "process-local" } },
      timeoutMs: 1,
    });
    expect(result.settlement.status).toBe("timed_out");
    expect(result.settlement.dispatch).toBe("outcome-unknown");
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("settles malformed output and never replays unknown work", async () => {
    const calls = vi.fn();
    const port = createLocalFunctionPortableInvocationPort({
      handler: () => { calls(); return { ok: "not-a-boolean" }; },
    });
    const request = { binding: makeBinding({ idempotency: "unknown" }), input: { value: "candidate" } };
    const first = await port.invoke(request);
    const second = await port.invoke(request);
    expect(first.settlement.status).toBe("invalid_output");
    expect(second.settlement.status).toBe("replay_conflict");
    expect(calls).toHaveBeenCalledOnce();
  });

  it("settles an already-aborted call without entering the handler", async () => {
    const controller = new AbortController();
    controller.abort();
    const handler = vi.fn(() => ({ ok: true }));
    const result = await createLocalFunctionPortableInvocationPort({ handler }).invoke({
      binding: makeBinding(),
      input: { value: "candidate" },
      signal: controller.signal,
    });
    expect(result.settlement.status).toBe("cancelled");
    expect(result.settlement.dispatch).toBe("known-not-dispatched");
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(["timed_out", "output_limit_exceeded"] as const)(
    "settles non-preemptible local work conservatively as %s",
    async (mode) => {
      const port = createLocalFunctionPortableInvocationPort({
        handler: async (_input, context) => {
          if (mode === "output_limit_exceeded") {
            context.onOutput({ stream: "stdout", text: "0123456789" });
          }
          await new Promise<void>(() => undefined);
          return { ok: true };
        },
      });
      const result = await port.invoke({
        binding: makeBinding({
          limits: { maxInputBytes: 16_384, maxOutputBytes: 8, maxDurationMs: 10, maxArtifacts: 0 },
        }),
        input: { value: "candidate" },
        ...(mode === "timed_out" ? { timeoutMs: 1 } : {}),
      });
      expect(result.settlement.status).toBe(mode);
      expect(result.settlement.dispatch).toBe("outcome-unknown");
      expect(result.settlement.outputTruncated).toBe(mode === "output_limit_exceeded");
    },
  );

  it("records an observed handler failure as terminal rather than unknown", async () => {
    const result = await createLocalFunctionPortableInvocationPort({
      handler: () => { throw new Error("fixture failure"); },
    }).invoke({
      binding: makeBinding(),
      input: { value: "candidate" },
    });
    expect(result.settlement.status).toBe("failed");
    expect(result.settlement.dispatch).toBe("terminally-observed");
  });
});
