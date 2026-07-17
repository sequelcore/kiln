import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NativeWorkItemsPanel } from "../src/renderer/native-work-items-panel.js";

describe("native work items panel", () => {
  it("renders authority, resource, and missing evidence state", () => {
    const markup = renderToStaticMarkup(
      <NativeWorkItemsPanel
        items={[
          {
            id: "work-visible",
            resourceUri: "kiln://session/work-items/work-visible",
            summary: "Audit native work item visibility.",
            status: "blocked",
            workflowProfile: "verification-heavy",
            authorityProfile: "authority:foundation-readonly-plan",
            assignedAgentProfile: "foundation-readonly-plan",
            expectedEvidence: ["surface-map", "tests"],
            providedEvidence: ["surface-map"],
            missingEvidence: ["tests", "residual-risk"],
            pendingPauseRequirementCount: 1,
            updatedAt: "2026-06-24T10:00:00.000Z",
          },
        ]}
      />,
    );

    expect(markup).toContain("work-visible");
    expect(markup).toContain("authority:foundation-readonly-plan");
    expect(markup).toContain("kiln://session/work-items/work-visible");
    expect(markup).toContain("Missing: tests, residual-risk");
    expect(markup).toContain("Pause requirements");
    expect(markup).toContain("<dd>1</dd>");
  });
});
