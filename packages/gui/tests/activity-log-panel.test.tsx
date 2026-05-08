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
});
