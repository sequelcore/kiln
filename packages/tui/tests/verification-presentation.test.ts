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
      profile: { id: "oxlint.sequel-typescript/v1", rulesAnalyzed: 106 },
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
      engine: { name: "gentle-ai", version: "2.5.0-rc.1" },
      candidate: { digest, subjects: [{ path: "policy.ts" }] },
      outcome: { applicability: "current_target", action: "collect", replayability: "exact", nextTransition: { kind: "collect", reasonCode: "review_pending" } },
      transaction: { lineageId: "review-demo", state: "reviewing", generation: 1, revision: digest },
      authority: { kind: "evidence_only", establishes: [] },
    };

    const output = formatVerificationPresentationAsText(verification);
    expect(output).toContain("current target · Gentle AI 2.5.0-rc.1");
    expect(output).toContain("state reviewing · action collect · replay exact");
    expect(output).toContain("next collect · review_pending");
    expect(output).toContain("review-demo");
    expect(output).toContain("state reviewing");
    expect(output).not.toMatch(/approved|receipt|findings/iu);
  });

  it("formats quality profiles, parser provenance, and diagnostics", () => {
    const digest = `sha256:${"d".repeat(64)}`;
    const verification: ToolResultVerificationPresentation = {
      kind: "quality",
      engine: { name: "kiln-quality", version: "3.0.0-beta.1", parser: { name: "@typescript/typescript6", version: "6.0.3" } },
      candidate: { digest, subjects: [{ path: "policy.ts", contentDigest: digest }] },
      artifactKind: "typescript",
      outcome: "diagnostics",
      profiles: [
        { name: "type-integrity", revision: "v1", rules: [{ name: "chained-type-assertion", revision: "v1" }, { name: "widen-then-assert", revision: "v1" }], diagnostics: [{ rule: { name: "widen-then-assert", revision: "v1" }, message: "Avoid widening through unknown.", line: 3, column: 14 }] },
        { name: "complexity", revision: "v1", rules: [{ name: "high-cyclomatic-complexity", revision: "v1" }], diagnostics: [{ rule: { name: "high-cyclomatic-complexity", revision: "v1" }, message: "route has cyclomatic complexity 21.", line: 5, column: 1 }] },
        { name: "test-integrity", revision: "v1", rules: [{ name: "focused-test", revision: "v1" }, { name: "empty-test-body", revision: "v1" }], diagnostics: [] },
      ],
      authority: { kind: "evidence_only", establishes: [] },
    };
    const output = formatVerificationPresentationAsText(verification);
    expect(output).toContain("diagnostics · Kiln Quality 3.0.0-beta.1");
    expect(output).toContain("type-integrity/v1 · 2 rules");
    expect(output).toContain("widen-then-assert/v1 · policy.ts:3:14");
    expect(output).toContain("complexity/v1 · 1 rules");
    expect(output).toContain("high-cyclomatic-complexity/v1 · policy.ts:5:1");
    expect(output).toContain("test-integrity/v1 · 2 rules");
    expect(output).toContain("Assurance: separate decision · evidence only");
    expect(output).not.toMatch(/quality passed/iu);
  });
});
