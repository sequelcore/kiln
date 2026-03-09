/// <reference types="vitest/globals" />

import { describe, it, expect } from "vitest";
import { renderMarkdown, renderInline } from "../src/markdown.js";

/** Helper: render markdown to a container div and return its innerHTML */
function render(md: string): string {
  const container = document.createElement("div");
  container.appendChild(renderMarkdown(md));
  return container.innerHTML;
}

/** Helper: render inline markdown to a container div and return its innerHTML */
function renderInl(md: string): string {
  const container = document.createElement("div");
  container.appendChild(renderInline(md));
  return container.innerHTML;
}

describe("renderMarkdown", () => {
  describe("bold rendering", () => {
    it("renders **text** as <strong>", () => {
      expect(render("**hello**")).toContain("<strong>hello</strong>");
    });

    it("renders bold within a sentence", () => {
      const html = render("this is **bold** text");
      expect(html).toContain("this is ");
      expect(html).toContain("<strong>bold</strong>");
      expect(html).toContain(" text");
    });
  });

  describe("italic rendering", () => {
    it("renders *text* as <em>", () => {
      expect(render("*hello*")).toContain("<em>hello</em>");
    });

    it("renders italic within a sentence", () => {
      const html = render("this is *italic* text");
      expect(html).toContain("<em>italic</em>");
    });
  });

  describe("inline code", () => {
    it("renders `code` as <code>", () => {
      expect(render("`const x = 1`")).toContain("<code>const x = 1</code>");
    });
  });

  describe("code blocks", () => {
    it("renders fenced code block as <pre><code>", () => {
      const md = "```typescript\nconst x = 1;\n```";
      const html = render(md);
      expect(html).toContain("<pre><code>");
      expect(html).toContain("const x = 1;");
      expect(html).toContain("</code></pre>");
    });

    it("strips language identifier from code block content", () => {
      const md = "```js\nalert('hi');\n```";
      const html = render(md);
      expect(html).not.toContain("js\n");
      expect(html).toContain("alert('hi');");
    });

    it("handles code block without language identifier", () => {
      const md = "```\nplain code\n```";
      const html = render(md);
      expect(html).toContain("<pre><code>");
      expect(html).toContain("plain code");
    });
  });

  describe("unordered lists", () => {
    it("renders - items as <ul><li>", () => {
      const md = "- item one\n- item two\n- item three";
      const html = render(md);
      expect(html).toContain("<ul>");
      expect(html).toContain("<li>item one</li>");
      expect(html).toContain("<li>item two</li>");
      expect(html).toContain("<li>item three</li>");
      expect(html).toContain("</ul>");
    });

    it("renders * items as <ul><li>", () => {
      const md = "* first\n* second";
      const html = render(md);
      expect(html).toContain("<ul>");
      expect(html).toContain("<li>first</li>");
      expect(html).toContain("<li>second</li>");
    });
  });

  describe("ordered lists", () => {
    it("renders numbered items as <ol><li>", () => {
      const md = "1. first\n2. second\n3. third";
      const html = render(md);
      expect(html).toContain("<ol>");
      expect(html).toContain("<li>first</li>");
      expect(html).toContain("<li>second</li>");
      expect(html).toContain("<li>third</li>");
      expect(html).toContain("</ol>");
    });
  });

  describe("links", () => {
    it("renders [text](url) as <a> with target=_blank", () => {
      const html = render("[Click here](https://example.com)");
      expect(html).toContain('<a href="https://example.com"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain("Click here</a>");
    });
  });

  describe("mixed inline patterns", () => {
    it("handles bold and code in same line", () => {
      const html = render("Use **bold** and `code` together");
      expect(html).toContain("<strong>bold</strong>");
      expect(html).toContain("<code>code</code>");
    });

    it("handles bold and italic in same line", () => {
      const html = render("This is **bold** and *italic*");
      expect(html).toContain("<strong>bold</strong>");
      expect(html).toContain("<em>italic</em>");
    });
  });

  describe("nested bold inside list items", () => {
    it("renders bold text inside list items", () => {
      const md = "- **important** item\n- regular item";
      const html = render(md);
      expect(html).toContain("<li><strong>important</strong> item</li>");
      expect(html).toContain("<li>regular item</li>");
    });
  });

  describe("plain text", () => {
    it("renders plain text without modification", () => {
      const html = render("just plain text");
      expect(html).toBe("just plain text");
    });

    it("handles empty string", () => {
      const html = render("");
      expect(html).toBe("");
    });
  });

  describe("line breaks", () => {
    it("inserts <br> between non-empty lines", () => {
      const html = render("line one\nline two");
      expect(html).toContain("line one<br>line two");
    });
  });
});

describe("renderInline", () => {
  it("preserves text around inline patterns", () => {
    const html = renderInl("before `code` after");
    expect(html).toBe("before <code>code</code> after");
  });

  it("handles text with no inline patterns", () => {
    const html = renderInl("just text");
    expect(html).toBe("just text");
  });
});
