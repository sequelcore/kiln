import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityLogPanel } from "../src/components/activity-log-panel.js";
import type { TimelineEntry } from "../src/lib/session-store.js";

describe("ActivityLogPanel", () => {
  it("renders provider routing as typed details instead of a raw payload", () => {
    const entries: TimelineEntry[] = [
      {
        id: "timeline:event:provider",
        type: "event",
        eventKind: "provider_routed",
        createdAt: "2026-04-29T07:03:00.000Z",
        title: "Provider routed",
        summary: "codex-oauth · gpt-5.5",
        tone: "info",
        presentationDetails: [
          { label: "Provider", value: "codex-oauth" },
          { label: "Model", value: "gpt-5.5" },
          { label: "Why", value: "Explicit model override" },
        ],
        details: {
          provider: {
            provider: "codex-oauth",
            model: "gpt-5.5",
          },
          reason: "Explicit model override",
        },
      },
    ];

    render(<ActivityLogPanel entries={entries} />);

    const detail = screen.getByLabelText("Selected activity detail");
    expect(detail).toHaveTextContent("Provider routed");
    expect(detail).toHaveTextContent("Provider");
    expect(detail).toHaveTextContent("codex-oauth");
    expect(detail).toHaveTextContent("Model");
    expect(detail).toHaveTextContent("gpt-5.5");
    expect(detail).toHaveTextContent("Why");
    expect(detail).toHaveTextContent("Explicit model override");
    expect(detail).not.toHaveTextContent("\"provider\"");
    expect(detail).not.toHaveTextContent("{");
    expect(detail).not.toHaveTextContent("Kind");
  });

  it("keeps turn completion details readable without serializing nested objects", () => {
    const entries: TimelineEntry[] = [
      {
        id: "timeline:event:turn",
        type: "event",
        eventKind: "turn_completed",
        createdAt: "2026-04-29T07:04:00.000Z",
        title: "Turn completed",
        summary: "success",
        tone: "success",
        presentationDetails: [
          { label: "Provider", value: "codex-oauth" },
          { label: "Continuity", value: "fallback-replay" },
          { label: "Authority", value: "destructive" },
        ],
        details: {
          routedProvider: "codex-oauth",
          routedModel: "gpt-5.4-mini",
          outcome: "success",
          runtimeContinuity: {
            strategy: "fallback-replay",
            selectionReason: "no-sources",
          },
          authorityStatus: {
            effective: "destructive",
          },
          inputTokens: 1398,
          outputTokens: 11,
        },
      },
    ];

    render(<ActivityLogPanel entries={entries} />);

    const detail = screen.getByLabelText("Selected activity detail");
    expect(detail).toHaveTextContent("Provider");
    expect(detail).toHaveTextContent("codex-oauth");
    expect(detail).toHaveTextContent("Continuity");
    expect(detail).toHaveTextContent("fallback-replay");
    expect(detail).toHaveTextContent("Authority");
    expect(detail).toHaveTextContent("destructive");
    expect(detail).not.toHaveTextContent("\"runtimeContinuity\"");
    expect(detail).not.toHaveTextContent("{");
  });

  it("renders managed-agent identity avatars from canonical invocation payloads", () => {
    const entries: TimelineEntry[] = [
      {
        id: "timeline:event:agent",
        type: "event",
        eventKind: "agent_invocation_completed",
        createdAt: "2026-05-07T08:00:00.000Z",
        title: "Agent invocation completed",
        summary: "architecture-reviewer via codex-oauth/gpt-5.4-mini",
        tone: "success",
        details: {
          invocationId: "inv-1",
          agentId: "codex-oauth:foundation-readonly-plan",
          profile: "foundation-readonly-plan",
          providerRoute: {
            providerId: "codex-oauth",
            model: "gpt-5.4-mini",
            surface: "direct-provider",
          },
          capabilitySnapshot: {
            snapshotId: "inv-1:capability-snapshot",
            capturedAt: "2026-05-07T08:00:00.000Z",
            routeHealth: { status: "healthy" },
            providerModelProof: { status: "live-proven" },
            resourcePlane: { available: true, resourceUris: [] },
            childIdentity: {
              agentId: "codex-oauth:foundation-readonly-plan",
              displayName: "Piama",
            },
          },
        },
      },
    ];

    render(<ActivityLogPanel entries={entries} />);

    const avatars = screen.getAllByLabelText("Piama avatar");
    expect(avatars).toHaveLength(2);
    expect(avatars[0]).toHaveAttribute("data-avatar-state", "success");
  });
  it("renders the same canonical tool evidence used by the transcript", () => {
    const entries: TimelineEntry[] = [{
      id: "timeline:event:search",
      type: "event",
      eventKind: "tool_call_completed",
      createdAt: "2026-04-29T07:05:00.000Z",
      title: "Searched the web",
      summary: "2 results",
      tone: "success",
      toolPresentation: {
        outputKind: "search_results",
        title: "Search results",
        searchResults: [
          { title: "Kiln documentation", url: "https://example.com/kiln", snippet: "Canonical evidence." },
          { title: "Architecture", url: "https://example.com/architecture" },
        ],
      },
    }];

    render(<ActivityLogPanel entries={entries} />);

    const detail = screen.getByLabelText("Selected activity detail");
    expect(detail).toHaveTextContent("2 results");
    expect(screen.getByRole("link", { name: /Kiln documentation/u })).toHaveAttribute("href", "https://example.com/kiln");
  });
});
