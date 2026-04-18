import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../lib/session-store.js";

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
  const label = roleLabel(message.role);
  const showMarkdown = message.role === "assistant";

  return (
    <article
      data-role={message.role}
      className={`rounded-lg border px-4 py-3 shadow-sm ${roleClassName(message.role)}`}
    >
      <header className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        <span>{label}</span>
        {message.role === "assistant" && message.routedProvider ? (
          <span>
            {message.routedProvider}
            {message.routedModel ? ` · ${message.routedModel}` : ""}
          </span>
        ) : null}
      </header>
      {showMarkdown ? (
        <div className="markdown-body text-sm text-[var(--color-text)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
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
