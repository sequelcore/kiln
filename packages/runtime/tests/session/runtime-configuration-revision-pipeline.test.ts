import { describe, expect, it, vi } from "vitest";
import { textParts } from "@kilnai/core/engine";
import { processAdmittedTurn } from "../../src/gateway/message-pipeline/process-admitted-turn.js";
import { SessionRegistry } from "../../src/session/persistence/session-registry.js";
import type { RuntimeSessionOrchestrator, OrchestrateResult } from "../../src/session/runtime-session-orchestrator.js";
import type { RuntimeConfigurationRevisionSnapshot } from "../../src/session/runtime-configuration-revision-pin.js";
import type { AdmittedTurnContext } from "../../src/gateway/message-pipeline/process-admitted-turn.js";

function makeContext(
  orchestrator: RuntimeSessionOrchestrator,
  sessionRegistry: SessionRegistry,
  provider: NonNullable<AdmittedTurnContext["runtimeConfigurationRevisionProvider"]>,
): AdmittedTurnContext {
  return {
    orchestrator,
    sessionRegistry,
    appName: "revision-test",
    tenantId: "tenant",
    userId: "operator",
    channel: "test",
    userParts: textParts("hello"),
    runtimeConfigurationRevisionProvider: provider,
  };
}

describe("admitted-turn configuration revision", () => {
  it("uses the revision captured with route admission and never rereads the live provider", async () => {
    const processMessage = vi.fn().mockResolvedValue({
      parts: textParts("done"), inputTokens: 1, outputTokens: 1,
      cacheReadTokens: 0, cacheWriteTokens: 0, queued: false, outcome: "completed",
    } satisfies OrchestrateResult);
    const orchestrator = { processMessage, model: "fixture" } as unknown as RuntimeSessionOrchestrator;
    const sessionRegistry = new SessionRegistry();
    const provider = vi.fn(() => ({ revisionSetId: "R2", revisions: { route: "route-R2" } }));

    await processAdmittedTurn({
      ...makeContext(orchestrator, sessionRegistry, provider),
      perCallConfig: {
        runtimeConfigurationRevision: { revisionSetId: "R1", revisions: { route: "route-R1" } },
      },
    });

    expect(provider).not.toHaveBeenCalled();
    expect(processMessage.mock.calls[0]?.[4]).toMatchObject({
      runtimeConfigurationRevision: { revisionSetId: "R1" },
      runtimeSessionConfigurationRevision: { revisionSetId: "R1" },
    });
  });

  it("keeps a blocked R1 turn pinned while the next turn binds R2", async () => {
    let current: RuntimeConfigurationRevisionSnapshot = {
      revisionSetId: "R1",
      revisions: { route: "route-R1" },
    };
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let reads = 0;
    const provider = async (): Promise<RuntimeConfigurationRevisionSnapshot> => {
      reads += 1;
      providerStarted();
      const admitted = current;
      await blocked;
      return admitted;
    };
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

    const firstTurn = processAdmittedTurn(makeContext(orchestrator, sessionRegistry, provider));
    await started;
    current = { revisionSetId: "R2", revisions: { route: "route-R2" } };
    release();
    await firstTurn;
    await processAdmittedTurn(makeContext(orchestrator, sessionRegistry, () => current));

    expect(reads).toBe(1);
    expect(processMessage).toHaveBeenCalledTimes(2);
    expect(processMessage.mock.calls[0]?.[4]).toMatchObject({
      runtimeConfigurationRevision: {
        revisionSetId: "R1",
        revisions: { route: "route-R1" },
      },
    });
    expect(processMessage.mock.calls[1]?.[4]).toMatchObject({
      runtimeConfigurationRevision: {
        revisionSetId: "R2",
        revisions: { route: "route-R2" },
      },
      runtimeSessionConfigurationRevision: {
        revisionSetId: "R1",
        revisions: { route: "route-R1" },
      },
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

    await processAdmittedTurn({
      ...makeContext(orchestrator, sessionRegistry, () => ({ revisionSetId: "R2", revisions: { route: "route-R2" } })),
      sessionId: "new-session",
    });

    expect(processMessage.mock.calls[0]?.[4]).toMatchObject({
      runtimeConfigurationRevision: { revisionSetId: "R2" },
      runtimeSessionConfigurationRevision: { revisionSetId: "R2" },
    });
  });
});
