import { describe, expect, it } from "vitest";

import type {
  GuiInboundFrame,
  GuiOutboundFrame,
  GuiSessionMeta,
  ModelCatalog,
} from "../src/index.js";

const modelCatalog = {
  observedAt: "2026-08-26T16:00:00.000Z",
  models: [{
    providerId: "codex-oauth",
    providerRouteId: "codex-oauth:direct",
    providerModelId: "gpt-5.6-terra",
    access: "subscription",
    family: "gpt-5.6",
    discovery: "observed",
    eligibility: "eligible",
    availability: "available",
    provenance: [],
    targets: [{
      targetId: "terra",
      label: "Terra",
      access: "subscription",
      availability: "available",
      reasonCodes: ["configured"],
      repairActions: [],
      eligibleAccountCount: 2,
      accountOverrideIds: ["work"],
      cost: { kind: "subscription" },
    }],
  }],
} as const satisfies ModelCatalog;

describe("execution target frames", () => {
  it("selects and acknowledges one configured target", () => {
    const outbound = {
      type: "execution_target",
      requestId: "request-1",
      targetId: "terra",
      accountOverrideId: "work",
    } as const satisfies GuiOutboundFrame;
    const inbound = {
      type: "execution_target_changed",
      requestId: "request-1",
      targetId: "terra",
      providerId: "codex-oauth",
      providerModelId: "gpt-5.6-terra",
    } as const satisfies GuiInboundFrame;

    expect(outbound).toMatchObject({ targetId: "terra" });
    expect(inbound).toMatchObject({ targetId: "terra" });
    expect(JSON.stringify(outbound)).not.toContain("credential");
  });

  it("keeps post-admission route identity as lifecycle evidence", () => {
    const welcome = {
      type: "welcome",
      modelCatalog,
      activeTargetId: "terra",
    } as const satisfies GuiInboundFrame;
    const done = {
      type: "done",
      kilnSessionId: "session-1",
      content: "Completed.",
      inputTokens: 1,
      outputTokens: 2,
      outcome: "completed",
      routedRouteId: "runtime-route-1",
      routedProvider: "codex-oauth",
      routedModel: "gpt-5.6-terra",
    } as const satisfies GuiInboundFrame;
    const session = {
      kilnSessionId: "session-1",
      task: "Inspect execution evidence",
      startedAt: "2026-08-26T16:00:00.000Z",
      routesUsed: ["runtime-route-1"],
      lastRouteId: "runtime-route-1",
      routeThreads: [{ routeId: "runtime-route-1", provider: "codex-oauth", model: "gpt-5.6-terra" }],
    } as const satisfies GuiSessionMeta;

    expect(welcome).toMatchObject({ activeTargetId: "terra" });
    expect(done).toMatchObject({ routedRouteId: "runtime-route-1" });
    expect(session).toMatchObject({ lastRouteId: "runtime-route-1" });
  });
});
