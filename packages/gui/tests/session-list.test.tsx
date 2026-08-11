import { fireEvent, render, screen, within } from "@testing-library/react";
import type { OperatorSessionSummary } from "@kilnai/gateway-contracts";
import { describe, expect, it, vi } from "vitest";
import { SessionList } from "../src/components/session-list.js";
import { deriveSessionContinuity } from "../src/lib/session-continuity.js";

const sessions = [
  {
    sessionId: "session-1",
    title: "Runtime boundary review",
    summary: "Validate the execution envelope across operator surfaces.",
    tags: ["runtime", "review"],
    providersUsed: ["claude"],
    lastRoute: { provider: "claude" },
    updatedAt: "2026-04-21T20:00:00.000Z",
    costUsd: 0.1,
  },
  {
    sessionId: "session-2",
    title: "Sidebar continuity",
    summary: "Align navigation and history into one surface.",
    tags: ["gui"],
    providersUsed: ["codex"],
    lastRoute: { provider: "codex" },
    updatedAt: "2026-04-21T21:00:00.000Z",
    costUsd: 0.2,
  },
] as const;

function renderSessionList(input?: {
  sessions?: readonly OperatorSessionSummary[];
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
      sessions={input?.sessions ?? sessions}
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

  it("makes exceptional session states visible without turning rows into badges", () => {
    renderSessionList({
      selectedSessionId: null,
      liveSessionId: "session-1",
      detachedSessionIds: ["session-2"],
      status: "running",
    });

    expect(screen.getByLabelText("Running session")).toBeInTheDocument();
    expect(screen.getByLabelText("Background session")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeVisible();
    expect(screen.getByText("Background")).toBeVisible();
    expect(screen.queryByText("Detached")).not.toBeInTheDocument();
  });

  it("orders active and attention sessions before chronological history", () => {
    const attentionSessions: readonly OperatorSessionSummary[] = [
      {
        ...sessions[0],
        sessionId: "history",
        title: "Completed history",
        lastTurnOutcome: "completed",
      },
      {
        ...sessions[1],
        sessionId: "paused",
        title: "Awaiting operator",
        lastTurnOutcome: "paused",
      },
      {
        ...sessions[0],
        sessionId: "live",
        title: "Live execution",
        lastTurnOutcome: "failed",
      },
    ];

    renderSessionList({
      sessions: attentionSessions,
      selectedSessionId: null,
      liveSessionId: "live",
      status: "running",
    });

    const history = screen.getByRole("navigation", { name: "Session history" });
    expect(within(history).getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "Active",
      "Needs attention",
      "Older",
    ]);
    expect(within(history).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Live executionRunning",
      "Awaiting operatorPaused",
      expect.stringMatching(/^Completed history/),
    ]);
  });

  it("uses the visual attention order for keyboard navigation", () => {
    const onSelect = vi.fn();
    renderSessionList({
      sessions: [
        { ...sessions[0], sessionId: "history", title: "Completed history", lastTurnOutcome: "completed" },
        { ...sessions[1], sessionId: "paused", title: "Awaiting operator", lastTurnOutcome: "paused" },
        { ...sessions[0], sessionId: "live", title: "Live execution" },
      ],
      selectedSessionId: "live",
      liveSessionId: "live",
      status: "running",
      onSelect,
    });

    const history = screen.getByRole("navigation", { name: "Session history" });
    fireEvent.keyDown(within(history).getByRole("button", { name: /Live execution/ }), { key: "ArrowDown" });

    expect(onSelect).toHaveBeenCalledWith("paused");
  });

  it("distinguishes failed work from non-actionable cancelled history", () => {
    renderSessionList({
      sessions: [
        { ...sessions[0], sessionId: "failed", title: "Broken execution", lastTurnOutcome: "failed" },
        { ...sessions[1], sessionId: "cancelled", title: "Stopped execution", lastTurnOutcome: "cancelled" },
      ],
      selectedSessionId: null,
    });

    const history = screen.getByRole("navigation", { name: "Session history" });
    expect(within(history).getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "Needs attention",
      "Older",
    ]);
    expect(within(history).getByText("Failed")).toBeVisible();
    expect(within(history).getByText("Cancelled")).toBeVisible();
  });

  it("reserves the trailing edge for activity and fades overflowing titles into it", () => {
    renderSessionList({
      selectedSessionId: null,
      liveSessionId: "session-1",
      status: "running",
    });

    const row = screen.getByRole("button", { name: /Runtime boundary review/ });
    const title = within(row).getByText("Runtime boundary review");
    const activity = within(row).getByLabelText("Running session");

    expect(title).toHaveAttribute("data-slot", "session-title");
    expect(title).toHaveClass("session-title-fade");
    expect(title.nextElementSibling).toBe(activity);
    expect(within(row).queryByText(/(?:now|\d+[mhd]|[A-Z][a-z]{2} \d{1,2})/)).not.toBeInTheDocument();
  });

  it("fades ordinary session titles before the timestamp without an ellipsis", () => {
    renderSessionList({ selectedSessionId: "session-2" });

    const row = screen.getByRole("button", { name: /Runtime boundary review/ });
    const title = within(row).getByText("Runtime boundary review");

    expect(title).toHaveClass("session-title-fade");
    expect(title).not.toHaveClass("truncate");
    expect(title.nextElementSibling).toHaveClass("tabular-nums");
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

    expect(screen.getByRole("heading", { name: "Sessions" }).closest("header")).toHaveClass("h-9", "px-3");
    expect(screen.getByRole("navigation", { name: "Session history" }).parentElement).toHaveClass("px-2");
    expect(screen.getByRole("button", { name: /Runtime boundary review/ })).toHaveClass("h-8", "px-2");
  });
});
