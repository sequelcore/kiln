import { useCallback, useEffect, useRef, useState } from "react";
import { useKilnContext } from "./provider.js";
import { SseClient } from "./sse-client.js";
import type { KilnEventData, UseEventsReturn } from "./types.js";

const MAX_EVENTS = 500;

export function useKilnEvents(): UseEventsReturn {
  const { config } = useKilnContext();
  const [events, setEvents] = useState<KilnEventData[]>([]);
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<SseClient | null>(null);

  useEffect(() => {
    const sse = new SseClient(
      `${config.baseUrl}/dev/events`,
      {
        onEvent(event) {
          setEvents((prev) => {
            const next = [...prev, event];
            return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
          });
        },
        onConnect() {
          setConnected(true);
        },
        onDisconnect() {
          setConnected(false);
        },
      },
      config.reconnectDelayMs,
    );

    clientRef.current = sse;
    sse.connect();

    return () => {
      sse.disconnect();
      clientRef.current = null;
    };
  }, [config.baseUrl, config.reconnectDelayMs]);

  const clear = useCallback(() => {
    setEvents([]);
  }, []);

  return { events, connected, clear };
}
