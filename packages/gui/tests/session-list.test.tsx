import { fireEvent, render, screen, within } from "@testing-library/react";
import type { OperatorSessionSummary } from "@kilnai/gateway-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionList } from "../src/components/session-list.js";
import { deriveSessionContinuity } from "../src/lib/session-continuity.js";

const sessions = [
  {
    sessionId: "session-1",
    title: "Runtime boundary review",
    summary: "Validate the execution envelope across operator surfaces.",
    tags: ["runtime", "review"],
    routesUsed: ["claude-review"],
    lastRoute: { routeId: "claude-review", provider: "claude" },
    updatedAt: "2026-04-21T20:00:00.000Z",
    costUsd: 0.1,
  },
  {
    sessionId: "session-2",
    title: "Sidebar continuity",
    summary: "Align navigation and history into one surface.",
    tags: ["gui"],
    routesUsed: ["codex-terra"],
    lastRoute: { routeId: "codex-terra", provider: "codex" },
    updatedAt: "2026-04-21T21:00:00.000Z",
    costUsd: 0.2,
  },
] as const satisfies readonly OperatorSessionSummary[];

function renderSessionList(input?: {
  sessions?: readonly OperatorSessionSummary[];
  selectedSessionId?: string | null;
  continuationTargetId?: string | null;
  liveSessionId?: string | null;
  detachedSessionIds?: readonly string[];
  status?: "idle" | "connecting" | "ready" | "running" | "error";
  loadState?: "loading" | "empty" | "ready" | "stale-error" | "fatal-error";
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
      loadState={input?.loadState ?? "ready"}
      onSelect={input?.onSelect ?? (() => {})}
      onStartNewSession={input?.onStartNewSession ?? (() => {})}
    />,
  );
}

describe("SessionList", () => {
  beforeEach(() => localStorage.clear());

  it("supports arrow-key navigation across sessions", () => {
    const onSelect = vi.fn();
    renderSessionList({ selectedSessionId: "session-1", onSelect });

    const history = screen.getByRole("navigation", { name: "Session history" });
    const options = [
      within(history).getByRole("button", { name: /Runtime boundary review/ }),
      within(history).getByRole("button", { name: /Sidebar continuity/ }),
    ];
    const [firstOption, secondOption] = options;
    if (!firstOption || !secondOption) {
      throw new Error("Session history did not render both navigation options.");
    }
    fireEvent.keyDown(firstOption, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith("session-2");

    fireEvent.keyDown(secondOption, { key: "ArrowUp" });
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
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
    expect(within(history).getAllByRole("heading").map(
      (heading) => heading.querySelector('[data-slot="session-group-label"]')?.textContent,
    )).toEqual([
      "Active",
      "Needs attention",
      "Older",
    ]);
    expect(Array.from(history.querySelectorAll('[data-slot="session-row"]')).map((button) => button.textContent)).toEqual([
      "Live executionRunning",
      "Awaiting operatorPaused",
      expect.stringMatching(/^Completed history/),
    ]);
  });

  it("collapses Session groups and removes hidden rows from keyboard navigation", () => {
    const onSelect = vi.fn();
    renderSessionList({
      sessions: [
        { ...sessions[0], sessionId: "live", title: "Live execution" },
        { ...sessions[1], sessionId: "history", title: "Completed history", lastTurnOutcome: "completed" },
      ],
      selectedSessionId: "live",
      liveSessionId: "live",
      status: "running",
      onSelect,
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse Active sessions" }));

    expect(screen.queryByRole("button", { name: /Live execution/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Active sessions" })).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("kiln.gui.sessionHistory.collapsedGroups:v1")).toBe("[]");
    const historyRow = screen.getByRole("button", { name: /Completed history/ });
    expect(historyRow).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(historyRow, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith("history");
  });

  it("reopens a collapsed operational group when a new Session needs visibility", () => {
    const { rerender } = renderSessionList({
      sessions: [{ ...sessions[0], sessionId: "live", title: "Live execution" }],
      selectedSessionId: null,
      liveSessionId: "live",
      status: "running",
    });
    fireEvent.click(screen.getByRole("button", { name: "Collapse Active sessions" }));

    rerender(
      <SessionList
        sessions={[
          { ...sessions[0], sessionId: "live", title: "Live execution" },
          { ...sessions[1], sessionId: "new-live", title: "New live execution" },
        ]}
        selectedSessionId={null}
        continuity={deriveSessionContinuity({
          status: "running",
          selectedSessionId: null,
          liveSessionId: "live",
          continuationTargetId: null,
          messageCount: 0,
          sessionEventCount: 0,
          detachedSessionIds: ["new-live"],
        })}
        loadState="ready"
        onSelect={() => {}}
        onStartNewSession={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Collapse Active sessions" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /New live execution/ })).toBeVisible();
  });

  it("temporarily expands collapsed groups while searching", () => {
    renderSessionList({
      selectedSessionId: null,
      liveSessionId: "session-1",
      status: "running",
    });
    fireEvent.click(screen.getByRole("button", { name: "Collapse Active sessions" }));
    fireEvent.click(screen.getByRole("button", { name: "Search sessions" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search sessions" }), {
      target: { value: "runtime" },
    });

    expect(screen.getByRole("button", { name: /Runtime boundary review/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Collapse Active sessions" })).toHaveAttribute("aria-disabled", "true");
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
    expect(within(history).getAllByRole("heading").map(
      (heading) => heading.querySelector('[data-slot="session-group-label"]')?.textContent,
    )).toEqual([
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

  it("shows exact last-route recognition without adding provider text noise", () => {
    renderSessionList();

    const row = screen.getByRole("button", { name: /Runtime boundary review/ });
    expect(within(row).getByLabelText("Last route: Claude")).toHaveAttribute("data-slot", "session-route");
    expect(within(row).getByLabelText("Last route: Claude").querySelector('[data-provider-brand="claude"]')).not.toBeNull();
    expect(screen.queryByText("Validate the execution envelope across operator surfaces.")).not.toBeInTheDocument();
    expect(screen.queryByText("claude")).not.toBeInTheDocument();
    expect(screen.queryByText("#runtime")).not.toBeInTheDocument();
    expect(screen.queryByText("2 sessions")).not.toBeInTheDocument();
  });

  it("exposes only an evidenced route model and leaves unknown history unbranded", () => {
    const unroutedSession: OperatorSessionSummary = {
      sessionId: "unrouted",
      title: "Sidebar continuity",
      summary: "Align navigation and history into one surface.",
      tags: ["gui"],
      routesUsed: [],
      updatedAt: "2026-04-21T21:00:00.000Z",
      costUsd: 0.2,
    };
    renderSessionList({
      sessions: [
        { ...sessions[0], sessionId: "modeled", lastRoute: { routeId: "claude-review", provider: "claude", model: "claude-sonnet-4-5" } },
        unroutedSession,
      ],
      selectedSessionId: null,
    });

    expect(screen.getByLabelText("Last route: Claude · claude-sonnet-4-5")).toBeVisible();
    expect(screen.getByRole("button", { name: /Sidebar continuity/ }).querySelector('[data-slot="session-route"]')).toBeNull();
  });

  it("searches canonical route identity and leaves route-only evidence unbranded", () => {
    renderSessionList({
      sessions: [{
        ...sessions[0],
        routesUsed: ["codex-sol"],
        lastRoute: { routeId: "codex-sol" },
      }],
      selectedSessionId: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Search sessions" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search sessions" }), {
      target: { value: "codex-sol" },
    });

    const row = screen.getByRole("button", { name: /Runtime boundary review/ });
    expect(row).toBeVisible();
    expect(row.querySelector('[data-slot="session-route"]')).toBeNull();
  });

  it("distinguishes initial loading, empty history, and stale refresh failure", () => {
    const { rerender } = render(
      <SessionList
        sessions={[]}
        selectedSessionId={null}
        continuity={deriveSessionContinuity({
          status: "ready",
          selectedSessionId: null,
          liveSessionId: null,
          continuationTargetId: null,
          messageCount: 0,
          sessionEventCount: 0,
          detachedSessionIds: [],
        })}
        loadState="loading"
        onSelect={() => {}}
        onStartNewSession={() => {}}
      />,
    );
    expect(screen.getByLabelText("Loading sessions")).toBeVisible();
    expect(screen.queryByText("No sessions yet.")).not.toBeInTheDocument();

    rerender(
      <SessionList
        sessions={sessions}
        selectedSessionId={null}
        continuity={deriveSessionContinuity({
          status: "ready",
          selectedSessionId: null,
          liveSessionId: null,
          continuationTargetId: null,
          messageCount: 0,
          sessionEventCount: 0,
          detachedSessionIds: [],
        })}
        loadState="stale-error"
        onRetryLoad={() => {}}
        onSelect={() => {}}
        onStartNewSession={() => {}}
      />,
    );
    expect(screen.getByText("Could not refresh sessions.")).toBeVisible();
    expect(screen.getByRole("button", { name: /Runtime boundary review/ })).toBeVisible();
  });

  it("keeps history spacing aligned with sidebar navigation", () => {
    renderSessionList();

    expect(screen.getByRole("heading", { name: "Sessions" }).closest("header")).toHaveClass("h-9", "px-3");
    expect(screen.getByRole("navigation", { name: "Session history" }).parentElement).toHaveClass("px-2");
    expect(screen.getByRole("button", { name: /Runtime boundary review/ })).toHaveClass("h-8", "px-2");
  });
});
