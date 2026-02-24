import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentPart } from "@kilnai/core";
import { useKilnContext } from "./provider.js";
import type { ChatMessage, ChatOptions, UseChatReturn, WsChatFrame } from "./types.js";

export function useKilnWsChat(options?: ChatOptions): UseChatReturn {
  const { config } = useKilnContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
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
        const frame = JSON.parse(event.data as string) as WsChatFrame;
        if (frame.type === "done") {
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
  }, [config.baseUrl, config.userId, appName]);

  const send = useCallback(
    async (content: string | ContentPart[]) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setError(new Error("WebSocket not connected"));
        return;
      }

      const userContent = typeof content === "string" ? content : undefined;
      const userParts = typeof content !== "string" ? content : undefined;

      const userMsg: ChatMessage = {
        id: String(++idCounter.current),
        role: "user",
        content: userContent ?? "",
        parts: userParts,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);

      ws.send(JSON.stringify({
        type: "message",
        content: userContent ?? "",
        ...(userParts ? { parts: userParts } : {}),
      }));
    },
    [],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, send, isLoading, error, clearMessages };
}
