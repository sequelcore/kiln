import { useRef, useState, type ChangeEvent, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  createImageInputParts,
  imageInputDisplayText,
} from "@kilnai/gateway-contracts/image-input-parts";
import {
  createVoiceInputParts,
  selectVoiceInputCaptureMimeType,
  voiceInputDisplayText,
} from "@kilnai/gateway-contracts/voice-input-parts";
import type { ActivityPhase, SessionStatus } from "../lib/session-store.js";
import type { ContextUsageProjection } from "@kilnai/gateway-contracts";
import type { ComposerContinuityHint } from "../lib/session-continuity-view.js";
import { ComposerLeadingActions, ComposerTrailingActions } from "./composer-actions.js";
import { ComposerFrame, type ComposerCommandMenuState } from "./composer-frame.js";

interface ComposerProps {
  readonly status: SessionStatus;
  readonly activityPhase?: ActivityPhase;
  readonly activityToolName?: string;
  readonly activityDetails?: string;
  readonly planMode: boolean;
  readonly governedWorkItemCount: number | null;
  readonly continuityHint: ComposerContinuityHint;
  readonly contextUsage?: ContextUsageProjection | null;
  readonly providerControl?: ReactNode;
  readonly reasoningControl?: ReactNode;
  readonly authorityControl?: ReactNode;
  readonly commandMenu: ComposerCommandMenuState;
  readonly onSubmit: (text: string) => void;
  readonly onSubmitParts?: (parts: readonly unknown[], displayContent: string) => void;
  readonly onTogglePlanMode: (enabled: boolean) => void;
  readonly onGovernedWorkItemCountChange: (count: number | null) => void;
}

function selectedInputFile(event: ChangeEvent<HTMLInputElement>): File | undefined {
  const [file] = Array.from(event.currentTarget.files ?? []);
  event.currentTarget.value = "";
  return file;
}

export function Composer(props: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "encoding">("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const canSubmit = props.status === "ready" && draft.trim().length > 0;
  const isBusy = props.status === "running" || props.status === "connecting";
  const canCaptureVoice = Boolean(props.onSubmitParts)
    && typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== "undefined";
  const voiceButtonDisabled = !canCaptureVoice || (isBusy && voiceState !== "recording") || voiceState === "encoding";
  const mediaFileInputDisabled = !props.onSubmitParts || isBusy || voiceState !== "idle";
  const fileButtonDisabled = mediaFileInputDisabled;
  const imageButtonDisabled = mediaFileInputDisabled;
  const activity = props.activityPhase && props.activityPhase !== "idle"
    ? {
        phase: props.activityPhase,
        ...(props.activityToolName ? { toolName: props.activityToolName } : {}),
        ...(props.activityDetails ? { details: props.activityDetails } : {}),
      }
    : undefined;

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

  async function submitMediaFile(input: {
    readonly file: File;
    readonly disabled: boolean;
    readonly createParts: (file: File) => Promise<readonly unknown[]>;
    readonly displayContent: string;
    readonly failureMessage: string;
  }): Promise<void> {
    if (!props.onSubmitParts || input.disabled) {
      return;
    }

    try {
      const parts = await input.createParts(input.file);
      props.onSubmitParts(parts, input.displayContent);
    } catch (error) {
      console.warn(input.failureMessage, error);
    }
  }

  function handleAudioFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = selectedInputFile(event);
    if (!file) {
      return;
    }
    void submitMediaFile({
      file,
      disabled: fileButtonDisabled,
      createParts: (audio) => createVoiceInputParts({ audio }),
      displayContent: voiceInputDisplayText(),
      failureMessage: "[Composer] Audio file input failed:",
    });
  }

  async function submitImageFile(file: File): Promise<void> {
    return submitMediaFile({
      file,
      disabled: imageButtonDisabled,
      createParts: (image) => createImageInputParts({ image }),
      displayContent: imageInputDisplayText(file.name),
      failureMessage: "[Composer] Image file input failed:",
    });
  }

  function handleImageFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = selectedInputFile(event);
    if (!file) {
      return;
    }
    void submitImageFile(file);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    if (!props.onSubmitParts || imageButtonDisabled) {
      return;
    }

    const clipboardData = event.clipboardData as DataTransfer | undefined;
    const image = Array.from(clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
    if (!image) {
      return;
    }

    event.preventDefault();
    void submitImageFile(image);
  }

  function submitDraft(): void {
    if (!canSubmit) {
      return;
    }
    props.onSubmit(draft);
    setDraft("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submitDraft();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
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
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    submitDraft();
  }

  return (
    <ComposerFrame
      draft={draft}
      continuityHint={props.continuityHint}
      contextUsage={props.contextUsage}
      turnActive={isBusy}
      activity={activity}
      providerControl={props.providerControl}
      reasoningControl={props.reasoningControl}
      authorityControl={props.authorityControl}
      commandMenu={props.commandMenu}
      onSubmit={handleSubmit}
      onDraftChange={handleDraftChange}
      onKeyDown={handleComposerKeyDown}
      onPaste={handlePaste}
      leadingActions={(
        <ComposerLeadingActions
          planMode={props.planMode}
          governedWorkItemCount={props.governedWorkItemCount}
          canSubmit={canSubmit}
          fileButtonDisabled={fileButtonDisabled}
          imageButtonDisabled={imageButtonDisabled}
          voiceButtonDisabled={voiceButtonDisabled}
          voiceState={voiceState}
          audioFileInputRef={audioFileInputRef}
          imageFileInputRef={imageFileInputRef}
          onTogglePlanMode={() => props.onTogglePlanMode(!props.planMode)}
          onGovernedWorkItemCountChange={props.onGovernedWorkItemCountChange}
          onToggleVoiceCapture={toggleVoiceCapture}
          onAudioFileChange={handleAudioFileChange}
          onImageFileChange={handleImageFileChange}
        />
      )}
      trailingActions={(
        <ComposerTrailingActions
          planMode={props.planMode}
          governedWorkItemCount={props.governedWorkItemCount}
          canSubmit={canSubmit}
          fileButtonDisabled={fileButtonDisabled}
          imageButtonDisabled={imageButtonDisabled}
          voiceButtonDisabled={voiceButtonDisabled}
          voiceState={voiceState}
          audioFileInputRef={audioFileInputRef}
          imageFileInputRef={imageFileInputRef}
          onTogglePlanMode={() => props.onTogglePlanMode(!props.planMode)}
          onGovernedWorkItemCountChange={props.onGovernedWorkItemCountChange}
          onToggleVoiceCapture={toggleVoiceCapture}
          onAudioFileChange={handleAudioFileChange}
          onImageFileChange={handleImageFileChange}
        />
      )}
    />
  );
}
