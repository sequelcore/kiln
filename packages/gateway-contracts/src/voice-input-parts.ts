export const VOICE_INPUT_CAPTURE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
] as const;

export interface VoiceInputBlobLike {
  readonly type?: string;
  readonly size?: number;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

export interface VoiceInputTextPart {
  readonly type: "text";
  readonly text: string;
}

export interface VoiceInputAudioPart {
  readonly type: "audio";
  readonly mimeType: string;
  readonly data: string;
  readonly durationMs?: number;
}

export type VoiceInputContentPart = VoiceInputTextPart | VoiceInputAudioPart;

export interface VoiceInputPartsInput {
  readonly audio: VoiceInputBlobLike;
  readonly mimeType?: string;
  readonly transcript?: string;
  readonly durationMs?: number;
  readonly maxBytes?: number;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function normalizeMimeType(input: VoiceInputPartsInput): string {
  const mimeType = (input.mimeType ?? input.audio.type ?? "").trim() || "audio/webm";
  if (!mimeType.startsWith("audio/")) {
    throw new Error("Voice input must be an audio MIME type.");
  }
  return mimeType;
}

function normalizeDurationMs(durationMs: number | undefined): number | undefined {
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0
    ? durationMs
    : undefined;
}

async function readAudioBuffer(audio: VoiceInputBlobLike): Promise<ArrayBuffer> {
  if (typeof audio.arrayBuffer === "function") {
    return audio.arrayBuffer();
  }

  const fileReaderCtor = (globalThis as {
    readonly FileReader?: new () => {
      result: string | ArrayBuffer | null;
      error: unknown;
      onload: (() => void) | null;
      onerror: (() => void) | null;
      readAsArrayBuffer(value: unknown): void;
    };
  }).FileReader;
  if (!fileReaderCtor) {
    throw new Error("Voice input blob cannot be read in this environment.");
  }

  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new fileReaderCtor();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error("Voice input blob reader did not return an ArrayBuffer."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Voice input blob read failed."));
    reader.readAsArrayBuffer(audio);
  });
}

export function selectVoiceInputCaptureMimeType(
  isSupported: (mimeType: string) => boolean,
): string {
  return VOICE_INPUT_CAPTURE_MIME_TYPES.find(isSupported) ?? "audio/webm";
}

export function voiceInputDisplayText(durationMs?: number): string {
  const normalized = normalizeDurationMs(durationMs);
  if (normalized === undefined) {
    return "Voice input";
  }
  return `Voice input ${(normalized / 1000).toFixed(1)}s`;
}

export async function createVoiceInputParts(input: VoiceInputPartsInput): Promise<readonly VoiceInputContentPart[]> {
  const mimeType = normalizeMimeType(input);
  const buffer = await readAudioBuffer(input.audio);
  if (input.maxBytes !== undefined && buffer.byteLength > input.maxBytes) {
    throw new Error(`Voice input exceeds the configured ${input.maxBytes} byte limit.`);
  }

  const durationMs = normalizeDurationMs(input.durationMs);
  const parts: VoiceInputContentPart[] = [];
  const transcript = input.transcript?.trim();
  if (transcript) {
    parts.push({ type: "text", text: transcript });
  }
  parts.push({
    type: "audio",
    mimeType,
    data: toBase64(new Uint8Array(buffer)),
    ...(durationMs !== undefined ? { durationMs } : {}),
  });
  return parts;
}
