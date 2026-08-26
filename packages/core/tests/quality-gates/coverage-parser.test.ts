import { describe, it, expect } from "vitest";
import { parseCoverageFromOutput, checkCoverage } from "../../src/quality-gates/coverage-parser.js";

describe("parseCoverageFromOutput", () => {
  it("parses pytest-cov format", () => {
    const output = "TOTAL    500    100    80%";
    expect(parseCoverageFromOutput(output)).toBe(80);
  });

  it("parses Jest/Vitest format", () => {
    const output = "All files | 85.5 | 90 | 80 | 87.3";
    expect(parseCoverageFromOutput(output)).toBe(87.3);
  });

  it("parses Go coverage format", () => {
    const output = "coverage: 92.5% of statements";
    expect(parseCoverageFromOutput(output)).toBe(92.5);
  });

  it("returns null for no coverage info", () => {
    const output = "all tests passed";
    expect(parseCoverageFromOutput(output)).toBeNull();
  });
});

describe("checkCoverage", () => {
  it("passes when above threshold", () => {
    const result = checkCoverage("TOTAL    500    75    85%", 80);
    expect(result.passed).toBe(true);
    expect(result.coverage).toBe(85);
  });

  it("fails when below threshold", () => {
    const result = checkCoverage("TOTAL    500    125    75%", 80);
    expect(result.passed).toBe(false);
    expect(result.coverage).toBe(75);
  });
});
