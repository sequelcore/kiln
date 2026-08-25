import { describe, expect, it, vi } from "vitest";
import { textParts } from "@kilnai/core/engine";
import { processAdmittedTurn } from "../../src/gateway/message-pipeline/process-admitted-turn.js";
import { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import type { RuntimeSessionOrchestrator, OrchestrateResult } from "../../src/session/runtime-session-orchestrator.js";
import type { RuntimeConfigurationRevisionSnapshot } from "../../src/session/runtime-configuration-revision-pin.js";
import type { AdmittedTurnContext } from "../../src/gateway/message-pipeline/process-admitted-turn.js";

function makeContext(
  orchestrator: RuntimeSessionOrchestrator,
  sessionRegistry: SessionRegistry,
  provider: NonNullable<AdmittedTurnContext["runtimeConfigurationRevisionProvider"]>,
  options: {
    readonly sessionId?: string;
    readonly turnOrdinal?: number;
    readonly revision?: RuntimeConfigurationRevisionSnapshot;
  } = {},
): AdmittedTurnContext {
  const sessionId = options.sessionId ?? "revision-test-session";
  const turnId = `${sessionId}:turn:${options.turnOrdinal ?? 1}`;
  const revision = options.revision ?? { revisionSetId: "R1", revisions: { route: "route-R1" } };
  const authorityAdmission = defineEffectiveAuthorityAdmissionBundle({
    sessionId,
    turnId,
    admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "revision-test", revision: "1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "read_only", reason: "Revision pipeline fixture", subjectId: sessionId },
    },
    turn: {
      authority: {
        executionMode: "execute",
        requestedAuthority: "read_only",
        admittedAuthority: "read_only",
        sourcePolicy: "runtime_surface_projection",
        reason: "Revision pipeline fixture",
        completeness: "authoritative",
        toolCount: 0,
        deniedToolCount: 0,
        sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: [], deniedToolNames: [] },
      effectCeiling: {
        operation: "observe",
        boundaries: [],
        reversibility: "reversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: [],
        idempotency: "idempotent",
      },
      budget: { status: "not-configured" },
      execution: { status: "not-routed" },
    },
  });
  return {
    orchestrator,
    sessionRegistry,
    appName: "revision-test",
    tenantId: "tenant",
    userId: "operator",
    channel: "test",
    userParts: textParts("hello"),
    sessionId,
    runtimeConfigurationRevisionProvider: provider,
    authorityAdmission,
    perCallConfig: { authorityAdmission, turnCorrelationId: turnId },
  };
}

describe("admitted-turn configuration revision", () => {
  it("publishes live lifecycle only while the Runtime-owned turn is executing", async () => {
    const sessionRegistry = new SessionRegistry();
    const observedStates: string[] = [];
    const processMessage = vi.fn(async () => {
      observedStates.push((await sessionRegistry.getById("lifecycle-session"))!.observeLiveLifecycle().state);
      return {
        parts: textParts("done"), inputTokens: 1, outputTokens: 1,
        cacheReadTokens: 0, cacheWriteTokens: 0, queued: false, outcome: "completed" as const,
      };
    });
    const orchestrator = { processMessage, model: "fixture" } as unknown as RuntimeSessionOrchestrator;

    await processAdmittedTurn(makeContext(orchestrator, sessionRegistry, () => ({
      revisionSetId: "R1",
      revisions: { route: "route-R1" },
    }), { sessionId: "lifecycle-session" }));

    expect(observedStates).toEqual(["running"]);
    expect((await sessionRegistry.getById("lifecycle-session"))!.observeLiveLifecycle()).toMatchObject({
      state: "idle",
      revision: 2,
    });
  });

  it("uses the revision captured with route admission and never rereads the live provider", async () => {
    const processMessage = vi.fn().mockResolvedValue({
      parts: textParts("done"), inputTokens: 1, outputTokens: 1,
      cacheReadTokens: 0, cacheWriteTokens: 0, queued: false, outcome: "completed",
    } satisfies OrchestrateResult);
    const orchestrator = { processMessage, model: "fixture" } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = new SessionRegistry();
    const provider = vi.fn(() => ({ revisionSetId: "R2", revisions: { route: "route-R2" } }));

    await processAdmittedTurn(makeContext(orchestrator, sessionRegistry, provider));

    expect(provider).not.toHaveBeenCalled();
    expect(processMessage.mock.calls[0]?.[4]).toMatchObject({
      authorityAdmission: expect.objectContaining({
        configuration: expect.objectContaining({
          turnRevision: expect.objectContaining({ revisionSetId: "R1" }),
        }),
      }),
    });
  });

  it("keeps a blocked R1 turn pinned while the next turn binds R2", async () => {
    let current: RuntimeConfigurationRevisionSnapshot = {
      revisionSetId: "R1",
      revisions: { route: "route-R1" },
    };
    const provider = vi.fn(async (): Promise<RuntimeConfigurationRevisionSnapshot> => current);
    const processMessage = vi.fn().mockResolvedValue({
      parts: textParts("done"),
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
      outcome: "completed",
    } satisfies OrchestrateResult);
    const orchestrator = { processMessage, model: "fixture" } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = new SessionRegistry();

    await processAdmittedTurn(makeContext(orchestrator, sessionRegistry, provider, {
      revision: current,
      turnOrdinal: 1,
    }));
    current = { revisionSetId: "R2", revisions: { route: "route-R2" } };
    await processAdmittedTurn(makeContext(orchestrator, sessionRegistry, provider, {
      revision: current,
      turnOrdinal: 2,
    }));

    expect(provider).not.toHaveBeenCalled();
    expect(processMessage).toHaveBeenCalledTimes(2);
    expect(processMessage.mock.calls[0]?.[4]).toMatchObject({
      authorityAdmission: expect.objectContaining({
        configuration: expect.objectContaining({
          turnRevision: expect.objectContaining({ revisionSetId: "R1", revisions: { route: "route-R1" } }),
        }),
      }),
    });
    expect(processMessage.mock.calls[1]?.[4]).toMatchObject({
      authorityAdmission: expect.objectContaining({
        configuration: expect.objectContaining({
          turnRevision: expect.objectContaining({ revisionSetId: "R2", revisions: { route: "route-R2" } }),
        }),
      }),
    });
  });

  it("binds a fresh logical session to the revision current at its boundary", async () => {
    const processMessage = vi.fn().mockResolvedValue({
      parts: textParts("done"),
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      queued: false,
      outcome: "completed",
    } satisfies OrchestrateResult);
    const orchestrator = { processMessage, model: "fixture" } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = new SessionRegistry();

    await processAdmittedTurn(makeContext(orchestrator, sessionRegistry, () => ({ revisionSetId: "R2", revisions: { route: "route-R2" } }), {
      sessionId: "new-session",
      revision: { revisionSetId: "R2", revisions: { route: "route-R2" } },
    }));

    expect(processMessage.mock.calls[0]?.[4]).toMatchObject({
      authorityAdmission: expect.objectContaining({
        configuration: expect.objectContaining({
          turnRevision: expect.objectContaining({ revisionSetId: "R2" }),
        }),
      }),
    });
  });
});
