import { describe, expect, it } from "vitest";
import {
  OperatorSurfaceCapabilitySnapshotSchema,
  operatorSurfaceCapabilityStatus,
  operatorSurfaceSupports,
} from "../src/operator-surface-capability.js";
import type { OperatorSurfaceCapabilitySnapshot } from "../src/operator-surface-capability.js";
import type { GuiInboundFrame } from "../src/frames.js";

describe("operator surface capability contract", () => {
  it("accepts a native surface capability snapshot with performance and browser host slots", () => {
    const snapshot = OperatorSurfaceCapabilitySnapshotSchema.parse({
      surface: "native",
      surfaceId: "native:local",
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
          capability: "embedded-browser-host",
          status: "unsupported",
          reason: "Browser host proof is owned by roadmap 03.",
        },
        {
          capability: "native-cockpit-contract",
          status: "available",
          reason: "Canonical native cockpit target and benchmark contracts are available.",
        },
        {
          capability: "surface-performance-telemetry",
          status: "available",
        },
      ],
    }) satisfies OperatorSurfaceCapabilitySnapshot;

    expect(operatorSurfaceSupports(snapshot, "gateway-attach")).toBe(true);
    expect(operatorSurfaceSupports(snapshot, "surface-performance-telemetry")).toBe(true);
    expect(operatorSurfaceSupports(snapshot, "native-cockpit-contract")).toBe(true);
    expect(operatorSurfaceSupports(snapshot, "embedded-browser-host")).toBe(false);
    expect(operatorSurfaceCapabilityStatus(snapshot, "embedded-browser-host")).toEqual({
      capability: "embedded-browser-host",
      status: "unsupported",
      reason: "Browser host proof is owned by roadmap 03.",
    });
  });

  it("rejects unknown surface kinds and unknown capabilities", () => {
    expect(() => {
      OperatorSurfaceCapabilitySnapshotSchema.parse({
        surface: "private-native",
        surfaceId: "bad",
        capabilities: [],
      });
    }).toThrow();

    expect(() => {
      OperatorSurfaceCapabilitySnapshotSchema.parse({
        surface: "native",
        surfaceId: "native:local",
        capabilities: [
          {
            capability: "private-runtime",
            status: "available",
          },
        ],
      });
    }).toThrow();
  });

  it("allows native as an operator session event source surface", () => {
    const frame: GuiInboundFrame = {
      type: "session_event",
      event: {
        eventId: "session-1:native:1",
        kilnSessionId: "session-1",
        sequence: 1,
        timestamp: "2026-05-14T12:00:00.000Z",
        kind: "session_started",
        source: {
          actor: "runtime",
          surface: "native",
          component: "native-surface",
        },
        payload: {},
      },
    };

    expect(frame.event.source?.surface).toBe("native");
  });
});
