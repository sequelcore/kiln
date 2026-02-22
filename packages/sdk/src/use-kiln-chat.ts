import { useCallback, useRef, useState } from "react";
import type { ContentPart } from "@kilnai/core";
import { useKilnContext } from "./provider.js";
import type { ChatMessage, ChatOptions, UseChatReturn } from "./types.js";

export function useKilnChat(options?: ChatOptions): UseChatReturn {
  const { client, config } = useKilnContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const idCounter = useRef(0);

  const appName = options?.appName ?? config.appName ?? "default";

  const send = useCallback(
    async (content: string | ContentPart[]) => {
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

      try {
        const body: Record<string, unknown> = {
          message: userContent ?? "",
          appName,
          userId: config.userId,
          sessionId: options?.sessionId,
        };
        if (userParts) {
          body.parts = userParts;
        }

        const res = await client.post<{ response: string }>(`/apps/${appName}/message`, body);

        const assistantMsg: ChatMessage = {
          id: String(++idCounter.current),
          role: "assistant",
          content: res.response,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
      } finally {
        setIsLoading(false);
      }
    },
    [client, appName, config.userId, options?.sessionId],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, send, isLoading, error, clearMessages };
}
