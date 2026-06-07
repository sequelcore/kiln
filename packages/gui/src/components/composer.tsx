import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  createVoiceInputParts,
  selectVoiceInputCaptureMimeType,
  voiceInputDisplayText,
} from "@kilnai/gateway-contracts/voice-input-parts";
import type { SessionStatus } from "../lib/session-store.js";
import type { ComposerContinuityHint, SessionContinuityTone } from "../lib/session-continuity-view.js";
import { ComposerCommandMenu } from "./composer-command-menu.js";
import type { CommandPaletteItem } from "./command-menu-surface.js";
import { ArrowUp, ListChecks, Mic, Paperclip, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ComposerCommandMenuState {
  readonly open: boolean;
  readonly query: string;
  readonly commands: readonly CommandPaletteItem[];
  readonly onQueryChange: (value: string) => void;
  readonly onExecute: (command: CommandPaletteItem) => void;
  readonly onOpenChange: (open: boolean) => void;
}

interface ComposerProps {
  readonly status: SessionStatus;
  readonly planMode: boolean;
  readonly continuityHint: ComposerContinuityHint;
  readonly providerControl?: ReactNode;
  readonly reasoningControl?: ReactNode;
  readonly authorityControl?: ReactNode;
  readonly commandMenu: ComposerCommandMenuState;
  readonly onSubmit: (text: string) => void;
  readonly onSubmitParts?: (parts: readonly unknown[], displayContent: string) => void;
  readonly onTogglePlanMode: (enabled: boolean) => void;
}

function continuityHintClass(tone: SessionContinuityTone): string {
  switch (tone) {
    case "accent":
      return "border-[var(--color-accent)]/35 bg-[var(--color-accent)]/8 text-[var(--color-accent)]";
    case "info":
      return "border-blue-500/25 bg-blue-500/8 text-blue-700 dark:text-blue-300";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300";
    case "danger":
      return "border-destructive/30 bg-destructive/8 text-destructive";
    case "muted":
      return "border-border bg-muted/35 text-muted-foreground";
  }
}

export function Composer(props: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "encoding">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const canSubmit = props.status === "ready" && draft.trim().length > 0;
  const isBusy = props.status === "running" || props.status === "connecting";
  const canCaptureVoice = Boolean(props.onSubmitParts)
    && typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== "undefined";
  const voiceButtonDisabled = !canCaptureVoice || (isBusy && voiceState !== "recording") || voiceState === "encoding";
  const fileButtonDisabled = !props.onSubmitParts || isBusy || voiceState !== "idle";

  function handleDraftChange(value: string): void {
    if (value.trim() === "/") {
      setDraft("");
      props.commandMenu.onOpenChange(true);
      return;
    }
    setDraft(value);
  }

  function stopVoiceStream(): void {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
  }

  async function startVoiceCapture(): Promise<void> {
    if (!props.onSubmitParts || !canCaptureVoice) {
      return;
    }

    try {
      const mimeType = selectVoiceInputCaptureMimeType((candidate) => MediaRecorder.isTypeSupported(candidate));
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      startedAtRef.current = performance.now();
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        void finishVoiceCapture(recorder.mimeType || mimeType);
      };
      recorder.start();
      setVoiceState("recording");
    } catch (error) {
      stopVoiceStream();
      setVoiceState("idle");
      console.warn("[Composer] Voice capture failed:", error);
    }
  }

  async function finishVoiceCapture(mimeType: string): Promise<void> {
    const durationMs = Math.max(0, Math.round(performance.now() - startedAtRef.current));
    setVoiceState("encoding");
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const parts = await createVoiceInputParts({ audio: blob, durationMs });
      props.onSubmitParts?.(parts, voiceInputDisplayText(durationMs));
    } catch (error) {
      console.warn("[Composer] Voice input encoding failed:", error);
    } finally {
      chunksRef.current = [];
      recorderRef.current = null;
      stopVoiceStream();
      setVoiceState("idle");
    }
  }

  function toggleVoiceCapture(): void {
    if (voiceState === "recording") {
      recorderRef.current?.stop();
      return;
    }
    void startVoiceCapture();
  }

  async function submitAudioFile(file: File): Promise<void> {
    if (!props.onSubmitParts || fileButtonDisabled) {
      return;
    }

    try {
      const parts = await createVoiceInputParts({ audio: file });
      props.onSubmitParts(parts, voiceInputDisplayText());
    } catch (error) {
      console.warn("[Composer] Audio file input failed:", error);
    }
  }

  function handleAudioFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const [file] = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!file) {
      return;
    }
    void submitAudioFile(file);
  }

  return (
    <section className="relative z-10 border-t border-border/60 bg-background/95 px-4 pb-3 pt-2 before:pointer-events-none before:absolute before:inset-x-0 before:-top-8 before:h-8 before:bg-gradient-to-t before:from-background before:to-transparent before:content-[''] supports-[backdrop-filter]:bg-background/88">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          props.onSubmit(draft);
          setDraft("");
        }}
        className="relative mx-auto flex max-w-4xl flex-col gap-1.5"
      >
        <ComposerCommandMenu
          open={props.commandMenu.open}
          query={props.commandMenu.query}
          commands={props.commandMenu.commands}
          onQueryChange={props.commandMenu.onQueryChange}
          onExecute={props.commandMenu.onExecute}
          onOpenChange={props.commandMenu.onOpenChange}
        />
        <label className="sr-only" htmlFor="composer-input">
          Message
        </label>
        <div className="flex flex-col overflow-hidden rounded-md border border-border bg-card shadow-[var(--shadow-elevated)] transition-colors focus-within:border-ring/70">
          <Textarea
            id="composer-input"
            value={draft}
            wrap="soft"
            onChange={(event) => handleDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "/"
                && !event.shiftKey
                && !event.altKey
                && !event.ctrlKey
                && !event.metaKey
                && draft.trim().length === 0
              ) {
                event.preventDefault();
                props.commandMenu.onOpenChange(true);
                return;
              }
              if (event.key !== "Enter") return;
              if (event.shiftKey) return;
              event.preventDefault();
              if (props.status !== "ready") {
                return;
              }
              if (!draft.trim()) {
                return;
              }
              props.onSubmit(draft);
              setDraft("");
            }}
            rows={2}
            className="min-h-16 max-h-36 resize-none border-0 bg-transparent px-3 py-3 text-sm leading-6 shadow-none focus-visible:border-transparent focus-visible:ring-0"
            placeholder="Message Kiln"
          />
          <div className="flex min-h-10 flex-wrap items-center gap-2 border-t border-border/55 bg-background/55 px-2.5 py-1.5">
            <div
              role="status"
              aria-label="Session continuity"
              className={`flex min-w-0 max-w-full items-center gap-1.5 rounded-sm border px-1.5 py-1 font-mono text-[10px] leading-none ${continuityHintClass(props.continuityHint.tone)}`}
            >
              <span className="shrink-0 uppercase">{props.continuityHint.label}</span>
              <span aria-hidden="true" className="text-current/35">/</span>
              <span className="min-w-0 truncate normal-case">{props.continuityHint.description}</span>
            </div>
            {props.providerControl || props.reasoningControl || props.authorityControl ? (
              <div className="flex min-w-0 max-w-full flex-1 items-center gap-1.5 sm:flex-none">
                {props.providerControl ? (
                  <div className="min-w-0 max-w-[min(100%,22rem)]">{props.providerControl}</div>
                ) : null}
                {props.reasoningControl}
                {props.authorityControl}
              </div>
            ) : null}
            <Button
              type="button"
              size="icon-sm"
              variant={props.planMode ? "secondary" : "outline"}
              aria-pressed={props.planMode}
              aria-label="Plan"
              title="Plan"
              onClick={() => props.onTogglePlanMode(!props.planMode)}
            >
              <ListChecks aria-hidden="true" />
            </Button>
            <input
              ref={audioFileInputRef}
              type="file"
              accept="audio/*"
              aria-label="Audio file input"
              className="sr-only"
              disabled={fileButtonDisabled}
              onChange={handleAudioFileChange}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              disabled={fileButtonDisabled}
              aria-label="Attach audio file"
              title="Attach audio file"
              onClick={() => audioFileInputRef.current?.click()}
            >
              <Paperclip aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant={voiceState === "recording" ? "secondary" : "outline"}
              disabled={voiceButtonDisabled}
              aria-pressed={voiceState === "recording"}
              aria-label={voiceState === "recording" ? "Stop voice recording" : "Record voice"}
              title={voiceState === "recording" ? "Stop voice recording" : "Record voice"}
              onClick={toggleVoiceCapture}
            >
              {voiceState === "recording" ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || isBusy}
              variant="default"
              size="icon-sm"
              aria-label="Send message"
              title="Send message"
              className="ml-auto"
            >
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
