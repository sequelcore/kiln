import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionList } from "../src/components/session-list.js";

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
  resumeTargetId?: string | null;
  onSelect?: (sessionId: string) => void;
  onStartNewSession?: () => void;
}) {
  return render(
    <SessionList
      sessions={sessions}
      selectedSessionId={input?.selectedSessionId ?? "session-1"}
      resumeTargetId={input?.resumeTargetId ?? null}
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

  it("marks selected and resume target state without rendering row labels or a sidebar preview", () => {
    renderSessionList({
      selectedSessionId: "session-2",
      resumeTargetId: "session-1",
    });

    expect(screen.queryByText("Session Preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Loaded")).not.toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Second task/ })).toHaveAttribute("aria-selected", "true");
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
