import { describe, expect, it } from "vitest";
import {
  VISION_ANALYZE_CAPABILITY_ID,
  VISION_ANALYZE_CONTRACT,
  VISION_ANALYZE_TOOL_NAME,
  VISION_ANALYZE_INPUT_SCHEMA,
  VISION_ANALYSIS_OUTPUT_SCHEMA,
  parseVisionAnalyzeInput,
  parseVisionAnalysis,
} from "../../src/capabilities/vision-analysis-capability.js";

const IMAGE_URI = "kiln://artifacts/inbound-multimodal/image-1";
const EVIDENCE_URI = "kiln://managed-agents/invocations/vision-1/resources/evidence-1";

describe("vision.analyze capability contract", () => {
  it("freezes the provider-neutral identity and strict schemas", () => {
    expect(VISION_ANALYZE_CAPABILITY_ID).toBe("vision.analyze");
    expect(VISION_ANALYZE_CONTRACT).toBe("vision.analyze/v1");
    expect(VISION_ANALYZE_TOOL_NAME).toBe("vision_analyze");
    expect(VISION_ANALYZE_INPUT_SCHEMA).toMatchObject({
      type: "object",
      required: ["resourceUris", "instruction"],
      additionalProperties: false,
    });
    expect(VISION_ANALYSIS_OUTPUT_SCHEMA).toMatchObject({
      type: "object",
      required: ["status", "summary", "uncertainty", "limitations", "evidenceUris"],
      additionalProperties: false,
    });
  });

  it("normalizes and snapshots a valid input and output", () => {
    const inputSource = { resourceUris: [IMAGE_URI], instruction: "Describe the primary subject." };
    const outputSource = {
      status: "completed",
      summary: "A landscape image with a mountain in the distance.",
      uncertainty: 0.2,
      limitations: ["Fine text is not legible."],
      evidenceUris: [EVIDENCE_URI],
    };

    const input = parseVisionAnalyzeInput(inputSource);
    const output = parseVisionAnalysis(outputSource);

    expect(input).toEqual(inputSource);
    expect(output).toEqual(outputSource);
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.resourceUris)).toBe(true);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.limitations)).toBe(true);
    expect(Object.isFrozen(output.evidenceUris)).toBe(true);
    inputSource.resourceUris.push("kiln://artifacts/other");
    inputSource.instruction = "changed";
    expect(input.resourceUris).toEqual([IMAGE_URI]);
    expect(input.instruction).toBe("Describe the primary subject.");
  });

  it("allows completed analyses with no limitations or evidence", () => {
    expect(parseVisionAnalysis({
      status: "completed",
      summary: "No visual limitations were observed.",
      uncertainty: 0,
      limitations: [],
      evidenceUris: [],
    })).toEqual({
      status: "completed",
      summary: "No visual limitations were observed.",
      uncertainty: 0,
      limitations: [],
      evidenceUris: [],
    });
  });

  it.each([
    ["input unknown field", () => parseVisionAnalyzeInput({ resourceUris: [IMAGE_URI], instruction: "ok", extra: true })],
    ["input malformed URI", () => parseVisionAnalyzeInput({ resourceUris: ["https://example.invalid/image"], instruction: "ok" })],
    ["input empty resource list", () => parseVisionAnalyzeInput({ resourceUris: [], instruction: "ok" })],
    ["input empty instruction", () => parseVisionAnalyzeInput({ resourceUris: [IMAGE_URI], instruction: "   " })],
    ["output unknown field", () => parseVisionAnalysis({
      status: "completed",
      summary: "ok",
      uncertainty: 0,
      limitations: [],
      evidenceUris: [EVIDENCE_URI],
      extra: true,
    })],
    ["output non-completed status", () => parseVisionAnalysis({
      status: "failed",
      summary: "ok",
      uncertainty: 0,
      limitations: [],
      evidenceUris: [EVIDENCE_URI],
    })],
    ["output non-finite uncertainty", () => parseVisionAnalysis({
      status: "completed",
      summary: "ok",
      uncertainty: Number.NaN,
      limitations: [],
      evidenceUris: [EVIDENCE_URI],
    })],
    ["output out-of-range uncertainty", () => parseVisionAnalysis({
      status: "completed",
      summary: "ok",
      uncertainty: 1.01,
      limitations: [],
      evidenceUris: [EVIDENCE_URI],
    })],
  ] as const)("rejects %s", (_label, parse) => {
    expect(parse).toThrow();
  });

  it("rejects empty or oversized bounded strings and lists", () => {
    expect(() => parseVisionAnalyzeInput({ resourceUris: [IMAGE_URI], instruction: "x".repeat(4_097) })).toThrow();
    expect(() => parseVisionAnalysis({
      status: "completed",
      summary: "x".repeat(8_193),
      uncertainty: 0.5,
      limitations: [],
      evidenceUris: [EVIDENCE_URI],
    })).toThrow();
    expect(() => parseVisionAnalysis({
      status: "completed",
      summary: "ok",
      uncertainty: 0.5,
      limitations: [""],
      evidenceUris: [EVIDENCE_URI],
    })).toThrow();
  });
});
