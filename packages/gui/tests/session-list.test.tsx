import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionList } from "../src/components/session-list.js";
import { deriveSessionContinuity } from "../src/lib/session-continuity.js";

const sessions = [
  {
    id: "session-1",
    title: "Runtime boundary review",
    summary: "Validate the execution envelope across operator surfaces.",
    tags: ["runtime", "review"],
    providersUsed: ["claude"],
    lastProvider: "claude",
    completedAt: "2026-04-21T20:00:00.000Z",
    cost: 0.1,
    taskSummary: "First task",
  },
  {
    id: "session-2",
    title: "Sidebar continuity",
    summary: "Align navigation and history into one surface.",
    tags: ["gui"],
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

    const history = screen.getByRole("navigation", { name: "Session history" });
    const options = within(history).getAllByRole("button");
    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith("session-2");

    fireEvent.keyDown(options[1], { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith("session-1");
  });

  it("keeps routine continuation state visually silent", () => {
    renderSessionList({
      selectedSessionId: "session-2",
    });

    expect(screen.queryByText("Session Preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Loaded")).not.toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText("Continue")).not.toBeInTheDocument();
    expect(screen.queryByText("Preview")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sidebar continuity/ })).toHaveAttribute("aria-current", "page");
  });

  it("announces exceptional session states without rendering status badges", () => {
    renderSessionList({
      selectedSessionId: null,
      liveSessionId: "session-1",
      detachedSessionIds: ["session-2"],
      status: "running",
    });

    expect(screen.getByLabelText("Running session")).toBeInTheDocument();
    expect(screen.getByLabelText("Detached session")).toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
    expect(screen.queryByText("Detached")).not.toBeInTheDocument();
  });

  it("selects a session through the row without a redundant continue action", () => {
    const onSelect = vi.fn();
    renderSessionList({ selectedSessionId: "session-2", onSelect });

    expect(screen.queryByRole("button", { name: "Continue Runtime boundary review" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Runtime boundary review/ }));
    expect(onSelect).toHaveBeenCalledWith("session-1");
  });

  it("reveals search on demand and filters compact history rows", () => {
    renderSessionList();

    expect(screen.queryByRole("searchbox", { name: "Search sessions" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search sessions" }));
    const search = screen.getByRole("searchbox", { name: "Search sessions" });
    fireEvent.change(search, { target: { value: "sidebar" } });

    expect(screen.queryByRole("button", { name: /Runtime boundary review/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sidebar continuity/ })).toBeVisible();
    expect(screen.queryByText("1 of 2 sessions")).not.toBeInTheDocument();
  });

  it("omits provider, summary, tag, and count noise from history rows", () => {
    renderSessionList();

    expect(screen.getByText("Runtime boundary review")).toBeVisible();
    expect(screen.queryByText("Validate the execution envelope across operator surfaces.")).not.toBeInTheDocument();
    expect(screen.queryByText("claude")).not.toBeInTheDocument();
    expect(screen.queryByText("#runtime")).not.toBeInTheDocument();
    expect(screen.queryByText("2 sessions")).not.toBeInTheDocument();
  });

  it("keeps history spacing aligned with sidebar navigation", () => {
    renderSessionList();

    expect(screen.getByRole("heading", { name: "Recent" }).closest("header")).toHaveClass("h-9", "px-3");
    expect(screen.getByRole("navigation", { name: "Session history" }).parentElement).toHaveClass("px-2");
    expect(screen.getByRole("button", { name: /Runtime boundary review/ })).toHaveClass("h-8", "px-2");
  });
});
