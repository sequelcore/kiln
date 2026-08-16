import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationExecutor } from "../../src/gateway/integration-executor.js";
import {
  type CredentialResolver,
  type IntegrationAdapter,
  type IntegrationResult,
  KilnError,
  type ResolvedCredential,
} from "@kilnai/core/engine";

function makeAdapter(overrides?: Partial<IntegrationAdapter>): IntegrationAdapter {
  return {
    provider: "test_provider",
    version: "1.0.0",
    operations: [
      { name: "do_thing", description: "Do a thing", inputSchema: { type: "object" } },
    ],
    execute: vi.fn(async (): Promise<IntegrationResult> => ({ data: { success: true } })),
    ...overrides,
  };
}

function makeResolver(overrides?: Partial<CredentialResolver>): CredentialResolver {
  return {
    resolve: vi.fn(async (): Promise<ResolvedCredential> => ({ type: "bearer", value: "tok_123" })),
    invalidate: vi.fn(),
    ...overrides,
  };
}

describe("IntegrationExecutor", () => {
  afterEach(() => vi.restoreAllMocks());

  it("executes operation and returns result data", async () => {
    const adapter = makeAdapter();
    const resolver = makeResolver();
    const executor = new IntegrationExecutor(adapter, resolver, "t1", "cred-key");

    const result = await executor.execute("do_thing", { input: "val" });

    expect(result).toEqual({ success: true });
    expect(resolver.resolve).toHaveBeenCalledWith("t1", "cred-key");
    expect(adapter.execute).toHaveBeenCalledWith(
      "do_thing",
      { type: "bearer", value: "tok_123" },
      { input: "val" },
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
  });

  it("throws INTEGRATION_TOOL_FAILED for unknown operation", async () => {
    const executor = new IntegrationExecutor(makeAdapter(), makeResolver(), "t1", "k");

    const err = await executor.execute("nonexistent", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KilnError);
    expect((err as KilnError).code).toBe("INTEGRATION_TOOL_FAILED");
    expect((err as KilnError).retryable).toBe(false);
  });

  it("throws CREDENTIAL_RESOLVE_FAILED when resolver fails", async () => {
    const resolver = makeResolver({
      resolve: vi.fn().mockRejectedValue(new Error("vault unavailable")),
    });
    const executor = new IntegrationExecutor(makeAdapter(), resolver, "t1", "k");

    const err = await executor.execute("do_thing", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KilnError);
    expect((err as KilnError).code).toBe("CREDENTIAL_RESOLVE_FAILED");
    expect((err as KilnError).retryable).toBe(true);
  });

  it("re-throws KilnError from resolver without wrapping", async () => {
    const original = new KilnError("SECRET_NOT_FOUND", "nope");
    const resolver = makeResolver({ resolve: vi.fn().mockRejectedValue(original) });
    const executor = new IntegrationExecutor(makeAdapter(), resolver, "t1", "k");

    const err = await executor.execute("do_thing", {}).catch((e: unknown) => e);
    expect(err).toBe(original);
  });

  it("wraps adapter execution errors in INTEGRATION_TOOL_FAILED", async () => {
    const adapter = makeAdapter({
      execute: vi.fn().mockRejectedValue(new Error("API down")),
    });
    const executor = new IntegrationExecutor(adapter, makeResolver(), "t1", "k");

    const err = await executor.execute("do_thing", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KilnError);
    expect((err as KilnError).code).toBe("INTEGRATION_TOOL_FAILED");
    expect((err as KilnError).message).toContain("API down");
    expect((err as KilnError).retryable).toBe(true);
  });

  it("re-throws KilnError from adapter without wrapping", async () => {
    const original = new KilnError("INTERNAL_ERROR", "boom");
    const adapter = makeAdapter({ execute: vi.fn().mockRejectedValue(original) });
    const executor = new IntegrationExecutor(adapter, makeResolver(), "t1", "k");

    const err = await executor.execute("do_thing", {}).catch((e: unknown) => e);
    expect(err).toBe(original);
  });
});
