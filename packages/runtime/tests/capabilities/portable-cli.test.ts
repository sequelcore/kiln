import { describe, expect, it, vi } from "vitest";
import {
  CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
  normalizeAndDigestCapabilityJsonSchema,
} from "@kilnai/core/capabilities";
import type { CommandProcessRunner } from "@kilnai/core/tools";
import {
  createCliPortableInvocationPort,
  type PortableCliInvocationPortOptions,
} from "../../src/capabilities/portable-cli.js";
import { createPortableInvocationBinding, digestPortable } from "../../src/capabilities/portable-execution.js";

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
    limits: { maxInputBytes: 16_384, maxOutputBytes: 128, maxDurationMs: 1_000, maxArtifacts: 0 },
    idempotency: "idempotent",
    ...overrides,
  });
}

function options(runner: CommandProcessRunner, overrides: Partial<PortableCliInvocationPortOptions> = {}): PortableCliInvocationPortOptions {
  return {
    executable: process.execPath,
    cwd: process.cwd(),
    env: { KILN_PORTABLE_TEST: "yes" },
    args: ["--fixture"],
    runner,
    now: () => "2026-08-30T10:00:00.000Z",
    monotonicNow: () => 100,
    ...overrides,
  };
}

describe("PortableCliInvocationPort", () => {
  it("uses absolute argv-only execution, explicit env, and exact output validation", async () => {
    const starts: Array<{ executable: string; args: readonly string[]; cwd: string; env?: Readonly<Record<string, string>>; shell?: false }> = [];
    const runner: CommandProcessRunner = {
      start(request, sink) {
        starts.push(request);
        sink.output({ stream: "stdout", text: '{"ok":true}' });
        sink.finish({ exitCode: 0 });
        return { async stop() {} };
      },
    };
    const port = createCliPortableInvocationPort(options(runner));
    const result = await port.invoke({ binding: makeBinding(), input: { value: "candidate" } });

    expect(result.settlement.status).toBe("completed");
    expect(result.output).toEqual({ ok: true });
    expect(result.settlement.outputDigest).toBe(digestPortable({ ok: true }));
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      executable: process.execPath,
      args: ["--fixture"],
      cwd: process.cwd(),
      env: { KILN_PORTABLE_TEST: "yes" },
      shell: false,
    });
  });

  it("settles malformed output, unavailable process, and mismatched implementation without throwing", async () => {
    const malformedRunner: CommandProcessRunner = {
      start(_request, sink) {
        sink.output({ stream: "stdout", text: "not-json" });
        sink.finish({ exitCode: 0 });
        return { async stop() {} };
      },
    };
    const malformed = await createCliPortableInvocationPort(options(malformedRunner)).invoke({
      binding: makeBinding(),
      input: { value: "candidate" },
    });
    expect(malformed.settlement.status).toBe("invalid_output");
    expect(malformed.settlement.dispatch).toBe("terminally-observed");

    const unavailable = await createCliPortableInvocationPort(options({
      start() { throw new Error("unavailable secret"); },
    })).invoke({ binding: makeBinding(), input: { value: "candidate" } });
    expect(unavailable.settlement.status).toBe("failed");
    expect(unavailable.settlement.dispatch).toBe("known-not-dispatched");
    expect(JSON.stringify(unavailable.settlement)).not.toContain("unavailable secret");

    const mismatch = await createCliPortableInvocationPort(options(malformedRunner, {
      implementationIdentityDigest: B,
    })).invoke({ binding: makeBinding(), input: { value: "candidate" } });
    expect(mismatch.settlement.diagnosticCode).toBe("implementation_mismatch");
    expect(mismatch.settlement.dispatch).toBe("known-not-dispatched");
  });

  it.each(["timed_out", "cancelled", "output_limit_exceeded"] as const)(
    "settles the bounded process lifecycle as %s and stops overflow",
    async (mode) => {
      const stop = vi.fn<(reason: "cancelled" | "timeout" | "stopped") => Promise<void>>();
      const runner: CommandProcessRunner = {
        start(request, sink) {
          const handle = {
            stop: async (reason: "cancelled" | "timeout" | "stopped") => {
              stop(reason);
              sink.finish({
                signal: "SIGTERM",
                ...(reason === "cancelled" ? { cancelled: true } : {}),
                ...(reason === "timeout" ? { timedOut: true } : {}),
              });
            },
          };
          if (mode === "timed_out") setTimeout(() => sink.finish({ signal: "SIGTERM", timedOut: true }), request.timeoutMs);
          if (mode === "cancelled") request.signal?.addEventListener("abort", () => void handle.stop("cancelled"), { once: true });
          if (mode === "output_limit_exceeded") queueMicrotask(() => sink.output({ stream: "stdout", text: "0123456789" }));
          return handle;
        },
      };
      const controller = new AbortController();
      const port = createCliPortableInvocationPort(options(runner, {
        outputParser: (stdout) => stdout,
      }));
      const request = {
        binding: makeBinding({
          outputSchema: undefined,
          outputSchemaDigest: CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
          limits: { maxInputBytes: 16_384, maxOutputBytes: 8, maxDurationMs: 10, maxArtifacts: 0 },
        }),
        input: { value: "candidate" },
        ...(mode === "cancelled" ? { signal: controller.signal } : {}),
        ...(mode === "cancelled" ? {} : { timeoutMs: 1 }),
      };
      const resultPromise = port.invoke(request);
      if (mode === "cancelled") controller.abort();
      const result = await resultPromise;
      expect(result.settlement.status).toBe(mode);
      if (mode === "output_limit_exceeded") expect(stop).toHaveBeenCalledWith("stopped");
      if (mode === "timed_out") expect(stop).not.toHaveBeenCalled();
    },
  );

  it("returns an immutable replay for idempotent calls and conflicts for unknown work", async () => {
    const starts = vi.fn();
    const runner: CommandProcessRunner = {
      start(_request, sink) {
        starts();
        sink.output({ stream: "stdout", text: '{"ok":true}' });
        sink.finish({ exitCode: 0 });
        return { async stop() {} };
      },
    };
    const port = createCliPortableInvocationPort(options(runner));
    const request = { binding: makeBinding(), input: { value: "candidate" } };
    const first = await port.invoke(request);
    const second = await port.invoke(request);
    expect(starts).toHaveBeenCalledOnce();
    expect(second.replayed).toBe(true);
    expect(second.settlement).toBe(first.settlement);

    const unknownPort = createCliPortableInvocationPort(options(runner));
    const unknownRequest = { binding: makeBinding({ idempotency: "unknown" }), input: { value: "candidate" } };
    await unknownPort.invoke(unknownRequest);
    const conflict = await unknownPort.invoke(unknownRequest);
    expect(conflict.replayed).toBe(false);
    expect(conflict.settlement.status).toBe("replay_conflict");
    expect(starts).toHaveBeenCalledTimes(2);
  });

  it("settles invalid input without dispatch", async () => {
    const start = vi.fn();
    const port = createCliPortableInvocationPort(options({ start }));
    const result = await port.invoke({ binding: makeBinding({ input: {} }), input: {} });
    expect(result.settlement.status).toBe("invalid_input");
    expect(result.settlement.dispatch).toBe("known-not-dispatched");
    expect(start).not.toHaveBeenCalled();
  });

  it("rejects a shell-looking or credential-bearing argv entry before process start", () => {
    const runner: CommandProcessRunner = { start() { throw new Error("must not start"); } };
    expect(() => createCliPortableInvocationPort(options(runner, { args: ["token=secret-value"] }))).toThrow(/unsafe/u);
    expect(() => createCliPortableInvocationPort(options(runner, { args: ["--api-key", "plaincredential"] }))).toThrow(/unsafe/u);
    expect(() => createCliPortableInvocationPort(options(runner, { args: ["--token", "plaincredential"] }))).toThrow(/unsafe/u);
    expect(() => createCliPortableInvocationPort(options(runner, { args: ["--client-secret", "plaincredential"] }))).toThrow(/unsafe/u);
    expect(() => createCliPortableInvocationPort(options(runner, { args: ["--auth-token", "plaincredential"] }))).toThrow(/unsafe/u);
    expect(() => createCliPortableInvocationPort(options(runner, { args: ["--oauth-token", "plaincredential"] }))).toThrow(/unsafe/u);
    expect(() => createCliPortableInvocationPort(options(runner, { args: ["/password", "plaincredential"] }))).toThrow(/unsafe/u);
    expect(() => createCliPortableInvocationPort(options(runner, { env: { PATH: "ambient" } }))).not.toThrow();
  });

  it("supports text output when the admitted output schema is absent", async () => {
    const runner: CommandProcessRunner = {
      start(_request, sink) {
        sink.output({ stream: "stdout", text: "plain result" });
        sink.finish({ exitCode: 0 });
        return { async stop() {} };
      },
    };
    const result = await createCliPortableInvocationPort(options(runner)).invoke({
      binding: makeBinding({ outputSchema: undefined, outputSchemaDigest: CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST }),
      input: { value: "candidate" },
    });
    expect(result.output).toBe("plain result");
    expect(result.settlement.status).toBe("completed");
  });
});
