import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionTelemetry } from "../src/components/session-telemetry.js";

describe("SessionTelemetry", () => {
  it("renders provider breakdown, continuity details, and changed files", () => {
    render(
      <SessionTelemetry
        status="ready"
        activeProvider="claude"
        turnCounter={3}
        sessionCostUsd={0.42}
        inputTokens={4200}
        outputTokens={1100}
        perProviderUsage={{
          claude: { costUsd: 0.12, inputTokens: 1200, outputTokens: 300 },
          codex: { costUsd: 0.30, inputTokens: 3000, outputTokens: 800 },
        }}
        runtimeContinuity={{
          strategy: "cache-first",
          feedbackLabel: "applied",
          pressure: "medium",
          supportArtifactCount: 2,
          supportArtifactSources: ["session", "project"],
          fallbackLabel: "support available",
          usedCachedSupport: true,
          selectionReason: "recent continuity",
        }}
        changedFiles={[
          {
            path: "packages/gui/src/components/app-shell.tsx",
            changeType: "modified",
            linesAdded: 12,
            linesRemoved: 4,
            recordedAt: "2026-04-21T00:00:00.000Z",
          },
        ]}
        fieldTelemetry={{
          status: "stable",
          dominantRegions: ["routing", "memory", "tools"],
          saturation: 0.42,
          entropy: 1.37,
        }}
      />,
    );

    expect(screen.getByText("claude")).toBeInTheDocument();
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.getByText("turns: 3")).toBeInTheDocument();
    expect(screen.getByText("tok: 4.2k/1.1k")).toBeInTheDocument();
    expect(screen.getByText("resume: cache-first · applied")).toBeInTheDocument();
    expect(screen.getByText("srcs: session, project")).toBeInTheDocument();
    expect(screen.getByText("field [stable]")).toBeInTheDocument();
    expect(screen.getByText("dom: routing, memory, tools")).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes("sat: 42%") && content.includes("H: 1.37"))).toBeInTheDocument();
    expect(screen.getByText("~ app-shell.tsx +12-4")).toBeInTheDocument();
  });

  it("shows thinking state and empty changes fallback", () => {
    render(
      <SessionTelemetry
        status="running"
        activeProvider="claude"
        turnCounter={0}
        sessionCostUsd={0}
        inputTokens={0}
        outputTokens={0}
        perProviderUsage={{}}
        runtimeContinuity={null}
        changedFiles={[]}
        fieldTelemetry={null}
      />,
    );

    expect(screen.getByText("thinking...")).toBeInTheDocument();
    expect(screen.getByText("(none)")).toBeInTheDocument();
    expect(screen.getByText("resume: --")).toBeInTheDocument();
  });
});
