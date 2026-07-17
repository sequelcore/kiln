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
import { useRef, useState } from "react";
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
import { MarkdownTable, MarkdownTableCell, MarkdownTableHeadCell } from "./markdown-table.js";
import { OperatorAvatar } from "./operator-avatar.js";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Message as ConversationMessage,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import { cn } from "@/lib/utils";
import { TranscriptSurface } from "./transcript-surface.js";

type ResourceDataUrlLoader = (uri: string) => Promise<string | null>;

function createAudioCaptionTrackSrc(text: string): string {
  const caption = text.trim();
  const vtt = caption
    ? `WEBVTT\n\n00:00:00.000 --> 99:59:59.999\n${caption.replace(/\r?\n/g, "\n")}\n`
    : "WEBVTT\n";
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`;
}

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
  ul({ children }) {
    return <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>;
  },
  li({ children }) {
    return <li className="pl-1">{children}</li>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-3 border-l-2 border-border pl-3 text-muted-foreground">
        {children}
      </blockquote>
    );
  },
  table({ children }) {
    return <MarkdownTable>{children}</MarkdownTable>;
  },
  th({ children }) {
    return <MarkdownTableHeadCell>{children}</MarkdownTableHeadCell>;
  },
  td({ children }) {
    return <MarkdownTableCell>{children}</MarkdownTableCell>;
  },
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

export function MarkdownMessageContent(props: { readonly content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{props.content}</ReactMarkdown>;
}

interface MessageRowProps {
  readonly message: Message;
  readonly beforeContent?: ReactNode;
  readonly afterContent?: ReactNode;
  readonly loadResourceDataUrl?: ResourceDataUrlLoader;
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

function VoiceAudioParts(props: {
  readonly parts: readonly VoiceAudioOutputProjection[];
  readonly loadResourceDataUrl?: ResourceDataUrlLoader;
  readonly captionTrackSrc: string;
}) {
  if (props.parts.length === 0) {
    return null;
  }

  return (
    <AttachmentGroup className="mt-1 max-w-full py-0">
      {props.parts.map((part) => (
        <VoiceAudioPart
          key={`${part.index}:${part.source}`}
          part={part}
          loadResourceDataUrl={props.loadResourceDataUrl}
          captionTrackSrc={props.captionTrackSrc}
        />
      ))}
    </AttachmentGroup>
  );
}

function VoiceAudioControls(props: {
  readonly message: Message;
  readonly parts: readonly VoiceAudioOutputProjection[];
  readonly onRequest: (messageId: string) => boolean;
  readonly loadResourceDataUrl?: ResourceDataUrlLoader;
  readonly captionTrackSrc: string;
}) {
  if (props.parts.length > 0) {
    return (
      <VoiceAudioParts
        parts={props.parts}
        loadResourceDataUrl={props.loadResourceDataUrl}
        captionTrackSrc={props.captionTrackSrc}
      />
    );
  }
  if (!props.message.sourceMessageId) {
    return null;
  }
  const pending = props.message.voiceSynthesisStatus === "pending";
  return (
    <MessageFooter className="px-0">
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
    </MessageFooter>
  );
}

function VoiceAudioPart(props: {
  readonly part: VoiceAudioOutputProjection;
  readonly loadResourceDataUrl?: ResourceDataUrlLoader;
  readonly captionTrackSrc: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { part } = props;
  const [artifactPreviewSrc, setArtifactPreviewSrc] = useState<string | null>(null);
  const [artifactPreviewStatus, setArtifactPreviewStatus] = useState<"idle" | "loading" | "error">("idle");
  const canLoadArtifact = Boolean(part.artifactUri && props.loadResourceDataUrl);

  const loadArtifactPreview = async () => {
    if (!part.artifactUri || !props.loadResourceDataUrl || artifactPreviewSrc) {
      return;
    }
    setArtifactPreviewStatus("loading");
    try {
      const dataUrl = await props.loadResourceDataUrl(part.artifactUri);
      if (!dataUrl) {
        setArtifactPreviewStatus("error");
        return;
      }
      setArtifactPreviewSrc(dataUrl);
      setArtifactPreviewStatus("idle");
    } catch {
      setArtifactPreviewStatus("error");
    }
  };

  return (
    <Attachment
      size="sm"
      state={artifactPreviewStatus === "error" ? "error" : artifactPreviewStatus === "loading" ? "processing" : "done"}
      className="max-w-72"
    >
      <AttachmentMedia>
        <FileAudio aria-hidden="true" />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{part.label}</AttachmentTitle>
        <AttachmentDescription>
          {artifactPreviewStatus === "error" ? "Preview unavailable" : "Voice output"}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        {part.src ? (
          <>
            <AttachmentAction
              type="button"
              variant="ghost"
              aria-label={part.label}
              title={part.label}
              onClick={() => {
                void audioRef.current?.play();
              }}
            >
              <Volume2 data-icon="inline-start" aria-hidden="true" />
            </AttachmentAction>
            <audio ref={audioRef} preload="none" src={part.src}>
              <track kind="captions" srcLang="en" label="Transcript" src={props.captionTrackSrc} />
            </audio>
          </>
        ) : (
          <AttachmentAction
            type="button"
            variant="ghost"
            aria-label={part.label}
            title={part.label}
            disabled
          >
            <Volume2 data-icon="inline-start" aria-hidden="true" />
          </AttachmentAction>
        )}
        {part.artifactUri ? (
          <AttachmentAction
            type="button"
            variant="ghost"
            aria-label="Open audio artifact"
            title={canLoadArtifact ? "Open audio artifact" : "Audio artifact preview unavailable"}
            disabled={!canLoadArtifact || artifactPreviewStatus === "loading"}
            onClick={() => {
              void loadArtifactPreview();
            }}
          >
            {artifactPreviewStatus === "loading" ? (
              <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
            ) : (
              <FileAudio data-icon="inline-start" aria-hidden="true" />
            )}
          </AttachmentAction>
        ) : null}
      </AttachmentActions>
      {artifactPreviewSrc ? (
        <audio
          aria-label="Audio artifact preview"
          controls
          preload="metadata"
          src={artifactPreviewSrc}
          className="h-8 max-w-full"
        >
          <track kind="captions" srcLang="en" label="Transcript" src={props.captionTrackSrc} />
        </audio>
      ) : null}
      {artifactPreviewStatus === "error" ? (
        <p className="max-w-56 text-xs leading-5 text-destructive" role="status">
          Audio artifact preview unavailable.
        </p>
      ) : null}
    </Attachment>
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
  const voiceAudioParts = isAssistant ? projectVoiceAudioOutputParts(message.parts ?? []) : [];
  const captionTrackSrc = createAudioCaptionTrackSrc(message.content);
  const identity = projectMessageIdentity({
    role: message.role,
    provider: assistantProvider,
    model: assistantModel,
    userId: isUser ? getStableUserId() : null,
  });
  const avatarState = message.role === "error" ? "error" : message.streaming ? "running" : "idle";
  const avatarMotion = message.streaming && isAssistant ? "subtle" : "none";

  return (
    <TranscriptSurface data-role={message.role} kind="message">
      <ConversationMessage align={isUser ? "end" : "start"}>
        <MessageAvatar className="self-start overflow-visible rounded-none bg-transparent">
          <OperatorAvatar identity={identity} state={avatarState} motion={avatarMotion} />
        </MessageAvatar>
        <MessageContent className={cn(isUser ? "items-end" : "items-start")}>
          <MessageHeader className={cn("gap-2 px-0", isUser ? "sr-only" : "")}>
            <span>{label}</span>
            {assistantProviderLabel ? (
              <Badge variant="outline" className="max-w-full truncate">
                {assistantProviderLabel}
                {assistantModel ? ` / ${assistantModel}` : " / —"}
              </Badge>
            ) : null}
          </MessageHeader>
          {isAssistant && props.beforeContent ? (
            <div className="mb-2 flex w-full min-w-0 max-w-[min(44rem,90%)] flex-col gap-1.5">
              {props.beforeContent}
            </div>
          ) : null}
          <Bubble
            align={isUser ? "end" : "start"}
            variant={isUser ? "secondary" : isOperational ? (message.role === "error" ? "destructive" : "muted") : "ghost"}
            className={cn(isUser ? "max-w-[min(42rem,82%)]" : "max-w-[min(44rem,90%)]")}
          >
            <BubbleContent
              className={cn(
                "leading-6",
                isUser ? "border border-[var(--color-user-border)] bg-[var(--color-user-bg)] text-[var(--color-user-fg)] shadow-sm" : "",
              )}
            >
              {showMarkdown ? (
                <div className="markdown-body">
                  <MarkdownMessageContent content={message.content} />
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words">
                  {message.content}
                </p>
              )}
            </BubbleContent>
          </Bubble>
          {isAssistant ? (
            <VoiceAudioControls
              message={message}
              parts={voiceAudioParts}
              onRequest={requestVoiceSynthesis}
              loadResourceDataUrl={props.loadResourceDataUrl}
              captionTrackSrc={captionTrackSrc}
            />
          ) : null}
          {isAssistant && props.afterContent ? (
            <div className="flex w-full min-w-0 max-w-[min(44rem,90%)] flex-col gap-1.5">
              {props.afterContent}
            </div>
          ) : null}
        </MessageContent>
      </ConversationMessage>
    </TranscriptSurface>
  );
}
