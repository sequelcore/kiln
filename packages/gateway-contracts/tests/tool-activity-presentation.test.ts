import { describe, expect, it } from "vitest";
import {
  presentToolActionTitle,
  projectToolActivitySummary,
} from "../src/tool-activity-presentation.js";

describe("tool activity presentation", () => {
  it("uses human action language for repository inspection tools", () => {
    expect(presentToolActionTitle("glob", "running")).toBe("Finding files");
    expect(presentToolActionTitle("tree", "success")).toBe("Mapped repository");
    expect(presentToolActionTitle("stat", "error")).toBe("File inspection failed");
  });

  it("summarizes a completed inspection run without repeating implementation status", () => {
    expect(projectToolActivitySummary([
      { toolName: "tree", tone: "success" },
      { toolName: "glob", tone: "success" },
      { toolName: "read", tone: "success" },
    ])).toEqual({
      actionCount: 3,
      completedCount: 3,
      failedCount: 0,
      label: "Inspected repository",
      state: "completed",
    });
  });

  it("keeps active and failed runs explicit", () => {
    expect(projectToolActivitySummary([
      { toolName: "read", tone: "success" },
      { toolName: "grep", tone: "running" },
    ])).toMatchObject({ label: "Inspecting repository", state: "running" });

    expect(projectToolActivitySummary([
      { toolName: "read", tone: "error" },
      { toolName: "glob", tone: "error" },
    ])).toMatchObject({ label: "Repository inspection needs attention", failedCount: 2, state: "failed" });
  });

  it("falls back to quiet work language for mixed tool categories", () => {
    expect(projectToolActivitySummary([
      { toolName: "read", tone: "success" },
      { toolName: "patch", tone: "success" },
    ])).toMatchObject({ label: "Work completed", state: "completed" });
  });
});
