import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import type { Components } from "react-markdown";
import { getGuiProviderMetadata } from "@kilnai/gateway-contracts";
import type { Message } from "../lib/session-store.js";
import { useSessionStore } from "../lib/session-store.js";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
    ? (getGuiProviderMetadata(assistantProvider)?.label ?? assistantProvider)
    : null;
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isOperational = message.role === "tool" || message.role === "error";

  return (
    <article
      data-role={message.role}
      className={cn(
        "mx-auto flex w-full max-w-3xl",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "min-w-0",
          isUser ? "max-w-[min(42rem,82%)]" : "max-w-[min(44rem,90%)]",
          isAssistant ? "rounded-lg border bg-card px-3 py-2" : "",
          isOperational ? "rounded-lg border bg-card px-3 py-2" : "",
        )}
      >
        <header className={cn(
          "mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground",
          isUser ? "justify-end" : "justify-start",
          isUser ? "sr-only" : "",
        )}>
          <span>{label}</span>
          {assistantProviderLabel ? (
            <Badge variant="outline" className="max-w-full truncate">
              {assistantProviderLabel}
              {assistantModel ? ` / ${assistantModel}` : " / —"}
            </Badge>
          ) : null}
        </header>
        <div
          className={cn(
            "min-w-0 text-sm leading-6 text-foreground",
            isUser ? "rounded-lg bg-muted px-3 py-2" : "",
          )}
        >
          {showMarkdown ? (
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{message.content}</ReactMarkdown>
              {message.streaming ? (
                <span
                  aria-label="Streaming"
                  className="ml-1 inline-block h-4 w-1 animate-pulse rounded bg-[var(--color-cursor-fg)] align-middle"
                />
              ) : null}
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">
              {message.content}
              {message.streaming ? (
                <span
                  aria-label="Streaming"
                  className="ml-1 inline-block h-4 w-1 animate-pulse rounded bg-[var(--color-cursor-fg)] align-middle"
                />
              ) : null}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
