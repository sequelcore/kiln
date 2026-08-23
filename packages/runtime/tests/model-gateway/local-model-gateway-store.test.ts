import { describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import { LocalModelGatewayStore } from "../../src/model-gateway/local-model-gateway-store.js";

const revision = {
  revisionSetId: "model-gateway-test",
  revisions: { modelGateway: ("sha256:" + "a".repeat(64)) as `sha256:${string}` },
};

function bundle(sessionId = "session", turnId = "turn") {
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId,
    turnId,
    admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "model-gateway", revision: ("sha256:" + "b".repeat(64)) as `sha256:${string}`, skillIds: [] },
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
        callerOwnedToolContract: { names: ["files:read"], digest: ("sha256:" + "c".repeat(64)) as `sha256:${string}` },
      },
      effectCeiling: { operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: [], idempotency: "idempotent" },
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        route: { routeId: "route", providerId: "provider", providerModelId: "model", accountSelection: { mode: "exact", accountId: "account", source: "route" } },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: { status: "bound", routeId: "route", accountId: "account", credentialId: "credential", credentialRevision: "d".repeat(64) },
      },
    },
  });
}

describe("LocalModelGatewayStore", () => {
  it("allocates an attempt, persists and reads back the bundle, then claims one dispatch effect", () => {
    const store = new LocalModelGatewayStore({ path: ":memory:", replaySecret: "r".repeat(32), replayTtlMs: 60_000, replayMaxEntries: 5 });
    const key = store.fingerprint({ ingress: "openai-responses", rawBody: "{\"new\":true}", tenantId: "tenant", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "turn", route: { providerId: "provider", providerModelId: "model", scope: "scope" }, toolExecutionMode: "caller-owned" });
    const claim = store.claim(key);
    expect(claim).toMatchObject({ kind: "dispatch", attemptId: expect.stringMatching(/^attempt-/) });
    if (claim.kind !== "dispatch") throw new Error("fixture claim was not dispatchable");
    const admitted = bundle();
    const receipt = (store as unknown as { persistAdmission: (key: string, fence: string, bundle: typeof admitted) => { attemptId: string; admissionId: string; bundle: typeof admitted } }).persistAdmission(claim.key, claim.fence, admitted);
    expect(receipt).toMatchObject({ attemptId: claim.attemptId, admissionId: admitted.admissionId, bundle: admitted });
    const permit = (store as unknown as { claimAction: (key: string, fence: string, input: { admissionId: string; effectIdentity: string }) => { consume(): void } }).claimAction(claim.key, claim.fence, { admissionId: admitted.admissionId, effectIdentity: "model-round:provider/model/account" });
    permit.consume();
    expect(() => permit.consume()).toThrow("already been consumed");
    expect(store.claim(key)).toEqual({ kind: "committed-unknown" });
    store.close();
  });

  it("atomically binds the session facet, persists the bundle, and claims one action", () => {
    const store = new LocalModelGatewayStore({ path: ":memory:", replaySecret: "r".repeat(32), replayTtlMs: 60_000, replayMaxEntries: 5 });
    const key = store.fingerprint({ ingress: "openai-responses", rawBody: "{}", tenantId: "tenant", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "turn", route: { providerId: "provider", providerModelId: "model", scope: "scope" }, toolExecutionMode: "caller-owned" });
    const claim = store.claim(key);
    expect(claim.kind).toBe("dispatch");
    if (claim.kind !== "dispatch") throw new Error("fixture claim was not dispatchable");
    const admitted = bundle();
    const receipt = store.persistAdmission(claim.key, claim.fence, admitted);
    expect(receipt).toMatchObject({ attemptId: claim.attemptId, admissionId: admitted.admissionId });
    store.claimAction(claim.key, claim.fence, { admissionId: admitted.admissionId, effectIdentity: "model-round:provider/model/account" });
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
      const admitted = bundle();
      store.persistAdmission(dispatch.key, dispatch.fence, admitted);
      store.claimAction(dispatch.key, dispatch.fence, { admissionId: admitted.admissionId, effectIdentity: "model-round:provider/model/account" });
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

  it("retains terminal tombstones without exhausting pre-action capacity", () => {
    const store = new LocalModelGatewayStore({
      path: ":memory:",
      replaySecret: "r".repeat(32),
      replayTtlMs: 60_000,
      replayMaxEntries: 1,
    });
    const fingerprint = (rawBody: string) => store.fingerprint({
      ingress: "openai-responses",
      rawBody,
      tenantId: "tenant",
      applicationId: "app",
      callerId: "caller",
      sessionId: "session",
      turnId: `turn-${rawBody}`,
      route: { providerId: "provider", providerModelId: "model", scope: "scope" },
      toolExecutionMode: "caller-owned",
    });
    const firstKey = fingerprint("first");
    const first = store.claim(firstKey);
    if (first.kind !== "dispatch") throw new Error("Expected the first dispatch claim.");
    const admitted = bundle("session", "turn-first");
    const receipt = store.persistAdmission(first.key, first.fence, admitted);
    store.claimAction(first.key, first.fence, {
      admissionId: receipt.admissionId,
      effectIdentity: "model-round:first",
    }).consume();
    store.settleUnknown(first.key, first.fence);

    expect(store.claim(fingerprint("second")).kind).toBe("dispatch");
    expect(store.claim(firstKey)).toEqual({ kind: "committed-unknown" });
    store.close();
  });

  it("rejects an obsolete replay schema without manufacturing current action claims", async () => {
    const path = join(tmpdir(), `kiln-model-gateway-migration-${crypto.randomUUID()}.sqlite`);
    const obsoleteDb = new Database(path, { create: true, strict: true });
    obsoleteDb.exec("CREATE TABLE replay (fingerprint TEXT PRIMARY KEY, status TEXT NOT NULL, fence TEXT NOT NULL, expires_at INTEGER, ciphertext BLOB, nonce BLOB, tag BLOB, authority_bundle_json TEXT); CREATE TABLE authority_session_facets (session_id TEXT PRIMARY KEY, facet_json TEXT NOT NULL);");
    obsoleteDb.query("INSERT INTO replay(fingerprint,status,fence,expires_at) VALUES(?,?,?,?)").run("obsolete-committed", "committed", "f-committed", null);
    obsoleteDb.query("INSERT INTO replay(fingerprint,status,fence,expires_at) VALUES(?,?,?,?)").run("obsolete-completed", "completed", "f-completed", null);
    obsoleteDb.query("INSERT INTO replay(fingerprint,status,fence,expires_at) VALUES(?,?,?,?)").run("obsolete-claimed", "claimed", "f-claimed", Date.now() + 60_000);
    obsoleteDb.query("INSERT INTO authority_session_facets(session_id,facet_json) VALUES(?,?)").run("retained-session", "retained-facet");
    obsoleteDb.close();

    expect(() => new LocalModelGatewayStore({
      path,
      replaySecret: "migration-test-secret-with-32-bytes",
      replayTtlMs: 1_000,
      replayMaxEntries: 10,
    })).toThrow("replay schema predates canonical action claims");

    const retainedDb = new Database(path, { readonly: true, strict: true });
    expect(retainedDb.query<{ count: number }, []>("SELECT COUNT(*) count FROM replay").get()?.count).toBe(3);
    expect(retainedDb.query<{ count: number }, []>("SELECT COUNT(*) count FROM authority_session_facets WHERE session_id='retained-session'").get()?.count).toBe(1);
    retainedDb.close();
    await rm(path, { force: true });
  });

  it("expires an admitted pre-action claim without deleting its authority facet", () => {
    let now = 100;
    const store = new LocalModelGatewayStore({ path: ":memory:", replaySecret: "admitted-expiry-test-secret-with-32-bytes", replayTtlMs: 1_000, replayMaxEntries: 10, now: () => now });
    const key = store.fingerprint({ ingress: "openai-responses", rawBody: "admitted", tenantId: "tenant", applicationId: "app", callerId: "caller", sessionId: "session", turnId: "turn", route: { providerId: "provider", providerModelId: "model", scope: "scope" }, toolExecutionMode: "caller-owned" });
    const claim = store.claim(key);
    if (claim.kind !== "dispatch") throw new Error("Expected a dispatch claim.");
    store.persistAdmission(claim.key, claim.fence, bundle());
    now = 1_101;
    expect(store.claim(key).kind).toBe("dispatch");
    expect(store.loadSessionFacet("session")).toBeDefined();
    store.close();
  });
});
