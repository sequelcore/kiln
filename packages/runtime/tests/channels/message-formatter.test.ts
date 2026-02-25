import { describe, it, expect } from "vitest";
import { formatForChannel } from "../../src/channels/message-formatter.js";

describe("formatForChannel", () => {
  const markdownContent = "## Hello\n\n**Bold** and *italic* with `code` and [link](http://x.com)\n\n```js\nconsole.log('hi');\n```\n\n- Item 1\n- Item 2";

  it("strips markdown for short format", () => {
    const result = formatForChannel(markdownContent, "short");

    expect(result).not.toContain("##");
    expect(result).not.toContain("**");
    expect(result).not.toContain("*italic*");
    expect(result).not.toContain("`code`");
    expect(result).not.toContain("[link]");
    expect(result).toContain("Hello");
    expect(result).toContain("Bold");
    expect(result).toContain("code");
    expect(result).toContain("link");
    expect(result).toContain("[code block]");
  });

  it("truncates short format to 4096 chars", () => {
    const long = "a".repeat(5000);
    const result = formatForChannel(long, "short");
    expect(result.length).toBeLessThanOrEqual(4096);
  });

  it("preserves full markdown for full format", () => {
    const result = formatForChannel(markdownContent, "full");
    expect(result).toBe(markdownContent);
  });

  it("returns as-is for structured format", () => {
    const json = JSON.stringify({ data: [1, 2, 3] });
    const result = formatForChannel(json, "structured");
    expect(result).toBe(json);
  });
});

describe("formatForChannel edge cases", () => {
  it("handles empty string", () => {
    expect(formatForChannel("", "short")).toBe("");
    expect(formatForChannel("", "full")).toBe("");
    expect(formatForChannel("", "structured")).toBe("");
  });

  it("handles plain text with no markdown", () => {
    const plain = "Just some plain text.";
    expect(formatForChannel(plain, "short")).toBe(plain);
  });
});
