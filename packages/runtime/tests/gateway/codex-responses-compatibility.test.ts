import { describe, expect, it } from "vitest";
import {
  CODEX_RESPONSES_COMPATIBILITY,
  evaluateCodexResponsesNativeClient,
} from "../../src/gateway/codex-responses-compatibility.js";

describe("Codex Responses compatibility", () => {
  it("admits only native client versions proven against the exact wire revision", () => {
    expect(evaluateCodexResponsesNativeClient("0.147.0")).toEqual({
      status: "compatible",
      observedVersion: "0.147.0",
      protocolRevision: CODEX_RESPONSES_COMPATIBILITY.revision,
    });
    expect(evaluateCodexResponsesNativeClient("0.148.0")).toEqual({
      status: "unsupported",
      observedVersion: "0.148.0",
      protocolRevision: CODEX_RESPONSES_COMPATIBILITY.revision,
      supportedVersions: ["0.147.0"],
    });
  });

  it("reports an unobservable client without fabricating a version", () => {
    expect(evaluateCodexResponsesNativeClient()).toEqual({
      status: "unobservable",
      protocolRevision: CODEX_RESPONSES_COMPATIBILITY.revision,
      supportedVersions: ["0.147.0"],
    });
  });
});
