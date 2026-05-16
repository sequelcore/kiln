import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/light";
import bash from "react-syntax-highlighter/dist/esm/languages/hljs/bash";
import diff from "react-syntax-highlighter/dist/esm/languages/hljs/diff";
import javascript from "react-syntax-highlighter/dist/esm/languages/hljs/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/hljs/json";
import markdown from "react-syntax-highlighter/dist/esm/languages/hljs/markdown";
import plaintext from "react-syntax-highlighter/dist/esm/languages/hljs/plaintext";
import powershell from "react-syntax-highlighter/dist/esm/languages/hljs/powershell";
import python from "react-syntax-highlighter/dist/esm/languages/hljs/python";
import shell from "react-syntax-highlighter/dist/esm/languages/hljs/shell";
import typescript from "react-syntax-highlighter/dist/esm/languages/hljs/typescript";
import xml from "react-syntax-highlighter/dist/esm/languages/hljs/xml";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import type { Components } from "react-markdown";
import { useRef } from "react";
import type { ReactNode } from "react";
import { FileAudio, Loader2, Volume2 } from "lucide-react";
import {
  getGuiProviderMetadata,
  projectMessageIdentity,
  projectVoiceAudioOutputParts,
  type VoiceAudioOutputProjection,
} from "@kilnai/gateway-contracts";
import type { Message } from "../lib/session-store.js";
import { getStableUserId } from "../lib/stable-user-id.js";
import { useSessionStore } from "../lib/session-store.js";
import { OperatorAvatar } from "./operator-avatar.js";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("diff", diff);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("js", javascript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("md", markdown);
SyntaxHighlighter.registerLanguage("plaintext", plaintext);
SyntaxHighlighter.registerLanguage("text", plaintext);
SyntaxHighlighter.registerLanguage("powershell", powershell);
SyntaxHighlighter.registerLanguage("ps1", powershell);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("py", python);
SyntaxHighlighter.registerLanguage("shell", shell);
SyntaxHighlighter.registerLanguage("sh", shell);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("ts", typescript);
SyntaxHighlighter.registerLanguage("tsx", typescript);
SyntaxHighlighter.registerLanguage("xml", xml);
SyntaxHighlighter.registerLanguage("html", xml);

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
  readonly beforeContent?: ReactNode;
  readonly afterContent?: ReactNode;
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

function VoiceAudioParts(props: { readonly parts: readonly VoiceAudioOutputProjection[] }) {
  if (props.parts.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {props.parts.map((part) => (
        <VoiceAudioPart key={`${part.index}:${part.source}`} part={part} />
      ))}
    </div>
  );
}

function VoiceAudioControls(props: {
  readonly message: Message;
  readonly parts: readonly VoiceAudioOutputProjection[];
  readonly onRequest: (messageId: string) => boolean;
}) {
  if (props.parts.length > 0) {
    return <VoiceAudioParts parts={props.parts} />;
  }
  if (!props.message.sourceMessageId) {
    return null;
  }
  const pending = props.message.voiceSynthesisStatus === "pending";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-foreground"
        aria-label={pending ? "Generating audio" : "Generate audio"}
        title={pending ? "Generating audio" : "Generate audio"}
        disabled={pending}
        onClick={() => {
          props.onRequest(props.message.id);
        }}
      >
        {pending ? (
          <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
        ) : (
          <Volume2 data-icon="inline-start" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}

function VoiceAudioPart(props: { readonly part: VoiceAudioOutputProjection }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { part } = props;

  return (
    <div className="flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-background/70 px-1.5 py-1">
      {part.src ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            aria-label={part.label}
            title={part.label}
            onClick={() => {
              void audioRef.current?.play();
            }}
          >
            <Volume2 data-icon="inline-start" aria-hidden="true" />
          </Button>
          <audio ref={audioRef} preload="none" src={part.src} />
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={part.label}
          title={part.label}
          disabled
        >
          <Volume2 data-icon="inline-start" aria-hidden="true" />
        </Button>
      )}
      {part.artifactUri ? (
        <a
          className={buttonVariants({
            variant: "ghost",
            size: "icon-sm",
            className: "text-muted-foreground hover:text-foreground",
          })}
          href={part.artifactUri}
          aria-label="Open audio artifact"
          title="Open audio artifact"
        >
          <FileAudio data-icon="inline-start" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

export function MessageRow(props: MessageRowProps) {
  const { message } = props;
  const activeProvider = useSessionStore((state) => state.activeProvider);
  const activeModel = useSessionStore((state) => state.activeModel);
  const requestVoiceSynthesis = useSessionStore((state) => state.requestVoiceSynthesis);
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
  const hasAnchoredOperationalContent = Boolean(props.beforeContent || props.afterContent);
  const hasMessageContent = message.content.trim().length > 0;
  const voiceAudioParts = isAssistant ? projectVoiceAudioOutputParts(message.parts ?? []) : [];
  const showStreamingCursor = message.streaming && (hasMessageContent || !hasAnchoredOperationalContent);
  const identity = projectMessageIdentity({
    role: message.role,
    provider: assistantProvider,
    model: assistantModel,
    userId: isUser ? getStableUserId() : null,
  });
  const avatarState = message.role === "error" ? "error" : message.streaming ? "running" : "idle";
  const avatarMotion = message.streaming && isAssistant ? "subtle" : "none";

  return (
    <article
      data-role={message.role}
      className={cn(
        "mx-auto flex w-full max-w-3xl items-start gap-2",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser ? (
        <OperatorAvatar identity={identity} state={avatarState} motion={avatarMotion} className="mt-1" />
      ) : null}
      <div
        className={cn(
          "min-w-0",
          isUser ? "max-w-[min(42rem,82%)]" : "max-w-[min(44rem,90%)]",
          isAssistant ? "rounded-2xl rounded-tl-md bg-muted/35 px-3.5 py-2.5 shadow-sm" : "",
          isOperational ? "rounded-2xl rounded-tl-md bg-muted/35 px-3.5 py-2.5 shadow-sm" : "",
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
            isUser
              ? "rounded-2xl rounded-tr-md border border-[var(--color-user-border)] bg-[var(--color-user-bg)] px-3.5 py-2.5 text-[var(--color-user-fg)] shadow-sm"
              : "",
          )}
        >
          {isAssistant && props.beforeContent ? (
            <div className="mb-2 flex flex-col gap-1.5">
              {props.beforeContent}
            </div>
          ) : null}
          {showMarkdown ? (
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{message.content}</ReactMarkdown>
              {showStreamingCursor ? (
                <span
                  aria-label="Streaming"
                  className="ml-1 inline-block h-4 w-1 animate-pulse rounded bg-[var(--color-cursor-fg)] align-middle"
                />
              ) : null}
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">
              {message.content}
              {showStreamingCursor ? (
                <span
                  aria-label="Streaming"
                  className="ml-1 inline-block h-4 w-1 animate-pulse rounded bg-[var(--color-cursor-fg)] align-middle"
                />
              ) : null}
            </p>
          )}
          {isAssistant ? (
            <VoiceAudioControls
              message={message}
              parts={voiceAudioParts}
              onRequest={requestVoiceSynthesis}
            />
          ) : null}
          {isAssistant && props.afterContent ? (
            <div className="mt-2 flex flex-col gap-1.5">
              {props.afterContent}
            </div>
          ) : null}
        </div>
      </div>
      {isUser ? <OperatorAvatar identity={identity} state={avatarState} className="mt-1" /> : null}
    </article>
  );
}
