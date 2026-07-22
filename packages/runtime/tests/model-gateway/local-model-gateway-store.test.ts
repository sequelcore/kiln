import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountRef } from "@kilnai/core";
import { LocalModelGatewayStore } from "../../src/model-gateway/local-model-gateway-store.js";

const secret = "durable-replay-test-key-with-at-least-32-bytes";
const completed = { responseId: "resp-1", result: { parts: [{ type: "text" as const, text: "safe" }], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "completed" } };
const fingerprint = { rawBody: "{}", ingress: "openai-responses", tenantId: "t", applicationId: "a", callerId: "c", sessionId: "s", turnId: "turn", route: { providerId: "codex-oauth", providerModelId: "m", scope: "default" }, toolExecutionMode: "caller-owned" };

describe("LocalModelGatewayStore", () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });
  const create = async (overrides: Partial<ConstructorParameters<typeof LocalModelGatewayStore>[0]> = {}) => {
    root ??= await mkdtemp(join(tmpdir(), "kiln-model-gateway-store-"));
    return new LocalModelGatewayStore({ path: join(root, "gateway.sqlite"), replaySecret: secret, replayTtlMs: 1_000, replayMaxEntries: 10, accounts: [{ accountRef: "account:file", maxConcurrency: 2, reservedAffinitySlots: 1 }], ...overrides });
  };

  it("encrypts completed replay across reopen and recovers active commit as unknown", async () => {
    const first = await create(); const key = first.fingerprint(fingerprint); const claim = first.claim(key); if (claim.kind !== "dispatch") throw new Error("fixture");
    first.markCommitted(key, claim.fence); first.complete(key, claim.fence, completed); first.close();
    const reopened = await create(); expect(reopened.claim(key)).toEqual({ kind: "replay-completed", value: completed });
    const key2 = reopened.fingerprint({ ...fingerprint, rawBody: "{ }" }); const claim2 = reopened.claim(key2); if (claim2.kind !== "dispatch") throw new Error("fixture"); reopened.markCommitted(key2, claim2.fence); reopened.close();
    const recovered = await create(); expect(recovered.claim(key2)).toEqual({ kind: "committed-unknown" }); recovered.close();
  });

  it("clears an abandoned precommit claim when a new owner recovers the store", async () => {
    const first = await create({ ownerId: "owner-a" });
    const key = first.fingerprint(fingerprint);
    const abandoned = first.claim(key);
    expect(abandoned.kind).toBe("dispatch");
    first.close();

    const recovered = await create({ ownerId: "owner-b" });
    const replacement = recovered.claim(key);
    expect(replacement.kind).toBe("dispatch");
    if (abandoned.kind === "dispatch" && replacement.kind === "dispatch") expect(replacement.fence).not.toBe(abandoned.fence);
    recovered.close();
  });

  it("rejects an authenticated completed replay with an invalid payload schema", async () => {
    const first = await create();
    const key = first.fingerprint(fingerprint);
    const claim = first.claim(key); if (claim.kind !== "dispatch") throw new Error("fixture");
    first.markCommitted(key, claim.fence);
    first.complete(key, claim.fence, { responseId: "resp-invalid", result: { parts: "invalid" } } as never);
    const toolResultKey = first.fingerprint({ ...fingerprint, rawBody: "tool-result" });
    const toolResultClaim = first.claim(toolResultKey); if (toolResultClaim.kind !== "dispatch") throw new Error("fixture");
    first.markCommitted(toolResultKey, toolResultClaim.fence);
    first.complete(toolResultKey, toolResultClaim.fence, { responseId: "resp-tool-result", result: { parts: [{ type: "tool-result", callId: "call", content: [{ type: "text", text: "not output" }] }], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "completed" } } as never);
    first.close();
    const reopened = await create();
    expect(() => reopened.claim(key)).toThrow("schema");
    expect(() => reopened.claim(toolResultKey)).toThrow("schema");
    reopened.close();
  });

  it("rejects a second live owner", async () => {
    const first = await create({ ownerId: "owner-a" });
    expect(() => new LocalModelGatewayStore({ path: join(root!, "gateway.sqlite"), replaySecret: secret, replayTtlMs: 1000, replayMaxEntries: 10, accounts: [], ownerId: "owner-b" })).toThrow("live runtime owner");
    first.close();
  });

  it("atomically enforces reserved new-work capacity while affinity may use all slots", async () => {
    const store = await create(); const account = createAccountRef("account:file");
    const scope = { identity: { tenantId: "t", applicationId: "a", callerId: "c", sessionId: "s", turnId: "turn" }, route: { providerId: "p", providerModelId: "m", scope: "r" } };
    expect(await store.acquire({ ...scope, account, purpose: "new" })).toBeDefined();
    expect(await store.acquire({ ...scope, account, purpose: "new" })).toBeUndefined();
    expect(await store.acquire({ ...scope, account, purpose: "affinity" })).toBeDefined();
    expect(store.pressure(account)).toBe(1); store.close();
  });

  it("does not double-count affinity leases against the new-work partition", async () => {
    const store = await create({ accounts: [{ accountRef: "account:partitioned", maxConcurrency: 4, reservedAffinitySlots: 2 }] });
    const account = createAccountRef("account:partitioned");
    const scope = { identity: { tenantId: "t", applicationId: "a", callerId: "c", sessionId: "s", turnId: "turn" }, route: { providerId: "p", providerModelId: "m", scope: "r" } };
    expect(await store.acquire({ ...scope, account, purpose: "affinity" })).toBeDefined();
    expect(await store.acquire({ ...scope, account, purpose: "new" })).toBeDefined();
    expect(await store.acquire({ ...scope, account, purpose: "new" })).toBeDefined();
    expect(await store.acquire({ ...scope, account, purpose: "new" })).toBeUndefined();
    store.close();
  });

  it("binds a lease to its trusted principal and exact route", async () => {
    const store = await create(); const account = createAccountRef("account:file");
    const identity = { tenantId: "tenant-a", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "turn" };
    const route = { providerId: "provider", providerModelId: "model-a", scope: "virtual:model-a" };
    const lease = await store.acquire({ identity, route, account, purpose: "new" });
    expect(store.verifyLease({ leaseId: lease!.leaseId, accountRef: account, identity, route })).toBe(true);
    expect(store.verifyLease({ leaseId: lease!.leaseId, accountRef: account, identity: { ...identity, tenantId: "tenant-b" }, route })).toBe(false);
    expect(store.verifyLease({ leaseId: lease!.leaseId, accountRef: account, identity, route: { ...route, providerModelId: "model-b" } })).toBe(false);
    store.close();
  });

  it("namespaces affinity authority by trusted identity and route", async () => {
    const store = await create();
    const route = { providerId: "codex-oauth", providerModelId: "m", scope: "virtual:m" };
    const identity = { tenantId: "tenant-a", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "turn" };
    const affinity = { account: createAccountRef("account:file"), route };
    await store.write({ identity, route, key: "same-observed-key", affinity });
    await expect(store.read({ identity, route, key: "same-observed-key" })).resolves.toEqual(affinity);
    await expect(store.read({ identity: { ...identity, tenantId: "tenant-b" }, route, key: "same-observed-key" })).resolves.toBeUndefined();
    await expect(store.read({ identity, route: { ...route, providerModelId: "other" }, key: "same-observed-key" })).resolves.toBeUndefined();
    store.close();
  });
});
