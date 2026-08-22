import { describe, expect, it } from "vitest";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import { LocalModelGatewayStore } from "../../src/model-gateway/local-model-gateway-store.js";

const revision = {
  revisionSetId: "model-gateway-test",
  revisions: { modelGateway: "sha256:" + "a".repeat(64) },
};

function bundle(sessionId = "session", turnId = "turn") {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId,
    turnId,
    admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "model-gateway", revision: "sha256:" + "b".repeat(64), skillIds: [] },
      authorityCeiling: { maximumAuthority: "read_only", reason: "caller-owned model ingress" },
    },
    turn: {
      authority: {
        executionMode: "execute",
        requestedAuthority: "read_only",
        admittedAuthority: "read_only",
        sourcePolicy: "runtime_surface_projection",
        reason: "caller-owned",
        completeness: "authoritative",
        toolCount: 0,
        deniedToolCount: 0,
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: {
        allowedToolPermissions: [],
        deniedToolNames: [],
        callerOwnedToolContract: { names: ["files:read"], digest: "sha256:" + "c".repeat(64) },
      },
      effectCeiling: { operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: [], idempotency: "idempotent" },
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        route: { routeId: "route", providerId: "provider", providerModelId: "model", accountSelection: { mode: "exact", accountId: "account", source: "route" } },
        dataPolicy: { decision: { status: "admitted", freshness: "fresh", reason: "fixture" } },
        binding: { status: "bound", routeId: "route", accountId: "account", credentialId: "credential", credentialRevision: "d".repeat(64) },
      },
    },
  });
}

describe("LocalModelGatewayStore", () => {
  it("atomically binds the session facet, persists the bundle, and commits the replay claim", () => {
    const store = new LocalModelGatewayStore({ path: ":memory:", replaySecret: "r".repeat(32), replayTtlMs: 60_000, replayMaxEntries: 5 });
    const key = store.fingerprint({ ingress: "openai-responses", rawBody: "{}", tenantId: "tenant", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "turn", route: { providerId: "provider", providerModelId: "model", scope: "scope" }, toolExecutionMode: "caller-owned" });
    const claim = store.claim(key);
    expect(claim.kind).toBe("dispatch");
    if (claim.kind !== "dispatch") throw new Error("fixture claim was not dispatchable");
    const admitted = bundle();
    store.commitAdmission(claim.key, claim.fence, admitted);
    expect(store.claim(key)).toEqual({ kind: "committed-unknown" });
    expect(store.loadSessionFacet("session")).toMatchObject({ sessionId: "session", facetId: expect.stringMatching(/^sha256:/) });
    store.complete(claim.key, claim.fence, { responseId: "response", result: { parts: [{ type: "text", text: "ok" }], usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: "completed" } });
    expect(store.claim(key)).toMatchObject({ kind: "replay-completed" });
    store.close();
  });

  it("retains replay completion without owning account capacity", () => {
    const store = new LocalModelGatewayStore({
      path: ":memory:",
      replaySecret: "r".repeat(32),
      replayTtlMs: 60_000,
      replayMaxEntries: 5,
    });
    const key = store.fingerprint({
      ingress: "openai-responses",
      rawBody: "{}",
      tenantId: "tenant",
      applicationId: "app",
      callerId: "caller",
      sessionId: "session",
      turnId: "turn",
      route: {
        providerId: "provider",
        providerModelId: "model",
        scope: "scope",
      },
      toolExecutionMode: "caller-owned",
    });
    const dispatch = store.claim(key);
    expect(dispatch.kind).toBe("dispatch");
    if (dispatch.kind === "dispatch") {
      store.markCommitted(dispatch.key, dispatch.fence);
      store.complete(dispatch.key, dispatch.fence, {
        responseId: "response",
        result: {
          parts: [{ type: "text", text: "ok" }],
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
          stopReason: "completed",
        },
      });
    }
    expect(store.claim(key)).toMatchObject({ kind: "replay-completed" });
    expect("acquire" in store).toBe(false);
    expect("read" in store).toBe(false);
    store.close();
  });
});
