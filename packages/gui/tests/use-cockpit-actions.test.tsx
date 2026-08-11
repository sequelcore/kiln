import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createResourceTarget, useCockpitActions } from "../src/components/use-cockpit-actions.js";

describe("createResourceTarget", () => {
  it("combines selected gateway, session, explicit target, and resource uri", () => {
    const target = createResourceTarget({
      selectedGatewayTarget: {
        gatewayTarget: { targetId: "runtime-target" },
        instanceId: "instance-1",
      } as never,
      selectedSessionId: "session-1",
    }, "kiln://resource/default", {
      sessionId: "session-override",
      resourceUri: "kiln://resource/explicit",
    });

    expect(target).toEqual({
      gatewayTargetId: "runtime-target",
      instanceId: "instance-1",
      sessionId: "session-override",
      resourceUri: "kiln://resource/explicit",
    });
  });
});

describe("useCockpitActions", () => {
  it("opens resources in a new window with the resolved cockpit target", async () => {
    const loadResourceDataUrl = vi.fn(async () => "data:text/plain,hello");
    const resourceWindow = {
      close: vi.fn(),
      location: { href: "about:blank" },
    };
    const open = vi.spyOn(window, "open").mockReturnValue(resourceWindow as never);

    const { result } = renderHook(() => useCockpitActions({
      gatewayClient: { loadResourceDataUrl } as never,
      selectedGatewayTarget: {
        gatewayTarget: { targetId: "runtime-target" },
        instanceId: "instance-1",
      } as never,
      selectedSessionId: "session-1",
      sendFrame: () => vi.fn(),
      onFailure: vi.fn(),
    }));

    await act(async () => {
      await result.current.openResource("kiln://resource/one");
    });

    expect(open).toHaveBeenCalledWith("about:blank", "_blank", "noopener,noreferrer");
    expect(loadResourceDataUrl).toHaveBeenCalledWith("kiln://resource/one", {
      gatewayTargetId: "runtime-target",
      instanceId: "instance-1",
      sessionId: "session-1",
      resourceUri: "kiln://resource/one",
    });
    expect(resourceWindow.location.href).toBe("data:text/plain,hello");
  });

  it("closes the provisional resource window and reports load failures", async () => {
    const onFailure = vi.fn();
    const resourceWindow = {
      close: vi.fn(),
      location: { href: "about:blank" },
    };
    vi.spyOn(window, "open").mockReturnValue(resourceWindow as never);
    const { result } = renderHook(() => useCockpitActions({
      gatewayClient: {
        loadResourceDataUrl: vi.fn(async () => {
          throw new Error("Resource failed");
        }),
      } as never,
      selectedGatewayTarget: null,
      selectedSessionId: null,
      sendFrame: () => vi.fn(),
      onFailure,
    }));

    await act(async () => {
      await result.current.openResource("kiln://resource/missing");
    });

    expect(resourceWindow.close).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith({
      action: "open_resource",
      message: "Resource failed",
    });
  });

  it("sends managed-agent cancel and prompt control frames", () => {
    const send = vi.fn();
    const { result } = renderHook(() => useCockpitActions({
      gatewayClient: {} as never,
      selectedGatewayTarget: null,
      selectedSessionId: null,
      sendFrame: () => send,
      onFailure: vi.fn(),
    }));

    act(() => {
      result.current.cancelManagedAgent({
        gatewayTargetId: "runtime-target",
        sessionId: "session-1",
        invocationId: "invocation-1",
      });
      result.current.promptManagedAgent({
        sessionId: "session-1",
        invocationId: "invocation-1",
        prompt: "continue",
        deliveryMode: "queue",
        wakeRequested: true,
      });
    });

    expect(send).toHaveBeenNthCalledWith(1, {
      type: "managed_agent_control",
      action: "cancel",
      gatewayTargetId: "runtime-target",
      sessionId: "session-1",
      invocationId: "invocation-1",
      reason: "Operator cancelled the managed child from the GUI cockpit.",
    });
    expect(send).toHaveBeenNthCalledWith(2, {
      type: "managed_agent_control",
      action: "prompt",
      sessionId: "session-1",
      invocationId: "invocation-1",
      prompt: "continue",
      deliveryMode: "queue",
      wakeRequested: true,
      reason: "Operator sent a managed-child follow-up prompt from the GUI cockpit.",
    });
  });

  it("reports unavailable managed-agent control without sending frames", () => {
    const onFailure = vi.fn();
    const { result } = renderHook(() => useCockpitActions({
      gatewayClient: {} as never,
      selectedGatewayTarget: null,
      selectedSessionId: null,
      sendFrame: () => null,
      onFailure,
    }));

    act(() => {
      result.current.cancelManagedAgent({ sessionId: "session-1", invocationId: "invocation-1" });
    });

    expect(onFailure).toHaveBeenCalledWith({
      action: "cancel",
      invocationId: "invocation-1",
      message: "Managed agent control is unavailable until the gateway connection is open.",
    });
  });
});
