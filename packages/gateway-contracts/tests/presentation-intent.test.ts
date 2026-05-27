import { describe, expect, it } from "vitest";
import {
  formatPresentationIntentAsText,
  parsePresentationIntent,
} from "../src/presentation-intent.js";

describe("presentation intent contract", () => {
  it("accepts closed comparison table intents and formats deterministic text fallback", () => {
    const parsed = parsePresentationIntent({
      kind: "comparison_table",
      title: "Managed child comparison",
      summary: "3 child routes compared",
      source: "managed_agent.invoke",
      confidence: "high",
      columns: [
        { key: "routeId", label: "Route" },
        { key: "provider", label: "Provider" },
        { key: "substantiveEvidence", label: "Evidence", valueKind: "boolean" },
      ],
      rows: [
        { routeId: "codex-oauth-readonly", provider: "codex-oauth", substantiveEvidence: true },
        { routeId: "opencode-readonly", provider: "opencode", substantiveEvidence: false },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(formatPresentationIntentAsText(parsed.intent)).toContain("| Route                | Provider    | Evidence |");
    expect(formatPresentationIntentAsText(parsed.intent)).toContain("| codex-oauth-readonly | codex-oauth | yes      |");
    expect(formatPresentationIntentAsText(parsed.intent)).toContain("| opencode-readonly    | opencode    | no       |");
  });

  it("preserves evidence-bearing suffixes when compacting long comparison cells", () => {
    const parsed = parsePresentationIntent({
      kind: "comparison_table",
      title: "Managed child invocation",
      source: "managed_agent.invoke",
      confidence: "medium",
      columns: [
        { key: "failureReason", label: "Failure" },
      ],
      rows: [
        { failureReason: "Managed invocation denied skill(s): workspace-write" },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(formatPresentationIntentAsText(parsed.intent)).toContain("workspace-write");
  });

  it("escapes pipe delimiters after compacting long comparison cells", () => {
    const parsed = parsePresentationIntent({
      kind: "comparison_table",
      title: "Managed child invocation",
      source: "managed_agent.invoke",
      confidence: "medium",
      columns: [
        { key: "failureReason", label: "Failure" },
      ],
      rows: [
        { failureReason: `${"a".repeat(28)}|${"b".repeat(14)}` },
      ],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const formatted = formatPresentationIntentAsText(parsed.intent);
    expect(formatted).toContain("...\\|bbbb");
    expect(formatted).not.toContain("...|bbbb");
  });

  it("rejects executable or unknown presentation shapes", () => {
    expect(parsePresentationIntent({
      kind: "html",
      title: "Unsafe",
      html: "<script>alert(1)</script>",
    }).ok).toBe(false);

    expect(parsePresentationIntent({
      kind: "summary",
      title: "Unsafe",
      summary: "looks normal",
      component: "ArbitraryReactComponent",
    }).ok).toBe(false);

    expect(parsePresentationIntent({
      kind: "resource_bundle",
      title: "Unsafe links",
      resources: [{
        uri: "javascript:alert(1)",
        title: "run",
      }],
    }).ok).toBe(false);
  });
});
