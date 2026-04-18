import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import type { Components } from "react-markdown";
import type { Message } from "../lib/session-store.js";
import { useSessionStore } from "../lib/session-store.js";
import { PROVIDER_METADATA } from "../lib/provider-metadata.js";

const markdownComponents: Components = {
  code({ className, children, ...rest }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const isInline = !("data-sourcepos" in rest) && !match && !String(children).includes("\n");
    if (isInline) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    }
    const lang = match?.[1] ?? "text";
    return (
      <SyntaxHighlighter
        style={atomOneDark}
        language={lang}
        PreTag="div"
        customStyle={{ borderRadius: "0.375rem", fontSize: "0.75rem", marginTop: "0.5rem", marginBottom: "0.5rem" }}
      >
        {String(children).replace(/\n$/, "")}
      </SyntaxHighlighter>
    );
  },
};

interface MessageRowProps {
  readonly message: Message;
}

function roleLabel(role: Message["role"]): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "tool":
      return "Tool";
    case "error":
      return "Error";
    default:
      return "Message";
  }
}

function roleClassName(role: Message["role"]): string {
  switch (role) {
    case "user":
      return "border-[var(--color-user-border)] bg-[var(--color-user-bg)]";
    case "assistant":
      return "border-[var(--color-border)] bg-[var(--color-assistant-bg)]";
    case "tool":
      return "border-[var(--color-tool-fg)]/60 bg-[var(--color-background-element)]";
    case "error":
      return "border-[var(--color-error)]/60 bg-[var(--color-error)]/10";
    default:
      return "border-[var(--color-border)] bg-[var(--color-background-element)]";
  }
}

export function MessageRow(props: MessageRowProps) {
  const { message } = props;
  const activeProvider = useSessionStore((state) => state.activeProvider);
  const activeModel = useSessionStore((state) => state.activeModel);
  const label = roleLabel(message.role);
  const showMarkdown = message.role === "assistant";
  const assistantProvider = message.routedProvider
    ?? (message.streaming ? activeProvider : null);
  const assistantModel = message.routedModel
    ?? (message.streaming ? activeModel : null);
  const assistantProviderLabel = assistantProvider
    ? (PROVIDER_METADATA[assistantProvider]?.label ?? assistantProvider)
    : null;

  return (
    <article
      data-role={message.role}
      className={`rounded-lg border px-4 py-3 shadow-sm ${roleClassName(message.role)}`}
    >
      <header className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        <span>{label}</span>
        {message.role === "assistant" && assistantProviderLabel ? (
          <span>
            {assistantProviderLabel}
            {assistantModel ? ` · ${assistantModel}` : " · —"}
          </span>
        ) : null}
      </header>
      {showMarkdown ? (
        <div className="markdown-body text-sm text-[var(--color-text)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{message.content}</ReactMarkdown>
          {message.streaming ? (
            <span
              aria-label="Streaming"
              className="ml-1 inline-block h-4 w-1 animate-pulse rounded bg-[var(--color-cursor-fg)] align-middle"
            />
          ) : null}
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-[var(--color-text)]">
          {message.content}
          {message.streaming ? (
            <span
              aria-label="Streaming"
              className="ml-1 inline-block h-4 w-1 animate-pulse rounded bg-[var(--color-cursor-fg)] align-middle"
            />
          ) : null}
        </p>
      )}
    </article>
  );
}
