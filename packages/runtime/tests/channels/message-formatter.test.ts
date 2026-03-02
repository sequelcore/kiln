import { describe, it, expect } from "vitest";
import { formatForChannel, toWhatsAppFormat } from "../../src/channels/message-formatter.js";

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

describe("toWhatsAppFormat", () => {
  it("converts bold from **text** to *text*", () => {
    expect(toWhatsAppFormat("**Hello**")).toBe("*Hello*");
  });

  it("converts italic from *text* to _text_", () => {
    expect(toWhatsAppFormat("*Hello*")).toBe("_Hello_");
  });

  it("converts bold and italic together", () => {
    const result = toWhatsAppFormat("**Bold** and *italic*");
    expect(result).toBe("*Bold* and _italic_");
  });

  it("converts strikethrough from ~~text~~ to ~text~", () => {
    expect(toWhatsAppFormat("~~deleted~~")).toBe("~deleted~");
  });

  it("converts headers to bold", () => {
    expect(toWhatsAppFormat("## Section Title")).toBe("*Section Title*");
    expect(toWhatsAppFormat("# Main Title")).toBe("*Main Title*");
    expect(toWhatsAppFormat("### Sub-section")).toBe("*Sub-section*");
  });

  it("converts inline code to WhatsApp monospace", () => {
    expect(toWhatsAppFormat("Use `npm install`")).toBe("Use ```npm install```");
  });

  it("converts fenced code blocks and strips language tag", () => {
    const input = "```javascript\nconsole.log('hi');\n```";
    const result = toWhatsAppFormat(input);
    expect(result).toContain("```");
    expect(result).not.toContain("javascript");
    expect(result).toContain("console.log('hi');");
  });

  it("converts links to text (url)", () => {
    expect(toWhatsAppFormat("[Google](https://google.com)")).toBe("Google (https://google.com)");
  });

  it("converts unordered list markers to bullets", () => {
    const input = "- Item 1\n- Item 2\n* Item 3";
    const result = toWhatsAppFormat(input);
    expect(result).toContain("\u2022 Item 1");
    expect(result).toContain("\u2022 Item 2");
    expect(result).toContain("\u2022 Item 3");
  });

  it("truncates to 4096 chars", () => {
    const long = "a".repeat(5000);
    expect(toWhatsAppFormat(long).length).toBeLessThanOrEqual(4096);
  });

  it("handles empty string", () => {
    expect(toWhatsAppFormat("")).toBe("");
  });

  it("preserves plain text without modification", () => {
    const plain = "Just some plain text.";
    expect(toWhatsAppFormat(plain)).toBe(plain);
  });

  it("handles mixed formatting in a realistic message", () => {
    const input = "## Horario\n\n**Lunes a Viernes:** 9am - 6pm\n*Sábados:* 10am - 2pm\n\nVisita [nuestro sitio](https://example.com) para más información.";
    const result = toWhatsAppFormat(input);

    expect(result).toContain("*Horario*");
    expect(result).toContain("*Lunes a Viernes:*");
    expect(result).toContain("_Sábados:_");
    expect(result).toContain("nuestro sitio (https://example.com)");
    expect(result).not.toContain("##");
    expect(result).not.toContain("**");
    expect(result).not.toContain("[nuestro sitio]");
  });
});
