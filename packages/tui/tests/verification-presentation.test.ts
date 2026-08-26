import { describe, expect, it } from "vitest";
import type { ToolResultVerificationPresentation } from "@kilnai/gateway-contracts";
import { formatVerificationPresentationAsText } from "../src/verification-presentation.js";

describe("TUI verification presentation", () => {
  it("formats formal obligations with proof effort and the Assurance boundary", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const verification: ToolResultVerificationPresentation = {
      kind: "formal",
      engine: { name: "dafny", version: "4.11.0" },
      candidate: { digest, subjects: [{ path: "policy.dfy", contentDigest: digest }] },
      outcome: "refuted",
      totals: { total: 2, proved: 1, refuted: 1, unresolved: 0 },
      checks: [
        { label: "Allow", outcome: "proved", durationMs: 12, resourceCount: 1_840 },
        { label: "Deny", outcome: "refuted", detail: "postcondition might not hold", durationMs: 8, resourceCount: 920 },
      ],
      authority: { kind: "evidence_only", establishes: [] },
    };

    expect(formatVerificationPresentationAsText(verification)).toBe([
      "refuted · Dafny 4.11.0",
      `candidate sha256:${"a".repeat(12)}…${"a".repeat(8)} · policy.dfy`,
      "1/2 obligations proved · 2,760 RU",
      "✓ Allow · 1,840 RU · 12 ms",
      "✗ Deny · 920 RU · 8 ms",
      "  postcondition might not hold",
      "Assurance: separate decision · evidence only",
    ].join("\n"));
  });

  it("formats static diagnostics", () => {
    const digest = `sha256:${"b".repeat(64)}`;
    const verification: ToolResultVerificationPresentation = {
      kind: "static",
      engine: { name: "oxlint", version: "1.80.0" },
      candidate: { digest, subjects: [{ path: "policy.ts", contentDigest: digest }] },
      outcome: "violations",
      profile: { id: "oxlint.correctness+suspicious/v1", rulesAnalyzed: 245 },
      diagnostics: [{ rule: "no-unused-vars", severity: "warning", message: "Unused parameter", file: "policy.ts", line: 4, column: 8 }],
      authority: { kind: "evidence_only", establishes: [] },
    };

    const output = formatVerificationPresentationAsText(verification);
    expect(output).toContain("violations · Oxlint 1.80.0");
    expect(output).toContain("1 diagnostic · 245 rules");
    expect(output).toContain("! no-unused-vars · policy.ts:4:8 · Unused parameter");
    expect(output).toContain("Assurance: separate decision · evidence only");
  });

  it("formats Gentle status without findings or acceptance", () => {
    const digest = `sha256:${"c".repeat(64)}`;
    const verification: ToolResultVerificationPresentation = {
      kind: "inferential",
      engine: { name: "gentle-ai", version: "2.4.0" },
      candidate: { digest, subjects: [{ path: "policy.ts" }] },
      outcome: { applicability: "current_target", action: "collect", replayability: "exact", nextTransition: { kind: "collect", reasonCode: "review_pending" } },
      receipt: { status: "pending" },
      authority: { kind: "evidence_only", establishes: [] },
    };

    const output = formatVerificationPresentationAsText(verification);
    expect(output).toContain("current target · Gentle AI 2.4.0");
    expect(output).toContain("action collect · replay exact · receipt pending");
    expect(output).toContain("next collect · review_pending");
    expect(output).not.toMatch(/approved|findings/iu);
  });
});
