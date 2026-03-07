import { describe, it, expect, vi } from "vitest";
import { ToolResultSanitizer } from "../../src/safety/tool-result-sanitizer.js";
import type { SafetyPipeline } from "../../src/safety/safety-pipeline.js";
import type { SafetyPipelineResult } from "../../src/safety/types.js";

function makePipeline(evaluateResult: SafetyPipelineResult): SafetyPipeline {
  return {
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
    metrics: { scansInput: 0, scansOutput: 0, blocksInput: 0, blocksOutput: 0, piiDetections: 0, contentBlocks: 0, policyEvaluations: 0 },
  } as unknown as SafetyPipeline;
}

describe("ToolResultSanitizer", () => {
  it("passes through clean content unchanged", async () => {
    const pipeline = makePipeline({ allowed: true, policyResults: [] });
    const sanitizer = new ToolResultSanitizer(pipeline);

    const result = await sanitizer.sanitize("Hello world");

    expect(result.content).toBe("Hello world");
    expect(result.sanitized).toBe(false);
    expect(result.blocked).toBe(false);
  });

  it("returns redacted text when PII is detected", async () => {
    const pipeline = makePipeline({
      allowed: true,
      policyResults: [],
      redactedText: "User [REDACTED_EMAIL] contacted us",
    });
    const sanitizer = new ToolResultSanitizer(pipeline);

    const result = await sanitizer.sanitize("User john@example.com contacted us");

    expect(result.content).toBe("User [REDACTED_EMAIL] contacted us");
    expect(result.sanitized).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it("blocks content when safety pipeline blocks", async () => {
    const pipeline = makePipeline({
      allowed: false,
      policyResults: [],
      blockReason: "Content contains prohibited material",
    });
    const sanitizer = new ToolResultSanitizer(pipeline);

    const result = await sanitizer.sanitize("Some prohibited content");

    expect(result.content).toBe("Content contains prohibited material");
    expect(result.sanitized).toBe(true);
    expect(result.blocked).toBe(true);
  });

  it("uses default block message when no blockReason", async () => {
    const pipeline = makePipeline({
      allowed: false,
      policyResults: [],
    });
    const sanitizer = new ToolResultSanitizer(pipeline);

    const result = await sanitizer.sanitize("Bad content");

    expect(result.content).toBe("Tool result blocked by safety pipeline");
    expect(result.blocked).toBe(true);
  });

  it("fail-open: returns original result when pipeline throws", async () => {
    const pipeline = {
      evaluate: vi.fn().mockRejectedValue(new Error("Pipeline crashed")),
    } as unknown as SafetyPipeline;
    const sanitizer = new ToolResultSanitizer(pipeline);

    const result = await sanitizer.sanitize("Original content");

    expect(result.content).toBe("Original content");
    expect(result.sanitized).toBe(false);
    expect(result.blocked).toBe(false);
  });

  it("calls pipeline with 'output' direction", async () => {
    const evaluateFn = vi.fn().mockResolvedValue({ allowed: true, policyResults: [] });
    const pipeline = { evaluate: evaluateFn } as unknown as SafetyPipeline;
    const sanitizer = new ToolResultSanitizer(pipeline);

    await sanitizer.sanitize("test content");

    expect(evaluateFn).toHaveBeenCalledWith("test content", "output");
  });
});
