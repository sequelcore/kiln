import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexOAuthTokenFile, ModelGatewayConfig } from "@kilnai/core";
import { CodexOAuthCredentialPoolService } from "../../src/agents/credential-pool/codex-oauth-credential-pool.js";
import { createAnthropicMessagesRoutes } from "../../src/model-gateway/anthropic-messages-routes.js";
import { createCodexOAuthModelGatewayIngress } from "../../src/model-gateway/codex-oauth-model-gateway-ingress.js";
import { LocalModelGatewayStore } from "../../src/model-gateway/local-model-gateway-store.js";

function token(accountId: string, access = "access"): CodexOAuthTokenFile {
  const payload = Buffer.from(JSON.stringify({
    exp: 4_070_908_800,
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  })).toString("base64url");
  return { access_token: `header.${payload}.${access}`, refresh_token: "refresh", expires_at: "2099-01-01T00:00:00.000Z", client_id: "client" };
}

const config: ModelGatewayConfig = {
  port: 4801,
  accounts: [{ id: "primary", providerId: "codex-oauth", credentialId: "credential-a", maxConcurrency: 2, reservedAffinitySlots: 1 }],
  replay: { ttlMs: 60_000, maxEntries: 100, hmacKeyEnv: "REPLAY_SECRET" },
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 2 } },
  principals: [
      { tokenEnv: "BEARER_TOKEN", ingress: "openai-responses", tenantId: "tenant:a", applicationId: "app", callerId: "caller-a", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget-a", virtualModelIds: ["codex"] },
      { tokenEnv: "BEARER_TOKEN_2", ingress: "openai-responses", tenantId: "tenant", applicationId: "a:app", callerId: "caller-a", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget-b", virtualModelIds: ["codex"] },
  ],
  virtualModels: [
      { id: "codex", displayName: "Codex", contextTokens: 1000, outputTokens: 100, providerId: "codex-oauth", providerModelId: "gpt-test", accountIds: ["primary"], capabilities: ["text"], affinity: { continuity: "prefer", scope: "session" } },
      { id: "not-allowed", displayName: "Other", contextTokens: 1000, outputTokens: 100, providerId: "codex-oauth", providerModelId: "gpt-other", accountIds: ["primary"], capabilities: ["text"], affinity: { continuity: "none" } },
  ],
};

describe("createCodexOAuthModelGatewayIngress", () => {
  let root: string | undefined;
  afterEach(async () => { vi.restoreAllMocks(); if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

  it("composes Responses and Anthropic over one authority while keeping protocol ACL and namespaces distinct", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-shared-model-ingress-"));
    const shared: ModelGatewayConfig = {
      ...config,
      surfaces: { ...config.surfaces, anthropicMessages: { maxBodyBytes: 2048, maxConcurrentRequests: 1 } },
      principals: [
        config.principals[0]!,
        { tokenEnv: "ANTHROPIC_TOKEN", ingress: "anthropic-messages", tenantId: "tenant:a", applicationId: "app", callerId: "caller-a", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget-a", virtualModelIds: ["claude-codex"] },
      ],
      virtualModels: [...config.virtualModels, { ...config.virtualModels[0]!, id: "claude-codex", displayName: "Claude Codex" }],
    };
    const handle = await createCodexOAuthModelGatewayIngress({ config: shared, databasePath: ":memory:", credentialRootDir: join(root, "auth"), env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32), ANTHROPIC_TOKEN: "a".repeat(32) } });
    try {
      const responsesPrincipal = (await handle.openAIResponses!.authenticateBearer("b".repeat(32)))!;
      const anthropicPrincipal = (await handle.anthropicMessages!.authenticate("a".repeat(32)))!;
      expect(handle.openAIResponses!.invocationPorts).toBe(handle.anthropicMessages!.invocationPorts);
      await expect(handle.openAIResponses!.resolveVirtualModel({ principal: responsesPrincipal, requestedModel: "claude-codex" })).resolves.toBeUndefined();
      await expect(handle.anthropicMessages!.resolveVirtualModel({ principal: anthropicPrincipal, requestedModel: "codex" })).resolves.toBeUndefined();
      await expect(handle.anthropicMessages!.listVirtualModels({ principal: anthropicPrincipal })).resolves.toEqual([{ id: "claude-codex", displayName: "Claude Codex" }]);
      const responsesCorrelation = await handle.openAIResponses!.namespaceCorrelation({ principal: responsesPrincipal, observed: { sessionId: "same-session", rawBodyDigest: "1".repeat(64) } });
      const anthropicCorrelation = await handle.anthropicMessages!.namespaceCorrelation({ principal: anthropicPrincipal, observed: { sessionId: "same-session", rawBodyDigest: "1".repeat(64), agentId: "agent", parentAgentId: "parent" } });
      const otherAgentCorrelation = await handle.anthropicMessages!.namespaceCorrelation({ principal: anthropicPrincipal, observed: { sessionId: "same-session", rawBodyDigest: "1".repeat(64), agentId: "other-agent", parentAgentId: "parent" } });
      expect(anthropicCorrelation.sessionId).not.toBe(responsesCorrelation.sessionId);
      expect(anthropicCorrelation.turnId).not.toBe(responsesCorrelation.turnId);
      expect(otherAgentCorrelation.sessionId).toBe(anthropicCorrelation.sessionId);
      expect(otherAgentCorrelation.turnId).not.toBe(anthropicCorrelation.turnId);
    } finally { handle.close(); }
    await expect(createCodexOAuthModelGatewayIngress({
      config: shared,
      databasePath: ":memory:",
      credentialRootDir: join(root, "auth"),
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "s".repeat(32), ANTHROPIC_TOKEN: "s".repeat(32) },
    })).rejects.toThrow("globally unique");
  });

  it("fails closed when one ingress declares a duplicate trusted principal identity", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-duplicate-principal-"));
    const duplicateIdentity: ModelGatewayConfig = {
      ...config,
      principals: [
        config.principals[0]!,
        {
          ...config.principals[0]!,
          tokenEnv: "BEARER_TOKEN_2",
          capabilityId: "administer",
          scopes: ["model.admin"],
          budgetEvidenceId: "budget-b",
          virtualModelIds: ["not-allowed"],
        },
      ],
    };

    await expect(createCodexOAuthModelGatewayIngress({
      config: duplicateIdentity,
      databasePath: ":memory:",
      credentialRootDir: join(root, "auth"),
      env: {
        REPLAY_SECRET: "r".repeat(32),
        BEARER_TOKEN: "b".repeat(32),
        BEARER_TOKEN_2: "c".repeat(32),
      },
    })).rejects.toThrow("trusted principal identities must be unique within each ingress");
  });

  it("dispatches a conforming Messages request through the shared Codex authority exactly once", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-anthropic-codex-dispatch-"));
    const credentialRoot = join(root, "auth");
    const pool = new CodexOAuthCredentialPoolService({ rootDir: credentialRoot });
    await pool.linkCredential({ id: "credential-a", tokenFile: token("provider-account") });
    const anthropicConfig: ModelGatewayConfig = {
      ...config,
      surfaces: { anthropicMessages: { maxBodyBytes: 4096, maxConcurrentRequests: 1 } },
      principals: [{ tokenEnv: "ANTHROPIC_TOKEN", ingress: "anthropic-messages", tenantId: "tenant", applicationId: "app", callerId: "claude", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget", virtualModelIds: ["claude-kiln"] }],
      virtualModels: [{ ...config.virtualModels[0]!, id: "claude-kiln", displayName: "Claude Kiln", capabilities: ["text", "reasoning-controls"] }],
    };
    const providerFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "gpt-test", max_output_tokens: 64, reasoning: { effort: "high" } });
      const frame = { type: "response.completed", response: { id: "provider-response", output: [{ type: "message", id: "message-1", role: "assistant", content: [{ type: "output_text", text: "PROBE_OK" }] }], usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } } };
      return new Response(`event: response.completed\ndata: ${JSON.stringify(frame)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    const handle = await createCodexOAuthModelGatewayIngress({ config: anthropicConfig, databasePath: ":memory:", credentialRootDir: credentialRoot, env: { REPLAY_SECRET: "r".repeat(32), ANTHROPIC_TOKEN: "a".repeat(32) }, fetch: providerFetch as typeof fetch });
    try {
      const app = createAnthropicMessagesRoutes(handle.anthropicMessages!);
      const response = await app.request(new Request("http://127.0.0.1/v1/messages?beta=true", {
        method: "POST",
        headers: { authorization: `Bearer ${"a".repeat(32)}`, "anthropic-version": "2023-06-01", "content-type": "application/json", "x-claude-code-session-id": "session-1" },
        body: JSON.stringify({ model: "claude-kiln", max_tokens: 64, stream: true, output_config: { effort: "high" }, messages: [{ role: "user", content: "Return PROBE_OK" }] }),
      }));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("PROBE_OK");
      expect(providerFetch).toHaveBeenCalledOnce();
    } finally { handle.close(); }
  });

  it("composes configured principals, models, and exact credential identities", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-responses-ingress-"));
    const credentialRoot = join(root, "auth");
    const pool = new CodexOAuthCredentialPoolService({ rootDir: credentialRoot });
    await pool.linkCredential({ id: "credential-a", tokenFile: token("provider-account") });
    const handle = await createCodexOAuthModelGatewayIngress({
      config,
      databasePath: join(root, "state", "gateway.sqlite"),
      credentialRootDir: credentialRoot,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32), BEARER_TOKEN_2: "c".repeat(32) },
    });

    try {
      const principal = await handle.openAIResponses!.authenticateBearer("b".repeat(32));
      expect(principal).toMatchObject({ tenantId: "tenant:a", applicationId: "app" });
      await expect(handle.openAIResponses!.authenticateBearer("wrong".repeat(8))).resolves.toBeUndefined();
      const resolved = await handle.openAIResponses!.resolveVirtualModel({ principal: principal!, requestedModel: "codex" });
      expect(resolved).toMatchObject({ route: { providerId: "codex-oauth", providerModelId: "gpt-test", scope: "virtual:codex" } });
      await expect(handle.openAIResponses!.resolveVirtualModel({ principal: principal!, requestedModel: "not-allowed" })).resolves.toBeUndefined();

      const identity = { tenantId: "tenant:a", applicationId: "app", callerId: "caller-a", sessionId: "session-a", turnId: "turn-a" };
      const authority = { status: "admitted" as const, capabilityId: "invoke", scopes: ["model.invoke"] };
      const budget = { status: "admitted" as const, evidenceId: "budget-a" };
      const [first] = await handle.openAIResponses!.invocationPorts.candidateCatalog.list({ identity, route: resolved!.route, authority, budget });
      expect(first?.account).toMatch(/^configured:primary:[a-f0-9]{64}$/);
      expect(String(first?.account)).not.toContain("provider-account");
      const lease = await handle.openAIResponses!.invocationPorts.accountLease.acquire({ identity, route: resolved!.route, account: first!.account, purpose: "new" });

      await pool.linkCredential({ id: "credential-a", tokenFile: token("provider-account", "rotated") });
      const [rotated] = await handle.openAIResponses!.invocationPorts.candidateCatalog.list({ identity, route: resolved!.route, authority, budget });
      expect(rotated?.account).not.toBe(first?.account);
      await expect(handle.openAIResponses!.invocationPorts.dispatcherResolver.resolve({ identity, route: resolved!.route, account: first!.account, leaseId: lease!.leaseId })).rejects.toThrow("unavailable");

      const namespaced = await handle.openAIResponses!.namespaceCorrelation({ principal: principal!, observed: { sessionId: "external-session", turnId: "external-turn", rawBodyDigest: "a".repeat(64) } });
      const collidingPrincipal = await handle.openAIResponses!.authenticateBearer("c".repeat(32));
      const separatelyNamespaced = await handle.openAIResponses!.namespaceCorrelation({ principal: collidingPrincipal!, observed: { sessionId: "external-session", turnId: "external-turn", rawBodyDigest: "a".repeat(64) } });
      expect(namespaced.sessionId).toMatch(/^ns:[a-f0-9]{64}$/);
      expect(namespaced.sessionId).not.toContain("external-session");
      expect(separatelyNamespaced.sessionId).not.toBe(namespaced.sessionId);
      const retry = await handle.openAIResponses!.namespaceCorrelation({ principal: principal!, observed: { sessionId: "external-session", rawBodyDigest: "1".repeat(64) } });
      const sameRetry = await handle.openAIResponses!.namespaceCorrelation({ principal: principal!, observed: { sessionId: "external-session", rawBodyDigest: "1".repeat(64) } });
      const nextBody = await handle.openAIResponses!.namespaceCorrelation({ principal: principal!, observed: { sessionId: "external-session", rawBodyDigest: "2".repeat(64) } });
      expect(sameRetry.turnId).toBe(retry.turnId);
      expect(nextBody.turnId).not.toBe(retry.turnId);
      const threadOnly = await handle.openAIResponses!.namespaceCorrelation({ principal: principal!, observed: { threadId: "stable-thread", rawBodyDigest: "1".repeat(64) } });
      const threadNextBody = await handle.openAIResponses!.namespaceCorrelation({ principal: principal!, observed: { threadId: "stable-thread", rawBodyDigest: "2".repeat(64) } });
      expect(threadNextBody.sessionId).toBe(threadOnly.sessionId);
      expect(threadNextBody.turnId).not.toBe(threadOnly.turnId);
    } finally {
      handle.close();
    }
  });

  it("fails closed when configured secret material is missing or too short", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-responses-ingress-secret-"));
    await expect(createCodexOAuthModelGatewayIngress({ config, databasePath: join(root, "db.sqlite"), env: { REPLAY_SECRET: "short", BEARER_TOKEN: "b".repeat(32), BEARER_TOKEN_2: "c".repeat(32) } })).rejects.toThrow("at least 32 bytes");
  });

  it.each([403, 429, 503])("feeds provider status %i into credential health without retrying", async (status) => {
    root = await mkdtemp(join(tmpdir(), `kiln-responses-health-${status}-`));
    const credentialRoot = join(root, "auth");
    const pool = new CodexOAuthCredentialPoolService({ rootDir: credentialRoot });
    await pool.linkCredential({ id: "credential-a", tokenFile: token("provider-account") });
    const feedbackOrder: string[] = [];
    if (status === 429) {
      const coolRoute = LocalModelGatewayStore.prototype.coolRoute;
      vi.spyOn(LocalModelGatewayStore.prototype, "coolRoute").mockImplementation(function (...args) { feedbackOrder.push("route-circuit"); return coolRoute.apply(this, args); });
      vi.spyOn(CodexOAuthCredentialPoolService.prototype, "recordProviderOutcome").mockImplementation(async () => { feedbackOrder.push("credential-health"); throw new Error("health unavailable"); });
    }
    let providerCalls = 0;
    const handle = await createCodexOAuthModelGatewayIngress({
      config, databasePath: join(root, "gateway.sqlite"), credentialRootDir: credentialRoot,
      env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32), BEARER_TOKEN_2: "c".repeat(32) },
      fetch: async () => { providerCalls += 1; return new Response("upstream failed", { status }); },
    });
    try {
      const principal = (await handle.openAIResponses!.authenticateBearer("b".repeat(32)))!;
      const resolved = (await handle.openAIResponses!.resolveVirtualModel({ principal, requestedModel: "codex" }))!;
      const identity = { tenantId: principal.tenantId, applicationId: principal.applicationId, callerId: principal.callerId, sessionId: "session", turnId: "turn" };
      const authority = { status: "admitted" as const, capabilityId: principal.capabilityId, scopes: principal.scopes };
      const budget = principal.budgetEvidence;
      const [candidate] = await handle.openAIResponses!.invocationPorts.candidateCatalog.list({ identity, route: resolved.route, authority, budget });
      const lease = await handle.openAIResponses!.invocationPorts.accountLease.acquire({ identity, route: resolved.route, account: candidate!.account, purpose: "new" });
      const dispatcher = await handle.openAIResponses!.invocationPorts.dispatcherResolver.resolve({ identity, route: resolved.route, account: candidate!.account, leaseId: lease!.leaseId });
      await expect(dispatcher.dispatchOneRound({ account: candidate!.account, route: resolved.route, sessionId: "session", turn: { history: [{ role: "user", parts: [{ type: "text", text: "hello" }] }] } })).rejects.toMatchObject({ status });
      expect(providerCalls).toBe(1);
      if (status === 429) expect(feedbackOrder).toEqual(["route-circuit", "credential-health"]);
      const afterFailure = await handle.openAIResponses!.invocationPorts.candidateCatalog.list({ identity, route: resolved.route, authority, budget });
      expect(afterFailure).toEqual([]);
    } finally { handle.close(); }
  });

  it("does not mask committed provider success when health persistence fails", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-responses-health-success-"));
    const credentialRoot = join(root, "auth");
    const pool = new CodexOAuthCredentialPoolService({ rootDir: credentialRoot });
    await pool.linkCredential({ id: "credential-a", tokenFile: token("provider-account") });
    vi.spyOn(CodexOAuthCredentialPoolService.prototype, "recordProviderOutcome").mockRejectedValue(new Error("health unavailable"));
    const frame = { type: "response.completed", response: { id: "provider-response", output: [{ type: "message", id: "message-1", role: "assistant", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } };
    const handle = await createCodexOAuthModelGatewayIngress({ config, databasePath: join(root, "gateway.sqlite"), credentialRootDir: credentialRoot, env: { REPLAY_SECRET: "r".repeat(32), BEARER_TOKEN: "b".repeat(32), BEARER_TOKEN_2: "c".repeat(32) }, fetch: async () => new Response(`event: response.completed\ndata: ${JSON.stringify(frame)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } }) });
    try {
      const principal = (await handle.openAIResponses!.authenticateBearer("b".repeat(32)))!;
      const resolved = (await handle.openAIResponses!.resolveVirtualModel({ principal, requestedModel: "codex" }))!;
      const identity = { tenantId: principal.tenantId, applicationId: principal.applicationId, callerId: principal.callerId, sessionId: "session", turnId: "turn" };
      const authority = { status: "admitted" as const, capabilityId: principal.capabilityId, scopes: principal.scopes };
      const [candidate] = await handle.openAIResponses!.invocationPorts.candidateCatalog.list({ identity, route: resolved.route, authority, budget: principal.budgetEvidence });
      const lease = await handle.openAIResponses!.invocationPorts.accountLease.acquire({ identity, route: resolved.route, account: candidate!.account, purpose: "new" });
      const dispatcher = await handle.openAIResponses!.invocationPorts.dispatcherResolver.resolve({ identity, route: resolved.route, account: candidate!.account, leaseId: lease!.leaseId });
      await expect(dispatcher.dispatchOneRound({ account: candidate!.account, route: resolved.route, sessionId: "session", turn: { history: [{ role: "user", parts: [{ type: "text", text: "hello" }] }] } })).resolves.toMatchObject({ parts: [{ type: "text", text: "ok" }] });
    } finally { handle.close(); }
  });
});
