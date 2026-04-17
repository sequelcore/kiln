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

export type { GuiInboundFrame, GuiOutboundFrame };
export type { GuiConnectionState } from "./ws-client";

// --- Helpers ---

/** Generate or retrieve a stable anonymous user ID from localStorage. */
function getOrCreateUserId(): string {
  const stored = localStorage.getItem("kiln.gui.userId");
  if (stored) return stored;
  const generated = `anon_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  localStorage.setItem("kiln.gui.userId", generated);
  return generated;
}

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

/**
 * React hook for the GUI WebSocket client.
 *
 * Creates one GuiWsClient per mount and cleans up on unmount.
 * Returns the current connection state, send function, and last received inbound frame.
 *
 * @param baseUrl - WebSocket endpoint base URL (e.g., "ws://localhost:3800/gui")
 */
export function useGuiWs(baseUrl: string): UseGuiWsResult {
  const [state, setState] = useState<GuiConnectionState>("idle");
  const [lastInbound, setLastInbound] = useState<GuiInboundFrame | null>(null);

  // Store client instance in ref to persist across renders
  const clientRef = useRef<GuiWsClient | null>(null);

  // userId — generate a stable anonymous identifier for the session
  const userIdRef = useRef<string>(getOrCreateUserId());

  // Initialize client on mount
  useEffect(() => {
    const userId = userIdRef.current;

    const client = new GuiWsClient({
      baseUrl,
      userId,
      onFrame: (frame) => {
        setLastInbound(frame);
      },
      onStateChange: (newState) => {
        setState(newState);
      },
    });

    clientRef.current = client;
    client.connect();

    // Cleanup on unmount
    return () => {
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