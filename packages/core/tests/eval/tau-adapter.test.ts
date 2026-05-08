import { describe, expect, it } from "vitest";
import { projectTauDataset } from "../../src/index.js";

describe("projectTauDataset", () => {
  it("projects structured tau workflow rows into Kiln dataset items", () => {
    const result = projectTauDataset({
      datasetName: "tau-retail",
      content: JSON.stringify({
        tasks: [{
          id: "retail-1",
          domain: "retail",
          user_task: "Cancel order O-1 if policy allows.",
          policy: "Orders may be cancelled before shipment.",
          user_turns: ["I want to cancel O-1."],
          tools: [{ name: "cancel_order" }],
          expected_actions: [{ action: "cancel_order", parameters: { order_id: "O-1" } }],
          expected_outcome: "Order O-1 cancelled.",
        }],
      }),
    });

    expect(result.unsupportedRows).toEqual([]);
    expect(result.dataset.items[0]).toMatchObject({
      id: "retail-1",
      expected: "Order O-1 cancelled.",
      metadata: {
        benchmark: "tau",
        domain: "retail",
        expectedAgentId: "kiln-tool-agent",
        expectedToolCalls: [{ name: "cancel_order", args: { order_id: "O-1" } }],
      },
    });
    expect(result.dataset.items[0]?.input).toContain("User turns:");
  });
});
