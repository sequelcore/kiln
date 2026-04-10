import { describe, expect, it } from "vitest";
import {
  buildCliPlanSummaryArtifactKey,
  buildCliPlanSummaryArtifactKeyFromShape,
  buildCliProjectSummaryArtifactKey,
  buildCliSessionSummaryArtifactKey,
} from "../../src/application/context-artifact-keys.js";

describe("context-artifact-keys", () => {
  it("builds session summary key", () => {
    expect(buildCliSessionSummaryArtifactKey("sess-123")).toBe("session-summary:sess-123");
  });

  it("builds project summary key", () => {
    expect(buildCliProjectSummaryArtifactKey("C:/repo")).toBe("project-summary:C:/repo");
  });

  it("builds plan summary key with normalized task shape", () => {
    expect(buildCliPlanSummaryArtifactKey("C:/repo", " Build API + UI ", 80)).toBe(
      "plan-summary:C:/repo:build-api-ui",
    );
  });

  it("builds plan summary key from provided task shape", () => {
    expect(buildCliPlanSummaryArtifactKeyFromShape("C:/repo", "interactive")).toBe(
      "plan-summary:C:/repo:interactive",
    );
  });
});
