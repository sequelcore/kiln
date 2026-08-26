import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VerificationEvidence } from "../src/components/verification-evidence.js";

describe("VerificationEvidence", () => {
  it("renders TypeScript quality evidence without presenting it as an overall pass", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    render(
      <VerificationEvidence
        verification={{
          kind: "quality",
          engine: {
            name: "kiln-quality",
            version: "3.0.0-beta.1",
            parser: { name: "@typescript/typescript6", version: "6.0.3" },
          },
          candidate: { digest, subjects: [{ path: "src/value.ts", contentDigest: digest }] },
          artifactKind: "typescript",
          outcome: "diagnostics",
          profiles: [
            {
              name: "type-integrity",
              revision: "v1",
              rules: [
                { name: "chained-type-assertion", revision: "v1" },
                { name: "widen-then-assert", revision: "v1" },
              ],
              diagnostics: [
                {
                  rule: { name: "widen-then-assert", revision: "v1" },
                  message: "Avoid widening through unknown.",
                  line: 1,
                  column: 20,
                },
              ],
            },
            {
              name: "complexity",
              revision: "v1",
              rules: [{ name: "high-cyclomatic-complexity", revision: "v1" }],
              diagnostics: [
                {
                  rule: { name: "high-cyclomatic-complexity", revision: "v1" },
                  message: "route has cyclomatic complexity 21; review its control flow.",
                  line: 4,
                  column: 1,
                },
              ],
            },
            {
              name: "test-integrity",
              revision: "v1",
              rules: [
                { name: "focused-test", revision: "v1" },
                { name: "empty-test-body", revision: "v1" },
              ],
              diagnostics: [],
            },
          ],
          authority: { kind: "evidence_only", establishes: [] },
        }}
      />,
    );
    expect(screen.getByText("Kiln Quality 3.0.0-beta.1")).toBeInTheDocument();
    expect(document.querySelector('[data-verification-engine-fallback="kiln-quality"]')).toHaveTextContent("KQ");
    expect(screen.getByText("type-integrity/v1")).toBeInTheDocument();
    expect(screen.getByText("complexity/v1")).toBeInTheDocument();
    expect(screen.getByText("test-integrity/v1")).toBeInTheDocument();
    expect(screen.getAllByText("high-cyclomatic-complexity/v1")).toHaveLength(2);
    expect(screen.getByText("widen-then-assert/v1")).toBeInTheDocument();
    expect(screen.getByText("Assurance is a separate decision")).toBeInTheDocument();
    expect(screen.queryByText(/quality passed/iu)).not.toBeInTheDocument();
  });
});
