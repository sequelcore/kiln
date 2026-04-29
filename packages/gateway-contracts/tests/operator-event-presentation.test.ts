import { describe, expect, it } from "vitest";
import { formatOperatorEventValue, presentOperatorEventPayload } from "../src/operator-event-presentation.js";

describe("operator event presentation", () => {
  it("presents provider routing without exposing raw payload syntax", () => {
    const presentation = presentOperatorEventPayload("provider_routed", {
      provider: {
        provider: "codex-oauth",
        model: "gpt-5.5",
      },
      reason: "Explicit model override",
    });

    expect(presentation.title).toBe("Provider routed");
    expect(presentation.summary).toBe("codex-oauth · gpt-5.5");
    expect(presentation.details).toEqual([
      { label: "Provider", value: "codex-oauth" },
      { label: "Model", value: "gpt-5.5" },
      { label: "Why", value: "Explicit model override" },
    ]);
    expect(JSON.stringify(presentation.details)).not.toContain("\\\"provider\\\"");
  });

  it("presents turn completion nested data as operator detail rows", () => {
    const presentation = presentOperatorEventPayload("turn_completed", {
      routedProvider: "codex-oauth",
      routedModel: "gpt-5.4-mini",
      outcome: "completed",
      runtimeContinuity: {
        strategy: "fallback-replay",
        selectionReason: "no-sources",
      },
      authorityStatus: {
        effective: "destructive",
      },
      inputTokens: 1398,
      outputTokens: 11,
    });

    expect(presentation.details).toEqual([
      { label: "Provider", value: "codex-oauth" },
      { label: "Model", value: "gpt-5.4-mini" },
      { label: "Outcome", value: "completed" },
      { label: "Continuity", value: "fallback-replay" },
      { label: "Why", value: "no-sources" },
      { label: "Authority", value: "destructive" },
      { label: "Input tokens", value: "1398" },
      { label: "Output tokens", value: "11" },
    ]);
  });

  it("formats nested values as structured values for compact surfaces", () => {
    expect(formatOperatorEventValue({ nested: true })).toBe("Structured value");
  });
});
