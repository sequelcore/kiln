import { describe, expect, it } from "vitest";
import { projectBfclDataset } from "../../src/index.js";

describe("projectBfclDataset", () => {
  it("projects normalized BFCL rows into Kiln benchmark dataset items", () => {
    const result = projectBfclDataset({
      datasetName: "bfcl-simple",
      content: JSON.stringify([
        {
          id: "case-1",
          question: "What is the weather in Tijuana?",
          function: JSON.stringify([
            {
              name: "get_weather",
              parameters: {
                type: "object",
                properties: { city: { type: "string" } },
              },
            },
          ]),
          ground_truth: [
            {
              name: "get_weather",
              arguments: { city: "Tijuana" },
            },
          ],
        },
      ]),
    });

    expect(result.unsupportedRows).toEqual([]);
    expect(result.dataset.items).toHaveLength(1);
    expect(result.dataset.items[0]).toMatchObject({
      id: "case-1",
      metadata: {
        benchmark: "bfcl",
        expectedAgentId: "kiln-tool-agent",
        expectedToolCalls: [
          {
            name: "get_weather",
            args: { city: "Tijuana" },
          },
        ],
      },
    });
    expect(result.dataset.items[0]?.input).toContain("Available tools:");
  });

  it("fails closed by reporting rows without supported expected calls", () => {
    const result = projectBfclDataset({
      datasetName: "bfcl-unsupported",
      content: JSON.stringify([
        {
          id: "case-1",
          question: "Just chat.",
          ground_truth: "not-json-call-syntax()",
        },
      ]),
    });

    expect(result.dataset.items).toHaveLength(0);
    expect(result.unsupportedRows).toEqual([{
      index: 0,
      id: "case-1",
      reason: "missing supported ground_truth/answer tool calls",
    }]);
  });
});
