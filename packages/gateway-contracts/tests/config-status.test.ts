import { describe, expect, it } from "vitest";
import { KilnProjectionTargetSnapshotSchema } from "../src/config-status.js";

describe("KilnProjectionTargetSnapshotSchema", () => {
  it("preserves structured native projection metadata for operator surfaces", () => {
    expect(KilnProjectionTargetSnapshotSchema.parse({
      targetId: "codex-agent:planner",
      path: "C:/Users/test/.codex/agents/planner.toml",
      kind: "native",
      status: "managed",
      managedFieldCount: 1,
      updatedAt: "2026-06-27T12:29:50.875Z",
    })).toMatchObject({
      managedFieldCount: 1,
      updatedAt: "2026-06-27T12:29:50.875Z",
    });
  });

  it("preserves native route-integrity metadata for setup and doctor surfaces", () => {
    expect(KilnProjectionTargetSnapshotSchema.parse({
      targetId: "opencode-config",
      path: "C:/Users/test/.config/opencode/opencode.json",
      kind: "native",
      status: "drifted",
      managedFieldCount: 2,
      routeIntegrity: {
        canonicalRoute: { providerId: "opencode-go", model: "deepseek-v4-flash" },
        nativeConfiguredDefault: { providerId: "opencode-go", model: "deepseek-v4-flash-free" },
        selectedRuntimeRoute: { providerId: "opencode-go", model: "deepseek-v4-flash-free" },
        catalogStatus: { status: "unknown-model", providerId: "opencode-go", model: "deepseek-v4-flash-free" },
        explicitProbeStatus: "succeeded",
        credentialSource: "kiln-auth-store",
        bareProofSupported: true,
        routeStatus: "drifted",
        credentialStatus: "unknown",
        classification: "projection-drift",
      },
    })).toMatchObject({
      routeIntegrity: {
        canonicalRoute: { providerId: "opencode-go", model: "deepseek-v4-flash" },
        nativeConfiguredDefault: { providerId: "opencode-go", model: "deepseek-v4-flash-free" },
        explicitProbeStatus: "succeeded",
        credentialSource: "kiln-auth-store",
        routeStatus: "drifted",
        credentialStatus: "unknown",
        classification: "projection-drift",
      },
    });
  });

  it("rejects invalid structured projection metadata", () => {
    expect(() => KilnProjectionTargetSnapshotSchema.parse({
      targetId: "codex-agent:planner",
      path: "C:/Users/test/.codex/agents/planner.toml",
      kind: "native",
      status: "managed",
      managedFieldCount: -1,
      updatedAt: "not-a-date",
    })).toThrow();
  });
});
