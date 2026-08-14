import { describe, expect, it } from "vitest";
import { evaluateCodexDesktopHistoryCompatibility } from "./codex-desktop-history-compatibility.js";

describe("Codex Desktop custom-provider history compatibility", () => {
  it("reports the observed 0.147 custom-provider history defect without claiming data loss", () => {
    expect(
      evaluateCodexDesktopHistoryCompatibility({
        modelProvider: "kiln",
        nativeClientVersion: "0.147.0",
      }),
    ).toEqual({
      status: "known-degraded",
      nativeClientVersion: "0.147.0",
      issueUrl: "https://github.com/openai/codex/issues/28957",
      diagnostic: "codex-desktop-custom-provider-history-degraded",
    });
  });

  it("keeps future custom-provider versions unverified until a live Desktop proof exists", () => {
    expect(
      evaluateCodexDesktopHistoryCompatibility({
        modelProvider: "kiln",
        nativeClientVersion: "0.148.0",
      }),
    ).toMatchObject({
      status: "unverified",
      diagnostic: "codex-desktop-custom-provider-history-unverified",
    });
  });

  it("does not claim a Desktop version from CLI-only evidence", () => {
    expect(evaluateCodexDesktopHistoryCompatibility({ modelProvider: "kiln" })).toMatchObject({
      status: "unobservable",
      diagnostic: "codex-desktop-custom-provider-history-unobservable",
    });
  });

  it("does not apply the limitation to the built-in provider", () => {
    expect(
      evaluateCodexDesktopHistoryCompatibility({
        modelProvider: "openai",
        nativeClientVersion: "0.147.0",
      }),
    ).toEqual({ status: "not-applicable" });
  });
});
