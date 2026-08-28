import { describe, expect, it } from "vitest";
import { toStrictToolSchema } from "../../../../src/agents/provider-adapters/openai-tool-protocol/strict-tool-schema.js";

describe("toStrictToolSchema", () => {
  it("rejects provider-unsupported oneOf schemas locally with their exact path", () => {
    expect(() => toStrictToolSchema({
      type: "object",
      properties: {
        contractAuthority: {
          type: "object",
          oneOf: [
            { type: "object", properties: { kind: { const: "operator" } } },
            { type: "object", properties: { kind: { const: "approved_plan" } } },
          ],
        },
      },
    })).toThrowError('OpenAI strict tool schema does not support "oneOf" at $.properties.contractAuthority.');
  });
});
