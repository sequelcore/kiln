import { describe, expect, it, vi } from "vitest";

vi.mock("@opentui/core", () => ({
  t: (strings: TemplateStringsArray, ...values: readonly unknown[]) =>
    strings.reduce((text, chunk, index) => `${text}${chunk}${String(values[index] ?? "")}`, ""),
  fg: () => (text: string) => text,
}));

import { renderSidebarWork } from "../src/render.js";
import { createReactiveState } from "../src/state.js";
import { defaultTheme } from "../src/theme.js";

describe("TUI work item sidebar rendering", () => {
  it("renders authority, resource, and missing evidence state", () => {
    const state = createReactiveState();
    state.workItems = [
      {
        id: "work-visible",
        resourceUri: "kiln://session/work-items/work-visible",
        summary: "Audit TUI work item visibility.",
        status: "blocked",
        workflowProfile: "verification-heavy",
        authorityProfile: "authority:foundation-readonly-plan",
        assignedAgentProfile: "foundation-readonly-plan",
        expectedEvidence: ["surface-map", "tests"],
        providedEvidence: ["surface-map"],
        missingEvidence: ["tests"],
        missingGoalEvidence: ["goal-review"],
        missingVerificationGates: ["managed review"],
        failedVerificationGates: ["typecheck"],
        missingResidualRisk: true,
        pendingPauseRequirementCount: 1,
        referenceRoots: [],
        verificationGates: [],
        pauseRequirements: [],
        executionAttempts: [],
        updatedAt: new Date("2026-06-24T10:00:00.000Z"),
      },
    ];
    const ui = {
      sidebarWorkText: { content: "" },
    };

    renderSidebarWork(state, defaultTheme, ui as never);

    expect(ui.sidebarWorkText.content).toContain("auth:authority:foundation-readonly-plan");
    expect(ui.sidebarWorkText.content).toContain("missing:tests");
    expect(ui.sidebarWorkText.content).toContain("missing-goal:goal-review");
    expect(ui.sidebarWorkText.content).toContain("missing-gates:managed review");
    expect(ui.sidebarWorkText.content).toContain("failed-gates:typecheck");
    expect(ui.sidebarWorkText.content).toContain("missing:residual-risk");
    expect(ui.sidebarWorkText.content).toContain("res:kiln://session/work-items/work-visible");
  });
});
