import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChangedFilesPanel } from "../src/components/changed-files-panel.js";

describe("ChangedFilesPanel", () => {
  it("renders file entries and shows selected file review details", () => {
    render(
      <ChangedFilesPanel
        onStartNewSession={() => undefined}
        files={[
          {
            path: "packages/gui/src/components/app-shell.tsx",
            changeType: "modified",
            linesAdded: 24,
            linesRemoved: 9,
            diffPreview: "- old line\n+ new line",
            recordedAt: "2026-04-23T18:00:00.000Z",
          },
          {
            path: "packages/gui/src/components/transcript.tsx",
            changeType: "created",
            linesAdded: 120,
            recordedAt: "2026-04-23T18:05:00.000Z",
          },
        ]}
      />,
    );

    const review = screen.getByLabelText("Selected file review");
    expect(within(review).getByText("packages/gui/src/components/app-shell.tsx")).toBeInTheDocument();
    expect(within(review).getByText("- old line")).toBeInTheDocument();
    expect(within(review).getByText("+ new line")).toBeInTheDocument();
    expect(within(review).queryByText("Diff preview is not available for this file-change event.")).not.toBeInTheDocument();
    expect(
      within(review).getByText("Diff preview"),
    ).toBeInTheDocument();
    expect(within(review).getByText("+24-9")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /packages\/gui\/src\/components\/transcript\.tsx/i }));

    expect(within(review).getByText("packages/gui/src/components/transcript.tsx")).toBeInTheDocument();
    expect(within(review).getByText("Created")).toBeInTheDocument();
    expect(within(review).getByText("+120")).toBeInTheDocument();
    expect(within(review).getByText("Diff preview is not available for this file-change event.")).toBeInTheDocument();
  });

  it("exposes the new-session action from the review panel", () => {
    const onStartNewSession = vi.fn();
    render(
      <ChangedFilesPanel
        onStartNewSession={onStartNewSession}
        files={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New Session" }));
    expect(onStartNewSession).toHaveBeenCalledTimes(1);
  });
});
