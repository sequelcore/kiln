import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionTelemetry } from "../src/components/session-telemetry.js";

describe("SessionTelemetry", () => {
  it("renders provider breakdown and continuity details without duplicating changed files", () => {
    render(
      <SessionTelemetry
        activeProvider="claude"
        resumeInfo={{
          strategy: "provider-native",
          feedbackLabel: "observed provider-native · 6",
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
        fieldTelemetry={{
          status: "stable",
          dominantRegions: ["routing", "memory", "tools"],
          saturation: 0.42,
          entropy: 1.37,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(screen.getByText("resume: provider-native · observed provider-native · 6")).toBeInTheDocument();
    expect(screen.getByText("runtime: cache-first · applied")).toBeInTheDocument();
    expect(screen.getByText("srcs: session, project")).toBeInTheDocument();
    expect(screen.getByText("field [stable]")).toBeInTheDocument();
    expect(screen.getByText("dom: routing, memory, tools")).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes("sat: 42%") && content.includes("H: 1.37"))).toBeInTheDocument();
    expect(screen.queryByText("Changed Files")).not.toBeInTheDocument();
  });

  it("shows thinking state without empty changed-file fallback", () => {
    render(
      <SessionTelemetry
        activeProvider="claude"
        resumeInfo={null}
        runtimeContinuity={null}
        fieldTelemetry={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(screen.queryByText("(none)")).not.toBeInTheDocument();
    expect(screen.getByText("resume: --")).toBeInTheDocument();
  });
});
