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
