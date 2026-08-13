import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentPart } from "@kilnai/core";
import { EffectivePromptObservationSchema } from "@kilnai/gateway-contracts";
import { useKilnContext } from "./provider.js";
import { buildUserMessage } from "./build-user-message.js";
import type { ChatMessage, ChatOptions, ChatSendOptions, UseChatReturn, VisitorInfo, WsChatFrame } from "./types.js";

export function useKilnWsChat(options?: ChatOptions): UseChatReturn {
  const { config } = useKilnContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [communicationEvidence, setCommunicationEvidence] = useState<import("@kilnai/gateway-contracts").EffectivePromptObservation | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const idCounter = useRef(0);
  const stableUserId = useRef(config.userId ?? crypto.randomUUID());

  const appName = options?.appName ?? config.appName ?? "default";

  // Update stable ref if config.userId changes (but keep the generated one stable)
  if (config.userId && config.userId !== stableUserId.current) {
    stableUserId.current = config.userId;
  }

  useEffect(() => {
    const protocol = config.baseUrl.startsWith("https") ? "wss" : "ws";
    const host = config.baseUrl.replace(/^https?:\/\//, "");
    const url = `${protocol}://${host}/apps/${appName}/ws?userId=${encodeURIComponent(stableUserId.current)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string);
        // Respond to server heartbeat pings with a pong
        if (parsed.type === "ping") {
          try { ws.send(JSON.stringify({ type: "pong" })); } catch { /* closing */ }
          return;
        }
        const frame = parsed as WsChatFrame;
        if (frame.type === "done") {
          const parsedEvidence = frame.effectivePromptObservation === undefined
            ? undefined
            : EffectivePromptObservationSchema.safeParse(frame.effectivePromptObservation);
          setCommunicationEvidence(parsedEvidence?.success ? parsedEvidence.data : null);
          setMessages((prev) => [...prev, {
            id: String(++idCounter.current),
            role: "assistant" as const,
            content: frame.content,
            parts: frame.parts,
            timestamp: Date.now(),
          }]);
          setIsLoading(false);
        } else if (frame.type === "error") {
          setError(new Error(frame.message));
          setIsLoading(false);
        }
      } catch {
        // Discard malformed frames
      }
    };

    ws.onerror = () => setError(new Error("WebSocket connection failed"));
    ws.onclose = () => { wsRef.current = null; };

    return () => { ws.close(); wsRef.current = null; };
  }, [config.baseUrl, appName]);

  // deps: [] is correct -- wsRef and idCounter are stable refs
  const send = useCallback(
    async (content: string | ContentPart[], sendOptions?: ChatSendOptions) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setError(new Error("WebSocket not connected"));
        return;
      }

      const userMsg = buildUserMessage(content, String(++idCounter.current));

      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);

      ws.send(JSON.stringify({
        type: "message",
        content: userMsg.content,
        ...(userMsg.parts ? { parts: userMsg.parts } : {}),
        ...((sendOptions?.requestedAuthority ?? options?.requestedAuthority) ? {
          requestedAuthority: sendOptions?.requestedAuthority ?? options?.requestedAuthority,
        } : {}),
        ...((sendOptions?.communicationIntent ?? options?.communicationIntent) ? {
          communicationIntent: sendOptions?.communicationIntent ?? options?.communicationIntent,
        } : {}),
      }));
    },
    [options?.requestedAuthority, options?.communicationIntent],
  );

  const identify = useCallback((visitor: VisitorInfo) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "identify", visitor }));
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setCommunicationEvidence(null);
  }, []);

  return { messages, send, identify, isLoading, error, communicationEvidence, clearMessages };
}
