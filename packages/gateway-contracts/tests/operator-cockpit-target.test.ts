import { describe, expect, it } from "vitest";
import {
  OperatorCockpitCancellationRequestSchema,
  createOperatorCockpitCancellationRequest,
  createOperatorCockpitReadOnlyActionIntent,
  operatorCockpitActionAllowed,
} from "../src/operator-cockpit-target.js";

describe("operator cockpit target contract", () => {
  it("requires explicit instance and session targets before admitting cockpit actions", () => {
    expect(operatorCockpitActionAllowed({
      action: "inspect",
      target: {
        instanceId: "local",
      },
    })).toBe(true);
    expect(operatorCockpitActionAllowed({
      action: "focus_session",
      target: {
        instanceId: "local",
        sessionId: "session-1",
      },
    })).toBe(true);
    expect(operatorCockpitActionAllowed({
      action: "focus_session",
      target: {
        instanceId: "local",
      },
    })).toBe(false);
    expect(operatorCockpitActionAllowed({
      action: "replay",
      target: {
        instanceId: "local",
        sessionId: "session-1",
        eventId: "event-1",
      },
    })).toBe(true);
  });

  it("defines a gateway-mediated cancellation request without dispatching it", () => {
    const request = createOperatorCockpitCancellationRequest({
      requestId: "cancel-1",
      requestedAt: "2026-05-14T12:00:00.000Z",
      requestedBySurface: "native",
      target: {
        instanceId: "local",
        sessionId: "session-1",
        managedInvocationId: "child-1",
      },
      reason: "Operator stopped the child invocation from the cockpit.",
    });

    expect(OperatorCockpitCancellationRequestSchema.parse(request)).toEqual(request);
    expect(operatorCockpitActionAllowed({
      action: "cancel",
      target: request.target,
    })).toBe(true);
    expect(() => OperatorCockpitCancellationRequestSchema.parse({
      ...request,
      target: {
        instanceId: "local",
        managedInvocationId: "child-1",
      },
    })).toThrow();
  });

  it("creates read-only action intents without dispatching gateway mutations", () => {
    const intent = createOperatorCockpitReadOnlyActionIntent({
      action: "replay",
      requestedAt: "2026-05-14T12:00:00.000Z",
      target: {
        instanceId: "local",
        sessionId: "session-1",
        eventId: "event-1",
      },
    });

    expect(intent).toEqual({
      mode: "read-only",
      action: "replay",
      requestedAt: "2026-05-14T12:00:00.000Z",
      dispatch: "not-dispatched",
      target: {
        instanceId: "local",
        sessionId: "session-1",
        eventId: "event-1",
      },
    });
  });

  it("rejects cancellation as a read-only action intent", () => {
    expect(() => createOperatorCockpitReadOnlyActionIntent({
      action: "cancel",
      requestedAt: "2026-05-14T12:00:00.000Z",
      target: {
        instanceId: "local",
        sessionId: "session-1",
        managedInvocationId: "child-1",
      },
    })).toThrow("not available in read-only cockpit mode");

    expect(() => createOperatorCockpitReadOnlyActionIntent({
      action: "replay",
      requestedAt: "2026-05-14T12:00:00.000Z",
      target: {
        instanceId: "local",
      },
    })).toThrow("requires an explicit target");
  });
});
