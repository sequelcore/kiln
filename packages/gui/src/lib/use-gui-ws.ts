/**
 * @fileoverview React hook for the GUI WebSocket client.
 * @module @kilnai/gui
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { GuiWsClient, type GuiConnectionState } from "./ws-client";
import type {
  GuiInboundFrame,
  GuiOutboundFrame,
} from "@kilnai/gateway-contracts";
import { getStableUserId } from "./stable-user-id.js";

export type { GuiInboundFrame, GuiOutboundFrame };
export type { GuiConnectionState } from "./ws-client";

// --- Helpers ---

/**
 * Return type for useGuiWs hook.
 */
export interface UseGuiWsResult {
  /** Current WebSocket connection state. */
  readonly state: GuiConnectionState;
  /** Function to send outbound frames to the gateway. */
  readonly send: (frame: GuiOutboundFrame) => void;
  /** Last received inbound frame (null before first message). */
  readonly lastInbound: GuiInboundFrame | null;
}

export interface UseGuiWsOptions {
  readonly onFrame?: (frame: GuiInboundFrame) => void;
  readonly onStateChange?: (state: GuiConnectionState) => void;
}

/**
 * React hook for the GUI WebSocket client.
 *
 * Creates one GuiWsClient per mount and cleans up on unmount.
 * Returns the current connection state, send function, and last received inbound frame.
 *
 * @param baseUrl - WebSocket endpoint base URL (e.g., "ws://127.0.0.1:3800/gui")
 */
export function useGuiWs(baseUrl: string, options?: UseGuiWsOptions): UseGuiWsResult {
  const [state, setState] = useState<GuiConnectionState>("idle");
  const [lastInbound, setLastInbound] = useState<GuiInboundFrame | null>(null);
  const onFrameRef = useRef(options?.onFrame);
  const onStateChangeRef = useRef(options?.onStateChange);

  // Store client instance in ref to persist across renders
  const clientRef = useRef<GuiWsClient | null>(null);

  // userId — generate a stable anonymous identifier for the session
  const userIdRef = useRef<string>(getStableUserId());

  useEffect(() => {
    onFrameRef.current = options?.onFrame;
    onStateChangeRef.current = options?.onStateChange;
  }, [options?.onFrame, options?.onStateChange]);

  // Initialize client on mount
  useEffect(() => {
    const userId = userIdRef.current;

    const client = new GuiWsClient({
      baseUrl,
      userId,
      onFrame: (frame) => {
        setLastInbound(frame);
        onFrameRef.current?.(frame);
      },
      onStateChange: (newState) => {
        setState(newState);
        onStateChangeRef.current?.(newState);
      },
    });

    clientRef.current = client;
    client.connect();

    const handleBeforeUnload = () => {
      client.close(1000, "window unload");
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    // Cleanup on unmount
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      client.close();
      clientRef.current = null;
    };
  }, [baseUrl]);

  // Send function — wraps client.send with useCallback
  const send = useCallback((frame: GuiOutboundFrame) => {
    clientRef.current?.send(frame);
  }, []);

  return {
    state,
    send,
    lastInbound,
  };
}
