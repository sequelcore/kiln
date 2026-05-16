import { describe, expect, it } from "vitest";
import { guiOutboundMessageParts } from "../../src/gateway/gui-frame-parts.js";

describe("guiOutboundMessageParts", () => {
  it("uses explicit audio parts for voice-only GUI turns", () => {
    const parts = [
      { type: "audio", mimeType: "audio/webm", data: "YWJj" },
    ];

    expect(guiOutboundMessageParts({
      type: "message",
      content: "",
      parts,
    })).toEqual(parts);
  });

  it("prepends text content when the explicit parts do not include text", () => {
    expect(guiOutboundMessageParts({
      type: "message",
      content: "describe this",
      parts: [
        { type: "audio", mimeType: "audio/webm", data: "YWJj" },
      ],
    })).toEqual([
      { type: "text", text: "describe this" },
      { type: "audio", mimeType: "audio/webm", data: "YWJj" },
    ]);
  });
});
