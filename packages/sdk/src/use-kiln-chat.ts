import { useCallback, useRef, useState } from "react";
import type { ContentPart } from "@kilnai/core";
import { useKilnContext } from "./provider.js";
import { buildUserMessage } from "./build-user-message.js";
import type { ChatMessage, ChatOptions, ChatSendOptions, UseChatReturn } from "./types.js";

export function useKilnChat(options?: ChatOptions): UseChatReturn {
  const { client, config } = useKilnContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const idCounter = useRef(0);

  const appName = options?.appName ?? config.appName ?? "default";

  const send = useCallback(
    async (content: string | ContentPart[], sendOptions?: ChatSendOptions) => {
      const userMsg = buildUserMessage(content, String(++idCounter.current));

      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);

      try {
        const body: Record<string, unknown> = {
          message: userMsg.content,
          appName,
          userId: config.userId,
          sessionId: options?.sessionId,
        };
        if (userMsg.parts) {
          body.parts = userMsg.parts;
        }
        const requestedAuthority = sendOptions?.requestedAuthority ?? options?.requestedAuthority;
        if (requestedAuthority) {
          body.requestedAuthority = requestedAuthority;
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
    [client, appName, config.userId, options?.sessionId, options?.requestedAuthority],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, send, isLoading, error, clearMessages };
}
