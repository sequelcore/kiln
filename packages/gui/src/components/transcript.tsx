import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Message } from "../lib/session-store.js";
import { MessageRow } from "./message-row.js";

interface TranscriptProps {
  readonly messages: readonly Message[];
}

const BOTTOM_THRESHOLD_PX = 24;

function isAtBottom(node: HTMLDivElement): boolean {
  const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
  return distanceFromBottom <= BOTTOM_THRESHOLD_PX;
}

export function Transcript(props: TranscriptProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const shouldStickRef = useRef(true);
  const [hasUserScrolledUp, setHasUserScrolledUp] = useState(false);
  const lastMessage = props.messages[props.messages.length - 1];

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const onScroll = () => {
      const atBottom = isAtBottom(node);
      shouldStickRef.current = atBottom;
      setHasUserScrolledUp(!atBottom);
    };

    node.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node || !shouldStickRef.current) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [props.messages.length, lastMessage?.content]);

  return (
    <section className="relative flex h-full min-h-0 flex-col">
      <div
        ref={containerRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        aria-live="polite"
        aria-label="Transcript"
      >
        {props.messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-background-element)]/50 px-4 py-6 text-sm text-[var(--color-text-muted)]">
            Start a conversation to see the transcript.
          </div>
        ) : (
          props.messages.map((message) => (
            <MessageRow key={message.id} message={message} />
          ))
        )}
      </div>
      {hasUserScrolledUp ? (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[var(--color-background)] to-transparent" />
      ) : null}
    </section>
  );
}

