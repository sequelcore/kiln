import { beforeEach, describe, expect, it, vi } from "vitest";
import { KNOWN_DELIBERATION_LEVEL_IDS } from "@kilnai/core/agents";
import { SessionRegistry } from "../wrapper/session-registry.js";

const runtimeMocks = vi.hoisted(() => ({
  discoverDirectProviders: vi.fn(),
}));

vi.mock("@kilnai/runtime", async () => {
  const actual = await vi.importActual<typeof import("@kilnai/runtime")>("@kilnai/runtime");
  return {
    ...actual,
    discoverGuiDirectProviderModelDiscovery: runtimeMocks.discoverDirectProviders,
  };
});

import { resolveAdmittedRunRouteCandidates } from "./run.js";

describe("resolveAdmittedRunRouteCandidates", () => {
  beforeEach(() => {
    runtimeMocks.discoverDirectProviders.mockReset();
  });

  it("retains discovered deliberation evidence for a canonical direct route", async () => {
    runtimeMocks.discoverDirectProviders.mockResolvedValue({
      "codex-oauth": {
        models: ["gpt-5.6-luna"],
        status: "available",
        reason: "Synthetic Codex OAuth catalog.",
        authState: "authenticated",
        modelCapabilities: {
          "gpt-5.6-luna": {
            deliberation: {
              provider: "codex-oauth",
              model: "gpt-5.6-luna",
              levels: [
                KNOWN_DELIBERATION_LEVEL_IDS.low,
                KNOWN_DELIBERATION_LEVEL_IDS.medium,
                KNOWN_DELIBERATION_LEVEL_IDS.high,
                KNOWN_DELIBERATION_LEVEL_IDS.xhigh,
                KNOWN_DELIBERATION_LEVEL_IDS.max,
              ].map((id) => ({ id })),
              defaultLevel: KNOWN_DELIBERATION_LEVEL_IDS.medium,
              supportsAdaptive: true,
              evidence: {
                sourceIdentity: "synthetic-codex-oauth-catalog",
                sourceRevision: "gpt-5.6-luna",
                observedAt: "2026-08-30T00:00:00.000Z",
              },
            },
          },
        },
      },
    });

    const result = await resolveAdmittedRunRouteCandidates({
      candidates: [{ provider: "codex-oauth", model: "gpt-5.6-luna" }],
      registry: new SessionRegistry([]),
      cwd: "C:/repo",
      env: {},
      routeHealthStore: {} as never,
      canonicalExecution: true,
    });

    expect(runtimeMocks.discoverDirectProviders).toHaveBeenCalledTimes(1);
    expect(result.candidates).toEqual([{ provider: "codex-oauth", model: "gpt-5.6-luna" }]);
    expect(result.routeCapabilities.get("codex-oauth/gpt-5.6-luna")).toMatchObject({
      provider: "codex-oauth",
      model: "gpt-5.6-luna",
      levels: [
        { id: "low" },
        { id: "medium" },
        { id: "high" },
        { id: "xhigh" },
        { id: "max" },
      ],
      defaultLevel: "medium",
      supportsAdaptive: true,
      evidence: {
        sourceIdentity: "synthetic-codex-oauth-catalog",
        sourceRevision: "gpt-5.6-luna",
      },
    });
  });
});
