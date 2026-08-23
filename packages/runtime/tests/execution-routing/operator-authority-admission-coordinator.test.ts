import type { ActionEffectEnvelope } from "@kilnai/core/engine";
import { describe, expect, it, vi } from "vitest";
import { OperatorAuthorityAdmissionCoordinator } from "../../src/execution-routing/operator-authority-admission-coordinator.js";
import type {
  OperatorSessionAuthorityAdmissionFacets,
  OperatorSessionExecutionRequest,
} from "../../src/execution-routing/operator-session-execution-routing-service.js";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import { defineRuntimeSessionAuthorityFacet } from "../../src/session/runtime-session-authority-facet.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

const REVISION = { revisionSetId: "R1", revisions: { project: "p1" } } as const;
const READ_EFFECT: ActionEffectEnvelope = {
  operation: "observe", boundaries: ["workspace"], reversibility: "reversible",
  dataEgress: "none", identityUse: "none", consequences: ["local-state"], idempotency: "idempotent",
};

function request(executionId = "turn-1"): OperatorSessionExecutionRequest<{ readonly text: string }> {
  return { executionId, intentFingerprint: `sha256:${"a".repeat(64)}`, intent: { routeId: "route-1" }, payload: { text: "hello" } };
}

function facets(sessionId: string, turnId = "turn-1"): OperatorSessionAuthorityAdmissionFacets {
  return {
    sessionId,
    turnId,
    sessionRevision: REVISION,
    session: {
      skillCatalog: { catalogId: "operator", revision: "skills-r1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "read_only", reason: "session policy", subjectId: sessionId },
    },
    turn: {
      authority: {
        executionMode: "execute", requestedAuthority: "read_only", admittedAuthority: "fail_closed",
        sourcePolicy: "runtime_surface_projection", reason: "no tools", completeness: "authoritative",
        toolCount: 0, deniedToolCount: 0, sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: [], deniedToolNames: [] },
      effectCeiling: READ_EFFECT,
    },
  };
}

function bundle(
  sessionId: string,
  budget: { readonly status: "not-configured" } = { status: "not-configured" },
  turnId = "turn-1",
) {
  const owner = facets(sessionId, turnId);
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId,
    turnId,
    admittedAt: "2026-08-22T18:00:00.000Z",
    configuration: { sessionRevision: REVISION, turnRevision: REVISION },
    session: owner.session,
    turn: { ...owner.turn, budget, execution: { status: "not-routed" } },
  });
}

function prepareInput(turnRequest: ReturnType<typeof request>) {
  return {
    request: turnRequest,
    admission: {
      routeId: "route-1",
      providerId: "provider",
      providerModelId: "model",
      accountSelection: { mode: "exact", accountId: "account", source: "route" },
    },
    snapshot: { catalog: {} as never, configurationRevision: REVISION },
    binding: { status: "bound", routeId: "route-1", accountId: "account", credentialId: "cred", credentialRevision: "c1" },
    dataPolicy: {} as never,
  } as const;
}

describe("OperatorAuthorityAdmissionCoordinator", () => {
  it("persists the session facet and full bundle before one-shot consumption", async () => {
    const session = new RuntimeSession({ appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1" });
    const saved: string[] = [];
    const persisted: string[] = [];
    const coordinator = new OperatorAuthorityAdmissionCoordinator({
      resolveSession: () => ({ session, allowAuthorityFacetCreation: true }),
      prepare: () => ({ facets: facets(session.id), prepared: { dispatch: "ready" } }),
      saveSession: (value) => { saved.push(value.runtimeSessionAuthorityFacet!.facetId); },
      evidenceStore: { persist: (value) => { persisted.push(value.admissionId); }, loadSessionFacet: () => undefined },
    });
    const turnRequest = request();
    await expect(coordinator.preflight({ request: turnRequest })).resolves.toEqual({ status: "not-configured" });
    await coordinator.prepare(prepareInput(turnRequest));
    const admitted = bundle(session.id);
    await coordinator.persist(admitted);
    expect(saved).toHaveLength(1);
    expect(persisted).toEqual([admitted.admissionId]);
    expect(coordinator.consume("turn-1", admitted)).toEqual({ dispatch: "ready" });
    expect(() => coordinator.consume("turn-1", admitted)).toThrow(/not persisted/iu);
  });

  it("joins the routing execution reservation to its distinct canonical Runtime turn", async () => {
    const session = new RuntimeSession({ appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1" });
    const coordinator = new OperatorAuthorityAdmissionCoordinator({
      resolveSession: () => ({ session, allowAuthorityFacetCreation: true }),
      prepare: () => ({ facets: facets(session.id, "canonical-turn-1"), prepared: "ready" }),
      saveSession: () => undefined,
      evidenceStore: { persist: () => undefined, loadSessionFacet: () => undefined },
    });
    const turnRequest = request("routing-execution-1");
    await coordinator.preflight({ request: turnRequest });
    await coordinator.prepare(prepareInput(turnRequest));
    const admitted = bundle(session.id, { status: "not-configured" }, "canonical-turn-1");
    await coordinator.persist(admitted);

    expect(coordinator.consume(turnRequest.executionId, admitted)).toBe("ready");
  });

  it("admits configured session budget exactly once and rejects duplicate execution ids", async () => {
    const session = new RuntimeSession({ appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1" });
    const admit = vi.fn(async () => ({ status: "admitted" as const, reason: "observed-below-limit" as const, observation: { observedTokens: 2, source: "transcript" } }));
    const coordinator = new OperatorAuthorityAdmissionCoordinator({
      resolveSession: () => ({ session, allowAuthorityFacetCreation: true }), sessionTurnBudget: { admit },
      prepare: () => ({ facets: facets(session.id), prepared: true }), saveSession: () => undefined,
      evidenceStore: { persist: () => undefined, loadSessionFacet: () => undefined },
    });
    const turnRequest = request();
    await coordinator.preflight({ request: turnRequest });
    await expect(coordinator.preflight({ request: turnRequest })).rejects.toThrow(/already reserved/iu);
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it("cleans denied budget and explicit abort reservations for safe retry", async () => {
    const session = new RuntimeSession({ appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1" });
    let denied = true;
    const coordinator = new OperatorAuthorityAdmissionCoordinator({
      resolveSession: () => ({ session, allowAuthorityFacetCreation: true }),
      sessionTurnBudget: { admit: async () => denied
        ? { status: "denied", reason: "usage-unknown", action: "stop", message: "unknown" }
        : { status: "admitted", reason: "observed-below-limit", observation: { observedTokens: 1, source: "transcript" } },
      },
      prepare: () => ({ facets: facets(session.id), prepared: true }), saveSession: () => undefined,
      evidenceStore: { persist: () => undefined, loadSessionFacet: () => undefined },
    });
    const turnRequest = request();
    await expect(coordinator.preflight({ request: turnRequest })).rejects.toThrow(/budget denied/iu);
    denied = false;
    await expect(coordinator.preflight({ request: turnRequest })).resolves.toMatchObject({ status: "admitted" });
    coordinator.abort("turn-1");
    await expect(coordinator.preflight({ request: turnRequest })).resolves.toMatchObject({ status: "admitted" });
  });

  it("fails closed for a history-bearing legacy session", async () => {
    const session = new RuntimeSession({ appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1" });
    session.addUserMessage([{ type: "text", text: "legacy" }]);
    const discardPrepared = vi.fn(async () => undefined);
    const coordinator = new OperatorAuthorityAdmissionCoordinator({
      resolveSession: () => ({ session, allowAuthorityFacetCreation: true }),
      prepare: () => ({ facets: facets(session.id), prepared: true }), saveSession: () => undefined,
      evidenceStore: { persist: () => undefined, loadSessionFacet: () => undefined },
      discardPrepared,
    });
    const turnRequest = request();
    await coordinator.preflight({ request: turnRequest });
    await expect(coordinator.prepare(prepareInput(turnRequest))).rejects.toThrow(/legacy|history-bearing/iu);
    expect(discardPrepared).toHaveBeenCalledWith(true);
  });

  it("adopts an empty non-authority session but rejects a revision-only legacy session", async () => {
    const empty = new RuntimeSession({ appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1" });
    const createCoordinator = (session: RuntimeSession) => new OperatorAuthorityAdmissionCoordinator({
      resolveSession: () => ({ session, allowAuthorityFacetCreation: false }),
      prepare: () => ({ facets: facets(session.id), prepared: true }), saveSession: () => undefined,
      evidenceStore: { persist: () => undefined, loadSessionFacet: () => undefined },
    });
    const emptyCoordinator = createCoordinator(empty);
    const emptyRequest = request();
    await emptyCoordinator.preflight({ request: emptyRequest });
    await expect(emptyCoordinator.prepare(prepareInput(emptyRequest))).resolves.toMatchObject({ sessionId: empty.id });

    const revisionOnly = new RuntimeSession({ appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1" });
    revisionOnly.bindRuntimeConfigurationRevision(REVISION);
    const legacyCoordinator = createCoordinator(revisionOnly);
    const legacyRequest = request();
    await legacyCoordinator.preflight({ request: legacyRequest });
    await expect(legacyCoordinator.prepare(prepareInput(legacyRequest))).rejects.toThrow(/legacy|authority source/iu);
  });

  it("does not expose dispatch when evidence persistence fails and retries without resaving the facet", async () => {
    const session = new RuntimeSession({ appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1" });
    const saveSession = vi.fn(async () => undefined);
    let fail = true;
    const coordinator = new OperatorAuthorityAdmissionCoordinator({
      resolveSession: () => ({ session, allowAuthorityFacetCreation: true }),
      prepare: () => ({ facets: facets(session.id), prepared: "ready" }), saveSession,
      evidenceStore: { persist: async () => { if (fail) throw new Error("disk unavailable"); }, loadSessionFacet: () => undefined },
    });
    const turnRequest = request();
    await coordinator.preflight({ request: turnRequest });
    await coordinator.prepare(prepareInput(turnRequest));
    const admitted = bundle(session.id);
    await expect(coordinator.persist(admitted)).rejects.toThrow(/disk unavailable/iu);
    expect(() => coordinator.consume("turn-1", admitted)).toThrow(/not persisted/iu);
    fail = false;
    await coordinator.persist(admitted);
    expect(saveSession).toHaveBeenCalledTimes(1);
    expect(coordinator.consume("turn-1", admitted)).toBe("ready");
  });

  it("rehydrates the persisted session facet before budget and preparation", async () => {
    const session = new RuntimeSession({ appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1" });
    const persistedBundle = bundle(session.id);
    const admit = vi.fn(async () => ({ status: "admitted" as const, reason: "observed-below-limit" as const, observation: { observedTokens: 1, source: "transcript" } }));
    const coordinator = new OperatorAuthorityAdmissionCoordinator({
      resolveSession: () => ({ session, allowAuthorityFacetCreation: false }), sessionTurnBudget: { admit },
      prepare: () => ({ facets: facets(session.id), prepared: true }), saveSession: () => undefined,
      evidenceStore: {
        persist: () => undefined,
        loadSessionFacet: () => defineRuntimeSessionAuthorityFacet({
          sessionId: persistedBundle.sessionId,
          sessionRevision: persistedBundle.configuration.sessionRevision,
          ...persistedBundle.session,
        }),
      },
    });
    const turnRequest = request();
    await coordinator.preflight({ request: turnRequest });
    expect(session.runtimeSessionAuthorityFacet).toBeDefined();
    expect(admit).toHaveBeenCalledWith(session.id);
    await expect(coordinator.prepare(prepareInput(turnRequest))).resolves.toMatchObject({ sessionId: session.id });
  });

  it("discards prepared resources when routing aborts before committed consumption", async () => {
    const session = new RuntimeSession({ appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1" });
    const discardPrepared = vi.fn(async () => undefined);
    const coordinator = new OperatorAuthorityAdmissionCoordinator({
      resolveSession: () => ({ session, allowAuthorityFacetCreation: true }),
      prepare: () => ({ facets: facets(session.id), prepared: { resource: "surface" } }),
      discardPrepared,
      saveSession: () => undefined,
      evidenceStore: { persist: () => undefined, loadSessionFacet: () => undefined },
    });
    const turnRequest = request();
    await coordinator.preflight({ request: turnRequest });
    await coordinator.prepare(prepareInput(turnRequest));
    await coordinator.abort(turnRequest.executionId);
    expect(discardPrepared).toHaveBeenCalledWith({ resource: "surface" });
  });
});
