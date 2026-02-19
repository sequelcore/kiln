import { describe, it, expect } from "vitest";
import { formatSdkMessage, formatForChannel } from "../../src/channels/message-formatter.js";

describe("formatSdkMessage", () => {
  it("formats system/init message", () => {
    const result = formatSdkMessage({ type: "system/init", model: "claude-sonnet-4-6" });

    expect(result).not.toBeNull();
    expect(result!.text).toBe("[system] Model: claude-sonnet-4-6");
    expect(result!.stream).toBe("system");
  });

  it("formats assistant/text message", () => {
    const result = formatSdkMessage({ type: "assistant/text", text: "Hello world" });

    expect(result).not.toBeNull();
    expect(result!.text).toBe("Hello world");
    expect(result!.stream).toBe("stdout");
  });

  it("formats assistant/tool_use message", () => {
    const result = formatSdkMessage({ type: "assistant/tool_use", name: "Read", input: {} });

    expect(result).not.toBeNull();
    expect(result!.text).toBe("[tool] Read");
    expect(result!.stream).toBe("system");
  });

  it("formats assistant/tool_result with short output", () => {
    const result = formatSdkMessage({
      type: "assistant/tool_result",
      name: "Read",
      output: "file contents",
    });

    expect(result).not.toBeNull();
    expect(result!.text).toBe("[tool result] Read: file contents");
    expect(result!.stream).toBe("system");
  });

  it("truncates long tool result output", () => {
    const longOutput = "x".repeat(300);
    const result = formatSdkMessage({
      type: "assistant/tool_result",
      name: "Bash",
      output: longOutput,
    });

    expect(result).not.toBeNull();
    expect(result!.text.length).toBeLessThan(250);
    expect(result!.text).toContain("...");
  });

  it("formats result/success message", () => {
    const result = formatSdkMessage({ type: "result/success", result: "Done" });

    expect(result).not.toBeNull();
    expect(result!.text).toBe("[result] Done");
    expect(result!.stream).toBe("system");
  });

  it("formats result/error message", () => {
    const result = formatSdkMessage({ type: "result/error", error: "Failed" });

    expect(result).not.toBeNull();
    expect(result!.text).toBe("[error] Failed");
    expect(result!.stream).toBe("stderr");
  });

  it("returns null for unknown message type", () => {
    const result = formatSdkMessage({ type: "unknown_type" });
    expect(result).toBeNull();
  });

  it("handles missing optional fields", () => {
    const init = formatSdkMessage({ type: "system/init" });
    expect(init!.text).toBe("[system] Model: unknown");

    const text = formatSdkMessage({ type: "assistant/text" });
    expect(text!.text).toBe("");

    const tool = formatSdkMessage({ type: "assistant/tool_use" });
    expect(tool!.text).toBe("[tool] unknown");
  });

  it("includes timestamp on all output lines", () => {
    const before = Date.now();
    const result = formatSdkMessage({ type: "assistant/text", text: "hi" });
    const after = Date.now();

    expect(result!.timestamp).toBeGreaterThanOrEqual(before);
    expect(result!.timestamp).toBeLessThanOrEqual(after);
  });
});

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
