import { describe, it, expect } from "vitest";
import { renderEmailHtml, renderEmailPlainText } from "../../src/channels/email-template.js";

describe("email-template", () => {
  describe("renderEmailHtml", () => {
    it("produces valid HTML with inline styles", () => {
      const html = renderEmailHtml("Hello world");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
      expect(html).toContain("Hello world");
      expect(html).toContain("style=");
      expect(html).toContain("font-family:");
    });

    it("wraps text in paragraphs", () => {
      const html = renderEmailHtml("Paragraph one\n\nParagraph two");
      expect(html).toContain("<p");
      expect(html).toContain("Paragraph one");
      expect(html).toContain("Paragraph two");
    });

    it("converts single newlines to <br>", () => {
      const html = renderEmailHtml("Line one\nLine two");
      expect(html).toContain("Line one<br>Line two");
    });

    it("escapes HTML special characters", () => {
      const html = renderEmailHtml('Hello <script>alert("xss")</script>');
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("includes businessName with primaryColor in header", () => {
      const html = renderEmailHtml("Hello", {
        businessName: "Acme Corp",
        primaryColor: "#ff5500",
      });
      expect(html).toContain("Acme Corp");
      expect(html).toContain("#ff5500");
    });

    it("uses default color when primaryColor is not set", () => {
      const html = renderEmailHtml("Hello", { businessName: "Test Co" });
      expect(html).toContain("#333333");
      expect(html).toContain("Test Co");
    });

    it("includes unsubscribe link when URL provided", () => {
      const html = renderEmailHtml("Hello", {
        unsubscribeUrl: "https://example.com/unsub",
      });
      expect(html).toContain("Unsubscribe");
      expect(html).toContain("https://example.com/unsub");
    });

    it("omits header and footer when no branding", () => {
      const html = renderEmailHtml("Hello");
      expect(html).not.toContain("Unsubscribe");
      // No branded header means the body td gets top border-radius
      expect(html).toContain("border-radius:8px 8px 0 0");
    });

    it("uses responsive max-width container", () => {
      const html = renderEmailHtml("Hello");
      expect(html).toContain("max-width:600px");
      expect(html).toContain('width="100%"');
    });
  });

  describe("renderEmailPlainText", () => {
    it("strips bold markdown", () => {
      expect(renderEmailPlainText("**bold** text")).toBe("bold text");
    });

    it("strips italic markdown", () => {
      expect(renderEmailPlainText("*italic* text")).toBe("italic text");
    });

    it("strips inline code", () => {
      expect(renderEmailPlainText("Use `console.log`")).toBe("Use console.log");
    });

    it("replaces code blocks with placeholder", () => {
      expect(renderEmailPlainText("```js\nconsole.log('hi')\n```")).toBe("[code block]");
    });

    it("strips headers", () => {
      expect(renderEmailPlainText("## Title\nContent")).toBe("Title\nContent");
    });

    it("strips links but keeps text", () => {
      expect(renderEmailPlainText("[Click here](https://example.com)")).toBe("Click here");
    });

    it("preserves plain text as-is", () => {
      expect(renderEmailPlainText("Just plain text")).toBe("Just plain text");
    });
  });
});
