/**
 * Converts markdown to safe DOM nodes for chat messages. Zero deps, pure DOM API.
 * Supports: bold, italic, inline code, code blocks, ordered/unordered lists, links, line breaks.
 */
export function renderMarkdown(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();

  // Split into code blocks vs everything else (code blocks processed first)
  const blocks = text.split(/(```[\s\S]*?```)/g);

  for (const block of blocks) {
    if (block.startsWith("```")) {
      const content = block.slice(3, -3);
      const firstNewline = content.indexOf("\n");
      const code = firstNewline >= 0 ? content.slice(firstNewline + 1) : content;
      const pre = document.createElement("pre");
      const codeEl = document.createElement("code");
      codeEl.textContent = code;
      pre.appendChild(codeEl);
      fragment.appendChild(pre);
      continue;
    }

    const lines = block.split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Unordered list
      if (/^[\s]*[-*]\s+/.test(line)) {
        const ul = document.createElement("ul");
        while (i < lines.length) {
          const m = lines[i].match(/^[\s]*[-*]\s+(.*)/);
          if (!m) break;
          const li = document.createElement("li");
          li.appendChild(renderInline(m[1]));
          ul.appendChild(li);
          i++;
        }
        fragment.appendChild(ul);
        continue;
      }

      // Ordered list
      if (/^[\s]*\d+\.\s+/.test(line)) {
        const ol = document.createElement("ol");
        while (i < lines.length) {
          const m = lines[i].match(/^[\s]*\d+\.\s+(.*)/);
          if (!m) break;
          const li = document.createElement("li");
          li.appendChild(renderInline(m[1]));
          ol.appendChild(li);
          i++;
        }
        fragment.appendChild(ol);
        continue;
      }

      // Regular line
      if (line.length > 0) {
        fragment.appendChild(renderInline(line));
      }
      if (i < lines.length - 1 && line.length > 0) {
        fragment.appendChild(document.createElement("br"));
      }
      i++;
    }
  }

  return fragment;
}

/** Renders inline markdown patterns: bold, italic, inline code, links. */
export function renderInline(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();

  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const token = match[0];
    if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.appendChild(renderInline(token.slice(2, -2)));
      fragment.appendChild(strong);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      fragment.appendChild(code);
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const a = document.createElement("a");
        a.textContent = linkMatch[1];
        a.href = linkMatch[2];
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        fragment.appendChild(a);
      }
    } else if (token.startsWith("*")) {
      const em = document.createElement("em");
      em.appendChild(renderInline(token.slice(1, -1)));
      fragment.appendChild(em);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  return fragment;
}
