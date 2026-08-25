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
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import { OPERATOR_WORKSPACE_CODE_SYNTAX_STYLE } from "../lib/operator-code-syntax-style.js";

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

export function WorkspaceCodeHighlighter(props: WorkspaceCodeHighlighterProps) {
  return (
    <SyntaxHighlighter
      data-testid="workspace-code"
      language={props.language}
      style={OPERATOR_WORKSPACE_CODE_SYNTAX_STYLE}
      showLineNumbers
      wrapLongLines={false}
      customStyle={{ background: "var(--color-code-background)", minWidth: "max-content" }}
      codeTagProps={{ style: { fontFamily: "inherit" } }}
      lineNumberStyle={{
        minWidth: "3.5rem",
        marginRight: "1rem",
        paddingRight: "0.75rem",
        textAlign: "right",
        color: "color-mix(in oklch, var(--color-text-muted) 65%, transparent)",
        background: "var(--workspace-viewer-gutter)",
        borderRight: "1px solid color-mix(in oklch, var(--color-border) 50%, transparent)",
        userSelect: "none",
      }}
    >
      {props.content}
    </SyntaxHighlighter>
  );
}
