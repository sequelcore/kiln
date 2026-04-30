import { describe, expect, it } from "vitest";
import type {
  ToolResourceDescriptor,
  ToolResourceDisplayDescriptor,
  ToolResourceReadResult,
} from "../src/index.js";

describe("resource SDK exports", () => {
  it("exports resource registry and display contracts for consumer code", () => {
    const descriptor: ToolResourceDescriptor = {
      uri: "kiln://tools/catalog",
      name: "tool_catalog",
      mimeType: "application/json",
    };
    const display: ToolResourceDisplayDescriptor = {
      uri: descriptor.uri,
      mimeType: descriptor.mimeType,
    };
    const readResult: ToolResourceReadResult = {
      contents: [{ uri: descriptor.uri, mimeType: descriptor.mimeType, text: "{}" }],
    };

    expect(display.uri).toBe("kiln://tools/catalog");
    expect(readResult.contents[0]?.uri).toBe(descriptor.uri);
  });
});
