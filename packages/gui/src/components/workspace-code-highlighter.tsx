import type { CSSProperties } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";

interface WorkspaceCodeHighlighterProps {
  readonly content: string;
  readonly language: string;
}

SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("go", go);
SyntaxHighlighter.registerLanguage("html", markup);
SyntaxHighlighter.registerLanguage("java", java);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("sql", sql);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("xml", markup);
SyntaxHighlighter.registerLanguage("yaml", yaml);

const workspaceSyntaxTheme: Record<string, CSSProperties> = {
  'pre[class*="language-"]': {
    background: "var(--workspace-viewer)",
    color: "var(--color-text)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "12px",
    lineHeight: "1.25rem",
    margin: 0,
    padding: "0.75rem 0",
    tabSize: 2,
  },
  'code[class*="language-"]': {
    background: "transparent",
    color: "var(--color-text)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    tabSize: 2,
  },
  comment: { color: "var(--color-text-muted)" },
  prolog: { color: "var(--color-text-muted)" },
  doctype: { color: "var(--color-text-muted)" },
  cdata: { color: "var(--color-text-muted)" },
  punctuation: { color: "var(--color-text-muted)" },
  property: { color: "var(--color-primary)" },
  tag: { color: "var(--color-primary)" },
  boolean: { color: "var(--color-warning)" },
  number: { color: "var(--color-warning)" },
  constant: { color: "var(--color-warning)" },
  symbol: { color: "var(--color-warning)" },
  selector: { color: "var(--color-success)" },
  string: { color: "var(--color-success)" },
  char: { color: "var(--color-success)" },
  builtin: { color: "var(--color-success)" },
  inserted: { color: "var(--color-success)" },
  operator: { color: "var(--color-accent)" },
  entity: { color: "var(--color-accent)" },
  url: { color: "var(--color-accent)" },
  variable: { color: "var(--color-accent)" },
  atrule: { color: "var(--color-accent)" },
  attrvalue: { color: "var(--color-success)" },
  function: { color: "var(--color-primary)" },
  className: { color: "var(--color-primary)" },
  keyword: { color: "var(--color-accent)" },
  regex: { color: "var(--color-warning)" },
  important: { color: "var(--color-warning)", fontWeight: 600 },
  deleted: { color: "var(--color-error)" },
};

export function WorkspaceCodeHighlighter(props: WorkspaceCodeHighlighterProps) {
  return (
    <SyntaxHighlighter
      data-testid="workspace-code"
      language={props.language}
      style={workspaceSyntaxTheme}
      showLineNumbers
      wrapLongLines={false}
      customStyle={{ background: "var(--workspace-viewer)", minWidth: "max-content" }}
      codeTagProps={{ style: { fontFamily: "inherit" } }}
      lineNumberStyle={{
        minWidth: "3.5rem",
        marginRight: "1rem",
        paddingRight: "0.75rem",
        textAlign: "right",
        color: "color-mix(in srgb, var(--color-text-muted) 65%, transparent)",
        background: "var(--workspace-viewer-gutter)",
        borderRight: "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)",
        userSelect: "none",
      }}
    >
      {props.content}
    </SyntaxHighlighter>
  );
}
