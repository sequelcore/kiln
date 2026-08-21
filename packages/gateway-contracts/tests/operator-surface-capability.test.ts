import { describe, expect, it } from "vitest";
import {
  OperatorSurfaceCapabilitySnapshotSchema,
  operatorSurfaceCapabilityStatus,
  operatorSurfaceSupports,
} from "../src/operator-surface-capability.js";
import type { OperatorSurfaceCapabilitySnapshot } from "../src/operator-surface-capability.js";

describe("operator surface capability contract", () => {
  it("accepts an operator surface capability snapshot with an unavailable browser frame stream", () => {
    const snapshot = OperatorSurfaceCapabilitySnapshotSchema.parse({
      surface: "gui",
      surfaceId: "gui:local",
      generatedAt: "2026-05-14T12:00:00.000Z",
      capabilities: [
        {
          capability: "gateway-attach",
          status: "available",
        },
        {
          capability: "session-projection",
          status: "available",
        },
        {
          capability: "browser-frame-stream",
          status: "unsupported",
          reason: "Live browser frames are unavailable on this surface.",
        },
      ],
    }) satisfies OperatorSurfaceCapabilitySnapshot;

    expect(operatorSurfaceSupports(snapshot, "gateway-attach")).toBe(true);
    expect(operatorSurfaceSupports(snapshot, "browser-frame-stream")).toBe(false);
    expect(operatorSurfaceCapabilityStatus(snapshot, "browser-frame-stream")).toEqual({
      capability: "browser-frame-stream",
      status: "unsupported",
      reason: "Live browser frames are unavailable on this surface.",
    });
  });

  it("rejects unknown surface kinds and unknown capabilities", () => {
    expect(() => {
      OperatorSurfaceCapabilitySnapshotSchema.parse({
        surface: "native",
        surfaceId: "bad",
        capabilities: [],
      });
    }).toThrow();

    expect(() => {
      OperatorSurfaceCapabilitySnapshotSchema.parse({
        surface: "gui",
        surfaceId: "gui:local",
        capabilities: [
          {
            capability: "private-runtime",
            status: "available",
          },
        ],
      });
    }).toThrow();
  });

});
