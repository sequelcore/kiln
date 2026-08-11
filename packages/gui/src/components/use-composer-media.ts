import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { createImageInputParts, imageInputDisplayText } from "@kilnai/gateway-contracts/image-input-parts";
import {
  createVoiceInputParts,
  selectVoiceInputCaptureMimeType,
  voiceInputDisplayText,
} from "@kilnai/gateway-contracts/voice-input-parts";
import type { PreparedComposerAttachment } from "./composer-attachments.js";

type VoiceState = "idle" | "requesting" | "recording" | "encoding";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 8;

function selectedInputFile(event: ChangeEvent<HTMLInputElement>): File | undefined {
  const [file] = Array.from(event.currentTarget.files ?? []);
  event.currentTarget.value = "";
  return file;
}

export function useComposerMedia(input: {
  readonly isBusy: boolean;
  readonly onPasteText: (text: string, selectionStart: number, selectionEnd: number) => void;
}) {
  const [attachments, setAttachments] = useState<readonly PreparedComposerAttachment[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBytesRef = useRef(0);
  const recordingOverflowRef = useRef(false);
  const startedAtRef = useRef(0);
  const attachmentSequenceRef = useRef(0);
  const attachmentSizesRef = useRef(new Map<string, number>());
  const captureGenerationRef = useRef(0);
  const captureRequestPendingRef = useRef(false);
  const mountedRef = useRef(true);
  const canCaptureVoice = typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== "undefined";
  const voiceButtonDisabled = !canCaptureVoice
    || (input.isBusy && voiceState !== "recording")
    || voiceState === "requesting"
    || voiceState === "encoding";
  const mediaFileInputDisabled = input.isBusy || voiceState !== "idle";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      captureGenerationRef.current += 1;
      const recorder = recorderRef.current;
      if (recorder?.state === "recording") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      for (const track of streamRef.current?.getTracks() ?? []) {
        track.stop();
      }
      streamRef.current = null;
    };
  }, []);

  function nextAttachmentId(): string {
    attachmentSequenceRef.current += 1;
    return `attachment-${attachmentSequenceRef.current}`;
  }

  function reserveAttachment(byteSize: number): string | null {
    if (attachmentSizesRef.current.size >= MAX_ATTACHMENT_COUNT) {
      setComposerError(`Attach up to ${MAX_ATTACHMENT_COUNT} files per turn.`);
      return null;
    }
    if (byteSize > MAX_ATTACHMENT_BYTES) {
      setComposerError("Attachments are limited to 10 MB per file.");
      return null;
    }
    const totalBytes = [...attachmentSizesRef.current.values()].reduce((total, size) => total + size, 0);
    if (totalBytes + byteSize > MAX_ATTACHMENT_TOTAL_BYTES) {
      setComposerError("Attachments are limited to 25 MB total per turn.");
      return null;
    }
    const id = nextAttachmentId();
    attachmentSizesRef.current.set(id, byteSize);
    return id;
  }

  function stopVoiceStream(): void {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
  }

  async function finishVoiceCapture(mimeType: string): Promise<void> {
    const durationMs = Math.max(0, Math.round(performance.now() - startedAtRef.current));
    setVoiceState("encoding");
    try {
      if (recordingOverflowRef.current) {
        setComposerError("Voice recordings are limited to 10 MB.");
        return;
      }
      const blob = new Blob(chunksRef.current, { type: mimeType });
      await prepareMediaFile({
        kind: "audio",
        name: "Voice recording",
        file: blob,
        allowWhileEncoding: true,
        createParts: (audio) => createVoiceInputParts({ audio, durationMs, maxBytes: MAX_ATTACHMENT_BYTES }),
        displayContent: voiceInputDisplayText(durationMs),
        failureMessage: "[Composer] Voice input encoding failed:",
      });
    } finally {
      chunksRef.current = [];
      recorderRef.current = null;
      stopVoiceStream();
      setVoiceState("idle");
    }
  }

  async function startVoiceCapture(): Promise<void> {
    if (!canCaptureVoice || captureRequestPendingRef.current || voiceState !== "idle") {
      return;
    }
    captureRequestPendingRef.current = true;
    captureGenerationRef.current += 1;
    const generation = captureGenerationRef.current;
    setVoiceState("requesting");
    try {
      setComposerError(null);
      const mimeType = selectVoiceInputCaptureMimeType((candidate) => MediaRecorder.isTypeSupported(candidate));
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || generation !== captureGenerationRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      chunksRef.current = [];
      recordedBytesRef.current = 0;
      recordingOverflowRef.current = false;
      startedAtRef.current = performance.now();
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size <= 0) return;
        recordedBytesRef.current += event.data.size;
        if (recordedBytesRef.current > MAX_ATTACHMENT_BYTES) {
          recordingOverflowRef.current = true;
          chunksRef.current = [];
          recorder.stop();
          return;
        }
        chunksRef.current.push(event.data);
      };
      recorder.onstop = () => void finishVoiceCapture(recorder.mimeType || mimeType);
      recorder.start(1_000);
      captureRequestPendingRef.current = false;
      setVoiceState("recording");
    } catch (error) {
      stopVoiceStream();
      if (!mountedRef.current || generation !== captureGenerationRef.current) return;
      captureRequestPendingRef.current = false;
      setVoiceState("idle");
      console.warn("[Composer] Voice capture failed:", error);
      setComposerError("Microphone access failed. Check browser permission and try again.");
    }
  }

  function toggleVoiceCapture(): void {
    if (voiceState === "recording") {
      recorderRef.current?.stop();
    } else if (voiceState === "idle") {
      void startVoiceCapture();
    }
  }

  async function prepareMediaFile(input: {
    readonly kind: "audio" | "image";
    readonly name: string;
    readonly file: Blob;
    readonly allowWhileEncoding?: boolean;
    readonly createParts: (file: Blob) => Promise<readonly unknown[]>;
    readonly displayContent: string;
    readonly failureMessage: string;
  }): Promise<void> {
    if (mediaFileInputDisabled && !input.allowWhileEncoding) return;
    const id = reserveAttachment(input.file.size);
    if (!id) return;
    setAttachments((current) => [...current, {
      id,
      kind: input.kind,
      name: input.name,
      displayContent: input.displayContent,
      state: "processing",
    }]);
    try {
      setComposerError(null);
      const parts = await input.createParts(input.file);
      setAttachments((current) => current.map((attachment) => attachment.id === id
        ? { ...attachment, state: "done", parts }
        : attachment));
    } catch (error) {
      console.warn(input.failureMessage, error);
      attachmentSizesRef.current.set(id, 0);
      setAttachments((current) => current.map((attachment) => attachment.id === id
        ? { ...attachment, state: "error", error: "Could not prepare this attachment." }
        : attachment));
    }
  }

  function handleAudioFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = selectedInputFile(event);
    if (!file) return;
    void prepareMediaFile({
      kind: "audio",
      name: file.name,
      file,
      createParts: (audio) => createVoiceInputParts({ audio, maxBytes: MAX_ATTACHMENT_BYTES }),
      displayContent: voiceInputDisplayText(),
      failureMessage: "[Composer] Audio file input failed:",
    });
  }

  function prepareImageFile(file: File): void {
    void prepareMediaFile({
      kind: "image",
      name: file.name,
      file,
      createParts: (image) => createImageInputParts({ image, maxBytes: MAX_ATTACHMENT_BYTES }),
      displayContent: imageInputDisplayText(file.name),
      failureMessage: "[Composer] Image file input failed:",
    });
  }

  function handleImageFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = selectedInputFile(event);
    if (file) prepareImageFile(file);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    if (mediaFileInputDisabled) return;
    const clipboardData = event.clipboardData as DataTransfer | undefined;
    const image = Array.from(clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    const pastedText = typeof clipboardData?.getData === "function"
      ? clipboardData.getData("text/plain")
      : "";
    if (pastedText) {
      input.onPasteText(
        pastedText,
        event.currentTarget.selectionStart ?? event.currentTarget.value.length,
        event.currentTarget.selectionEnd ?? event.currentTarget.value.length,
      );
    }
    prepareImageFile(image);
  }

  return {
    attachments,
    audioFileInputRef,
    composerError,
    fileButtonDisabled: mediaFileInputDisabled,
    handleAudioFileChange,
    handleImageFileChange,
    handlePaste,
    imageButtonDisabled: mediaFileInputDisabled,
    imageFileInputRef,
    hasAttachmentError: attachments.some((attachment) => attachment.state === "error"),
    isPreparingAttachment: attachments.some((attachment) => attachment.state === "processing"),
    removeAttachment: (id: string) => {
      attachmentSizesRef.current.delete(id);
      setAttachments((current) => current.filter((attachment) => attachment.id !== id));
    },
    resetPreparedMedia: () => {
      attachmentSizesRef.current.clear();
      setAttachments([]);
      setComposerError(null);
    },
    toggleVoiceCapture,
    voiceButtonDisabled,
    voiceState,
  };
}
