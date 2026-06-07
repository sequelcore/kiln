import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionList } from "../src/components/session-list.js";
import { deriveSessionContinuity } from "../src/lib/session-continuity.js";

const sessions = [
  {
    id: "session-1",
    providersUsed: ["claude"],
    lastProvider: "claude",
    completedAt: "2026-04-21T20:00:00.000Z",
    cost: 0.1,
    taskSummary: "First task",
  },
  {
    id: "session-2",
    providersUsed: ["codex"],
    lastProvider: "codex",
    completedAt: "2026-04-21T21:00:00.000Z",
    cost: 0.2,
    taskSummary: "Second task",
  },
] as const;

function renderSessionList(input?: {
  selectedSessionId?: string | null;
  continuationTargetId?: string | null;
  liveSessionId?: string | null;
  detachedSessionIds?: readonly string[];
  status?: "idle" | "connecting" | "ready" | "running" | "error";
  onSelect?: (sessionId: string) => void;
  onStartNewSession?: () => void;
}) {
  const selectedSessionId = input?.selectedSessionId ?? "session-1";
  const continuationTargetId = input?.continuationTargetId ?? null;
  return render(
    <SessionList
      sessions={sessions}
      selectedSessionId={selectedSessionId}
      continuity={deriveSessionContinuity({
        status: input?.status ?? "ready",
        selectedSessionId,
        liveSessionId: input?.liveSessionId ?? null,
        continuationTargetId,
        messageCount: 0,
        sessionEventCount: 0,
        detachedSessionIds: input?.detachedSessionIds ?? [],
      })}
      onSelect={input?.onSelect ?? (() => {})}
      onStartNewSession={input?.onStartNewSession ?? (() => {})}
    />,
  );
}

describe("SessionList", () => {
  it("supports arrow-key navigation across sessions", () => {
    const onSelect = vi.fn();
    renderSessionList({ selectedSessionId: "session-1", onSelect });

    const options = screen.getAllByRole("option");
    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith("session-2");

    fireEvent.keyDown(options[1], { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith("session-1");
  });

  it("marks selected sessions as continuation targets", () => {
    renderSessionList({
      selectedSessionId: "session-2",
    });

    expect(screen.queryByText("Session Preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Loaded")).not.toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.getByText("Continue")).toBeInTheDocument();
    expect(screen.queryByText("Preview")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Second task/ })).toHaveAttribute("aria-selected", "true");
  });

  it("marks running and detached sessions distinctly", () => {
    renderSessionList({
      selectedSessionId: null,
      liveSessionId: "session-1",
      detachedSessionIds: ["session-2"],
      status: "running",
    });

    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Detached")).toBeInTheDocument();
  });

  it("selects a session through the row without a redundant continue action", () => {
    const onSelect = vi.fn();
    renderSessionList({ selectedSessionId: "session-2", onSelect });

    expect(screen.queryByRole("button", { name: "Continue First task" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /First task/ }));
    expect(onSelect).toHaveBeenCalledWith("session-1");
  });

  it("keeps new session reset action separate from row selection", () => {
    const onStartNewSession = vi.fn();
    const onSelect = vi.fn();
    renderSessionList({
      selectedSessionId: "session-2",
      onSelect,
      onStartNewSession,
    });

    fireEvent.click(screen.getAllByRole("option")[1] as Element);
    expect(onSelect).toHaveBeenCalledWith("session-2");

    fireEvent.click(screen.getByRole("button", { name: "New Session" }));
    expect(onStartNewSession).toHaveBeenCalledTimes(1);
  });

  it("does not render unavailable search and filter controls", () => {
    renderSessionList();

    expect(screen.queryByLabelText("Search sessions")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Filter sessions")).not.toBeInTheDocument();
  });
});
