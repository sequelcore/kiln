import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Message, TimelineEntry } from "../src/lib/session-store/index.js";

const { visibilityState } = vi.hoisted(() => ({
  visibilityState: {
    currentAnchorId: null as string | null,
    visibleMessageIds: [] as readonly string[],
  },
}));

vi.mock("../src/components/ui/message-scroller.js", () => ({
  MessageScroller: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MessageScrollerButton: () => <button type="button" aria-label="Jump to latest" />,
  MessageScrollerContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MessageScrollerItem: ({ children, messageId, scrollAnchor }: { children: ReactNode; messageId?: string; scrollAnchor?: boolean }) => (
    <div data-message-id={messageId} data-scroll-anchor={scrollAnchor ? "true" : "false"}>
      {children}
    </div>
  ),
  MessageScrollerProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MessageScrollerViewport: ({ children }: { children: ReactNode }) => <div aria-label="Transcript" role="region">{children}</div>,
  useMessageScroller: () => ({ scrollToMessage: vi.fn() }),
  useMessageScrollerVisibility: () => visibilityState,
}));

import { Transcript } from "../src/components/transcript.js";

function message(id: string, role: Message["role"], content: string): Message {
  return {
    id,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function messageEntry(id: string, role: Message["role"], content: string): TimelineEntry {
  const entryMessage = message(id, role, content);
  return {
    id: `timeline:${id}`,
    type: "message",
    createdAt: entryMessage.createdAt,
    message: entryMessage,
  };
}

describe("Transcript navigation visibility", () => {
  it("uses the visible semantic rail item as active without making assistant replies scroll anchors", () => {
    visibilityState.currentAnchorId = "timeline:user-1";
    visibilityState.visibleMessageIds = ["timeline:assistant-1"];

    render(
      <Transcript
        entries={[
          messageEntry("user-1", "user", "First prompt"),
          messageEntry("assistant-1", "assistant", "First answer"),
          messageEntry("user-2", "user", "Second prompt"),
          messageEntry("assistant-2", "assistant", "Second answer"),
        ]}
      />,
    );

    const rail = screen.getByRole("navigation", { name: "Thread navigation" });
    const activeAnchors = within(rail)
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-current") === "location");

    expect(activeAnchors).toHaveLength(1);
    expect(activeAnchors[0]).toHaveAccessibleName("Jump to assistant reply 2");
    const promptRow = screen.getAllByText("First prompt")
      .find((element) => element.closest("article")?.getAttribute("data-role") === "user");
    const answerRow = screen.getAllByText("First answer")
      .find((element) => element.closest("article")?.getAttribute("data-role") === "assistant");
    expect(promptRow?.closest("[data-scroll-anchor]")).toHaveAttribute("data-scroll-anchor", "true");
    expect(answerRow?.closest("[data-scroll-anchor]")).toHaveAttribute("data-scroll-anchor", "false");
  });
});
