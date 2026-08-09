import { createAccountPolicyId, createAccountRef, type ModelGatewayOneRoundDispatchInput, type ModelTurnResult } from "@kilnai/core";
import { SqliteManagedAccountLeaseAuthority } from "../../src/managed-account-leases/managed-account-lease-authority.js";
import { describe, expect, it, vi } from "vitest";
import { createAnthropicMessagesRoutes, type AnthropicMessagesIngressConfig } from "../../src/model-gateway/anthropic-messages-routes.js";
import type { GovernedOneRoundInvocationPorts } from "../../src/model-gateway/governed-one-round-invocation.js";
import { InMemoryModelGatewayReplayGuard } from "../../src/model-gateway/replay-guard.js";

const principal = { tenantId: "tenant", applicationId: "app", callerId: "claude", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidence: { status: "admitted" as const, evidenceId: "budget" } };
const route = { providerId: "codex-oauth", providerModelId: "upstream", scope: "virtual:claude-kiln" };
const result: ModelTurnResult = { parts: [{ type: "text", text: "PROBE_OK" }], usage: { inputTokens: 4, outputTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 0 }, stopReason: "completed" };

function fixture(overrides: Partial<AnthropicMessagesIngressConfig> & { execute?: (input: ModelGatewayOneRoundDispatchInput) => Promise<ModelTurnResult> } = {}) {
  const execute = vi.fn(overrides.execute ?? (async () => result));
  const authority = new SqliteManagedAccountLeaseAuthority({ path: ":memory:", participantKind: "model-gateway-ingress", recoveryDomain: `anthropic-test-${crypto.randomUUID()}`, configurationRevision: "test" });
  const candidate = vi.fn(async (input) => ({ accountPolicyId: createAccountPolicyId("gateway:test"), candidates: [{ candidate: { account: createAccountRef("account"), route: input.route, health: "healthy" as const, leaseCapacity: "available" as const, pressure: 0, reservedForNewWork: false }, capacityIdentity: "configured:fixture:account", credentialRevisionId: "a".repeat(64), usageEvidence: { health: "healthy" as const, freshness: "missing" as const }, capacity: { maxConcurrency: 10, reservedAffinitySlots: 0 } }] }));
  const invocationPorts: GovernedOneRoundInvocationPorts = {
    candidateCatalog: { list: candidate }, accountCapacityAuthority: authority,
    attemptEvidence: { record: async () => undefined }, dispatcherResolver: { resolve: async () => ({ dispatchOneRound: execute }) },
  };
  const namespaceCorrelation = vi.fn(async () => ({ sessionId: "ns:session", turnId: "ns:turn" }));
  const config: AnthropicMessagesIngressConfig = {
    authenticate: async (token) => token === "valid-token" ? principal : undefined,
    resolveVirtualModel: async ({ requestedModel }) => requestedModel === "claude-kiln" ? { route, capabilities: new Set(["text", "function-tools"]), affinity: { continuity: "none" } } : undefined,
    listVirtualModels: async () => [{ id: "claude-kiln", displayName: "Claude Kiln" }, { id: "internal-model", displayName: "Hidden" }],
    namespaceCorrelation, compatibilityEvidence: { record: async () => undefined }, invocationPorts,
    createAttemptId: () => `attempt-${crypto.randomUUID()}`, createMessageId: () => "msg_kiln_1",
    ...overrides,
  };
  return { config, execute, candidate, namespaceCorrelation };
}

function messages(headers: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  return new Request("http://127.0.0.1/v1/messages?beta=true", { method: "POST", headers: { authorization: "Bearer valid-token", "anthropic-version": "2023-06-01", "content-type": "application/json", "x-claude-code-session-id": "session-1", "x-claude-code-agent-id": "agent-1", "x-claude-code-parent-agent-id": "parent-1", ...headers }, body: JSON.stringify({ model: "claude-kiln", max_tokens: 64, stream: true, messages: [{ role: "user", content: "hello" }], ...body }) });
}

describe("Anthropic Messages authenticated loopback ingress", () => {
  it("matches the messages pathname with beta query and emits mandatory SSE", async () => {
    const value = fixture();
    const response = await createAnthropicMessagesRoutes(value.config).request(messages());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain("event: message_stop");
    expect(value.execute).toHaveBeenCalledOnce();
    expect(value.namespaceCorrelation).toHaveBeenCalledWith(expect.objectContaining({ observed: expect.objectContaining({ sessionId: "session-1", agentId: "agent-1", parentAgentId: "parent-1", rawBodyDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }) }));
  });

  it("keeps token counting absent instead of inventing an approximate tokenizer", async () => {
    const app = createAnthropicMessagesRoutes(fixture().config);
    const response = await app.request(new Request("http://127.0.0.1/v1/messages/count_tokens", { method: "POST", headers: { "x-api-key": "valid-token", "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(404);
  });

  it("accepts one auth scheme or equal dual credentials and rejects contradictory dual credentials", async () => {
    const app = createAnthropicMessagesRoutes(fixture().config);
    expect((await app.request(messages({ authorization: "", "x-api-key": "valid-token" }))).status).toBe(200);
    expect((await app.request(messages({ "x-api-key": "valid-token" }))).status).toBe(200);
    const conflict = await app.request(messages({ "x-api-key": "different-token" }));
    expect(conflict.status).toBe(401);
    expect(await conflict.text()).not.toContain("different-token");
  });

  it("requires current Anthropic version and fails closed before dispatch for unsupported beta semantics", async () => {
    const value = fixture();
    const app = createAnthropicMessagesRoutes(value.config);
    expect((await app.request(messages({ "anthropic-version": "2024-01-01" }))).status).toBe(400);
    expect((await app.request(messages({ "anthropic-beta": "structured-outputs-2025-11-13" }, { output_config: { format: { type: "json_schema", schema: {} } } }))).status).toBe(400);
    expect(value.execute).not.toHaveBeenCalled();
    const headerOnly = fixture();
    expect((await createAnthropicMessagesRoutes(headerOnly.config).request(messages({ "anthropic-beta": "future-open-list-beta" }))).status).toBe(200);
    expect(headerOnly.execute).toHaveBeenCalledOnce();
  });

  it("authenticates model discovery, applies principal ACL, and hides non-Claude ids", async () => {
    const value = fixture();
    const app = createAnthropicMessagesRoutes(value.config);
    const unauthorized = await app.request(new Request("http://127.0.0.1/v1/models?limit=1000"));
    expect(unauthorized.status).toBe(401);
    const response = await app.request(new Request("http://127.0.0.1/v1/models?limit=1000", { headers: { "x-api-key": "valid-token" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [{ id: "claude-kiln", display_name: "Claude Kiln" }] });
  });

  it("enforces the configured raw-body cap before parsing or dispatch", async () => {
    const value = fixture({ maxBodyBytes: 32 });
    const response = await createAnthropicMessagesRoutes(value.config).request(messages());
    expect(response.status).toBe(413);
    expect(value.execute).not.toHaveBeenCalled();
  });

  it("returns a client error before dispatch when tool history violates the model-turn contract", async () => {
    const value = fixture();
    const response = await createAnthropicMessagesRoutes(value.config).request(messages({}, { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "missing", content: "no call" }] }] }));
    expect(response.status).toBe(400);
    expect(value.execute).not.toHaveBeenCalled();
  });

  it("replays identical completed bodies and retains provider failures as committed unknown", async () => {
    const replayGuard = new InMemoryModelGatewayReplayGuard({ hmacKey: "anthropic-route-replay-key-32-bytes" });
    const value = fixture({ replayGuard });
    const app = createAnthropicMessagesRoutes(value.config);
    expect((await app.request(messages())).status).toBe(200);
    const replay = await app.request(messages());
    expect(replay.status).toBe(200);
    expect(replay.headers.get("x-kiln-replay")).toBe("cached");
    expect(value.execute).toHaveBeenCalledOnce();

    let calls = 0;
    const failed = fixture({ replayGuard: new InMemoryModelGatewayReplayGuard({ hmacKey: "anthropic-failed-route-key-32bytes" }), execute: async () => { calls++; throw new Error("provider unavailable"); } });
    const failedApp = createAnthropicMessagesRoutes(failed.config);
    expect((await failedApp.request(messages())).status).toBe(409);
    const retry = await failedApp.request(messages());
    expect(retry.status).toBe(409);
    expect(await retry.text()).toContain("committed_unknown");
    expect(calls).toBe(1);
  });
});
