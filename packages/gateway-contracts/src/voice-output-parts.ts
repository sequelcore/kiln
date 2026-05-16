export type VoiceAudioOutputSource = "data-url" | "url" | "artifact";

export interface VoiceAudioOutputProjection {
  readonly index: number;
  readonly label: string;
  readonly mimeType: string;
  readonly source: VoiceAudioOutputSource;
  readonly src?: string;
  readonly artifactUri?: string;
  readonly durationMs?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readDurationMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function createLabel(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return "Audio output";
  }
  return `Audio output ${(durationMs / 1000).toFixed(1)}s`;
}

export function projectVoiceAudioOutputParts(parts: readonly unknown[]): VoiceAudioOutputProjection[] {
  const projected: VoiceAudioOutputProjection[] = [];

  parts.forEach((part, index) => {
    const record = asRecord(part);
    if (!record || record["type"] !== "audio") {
      return;
    }

    const mimeType = nonEmptyString(record["mimeType"]);
    if (!mimeType || !mimeType.startsWith("audio/")) {
      return;
    }

    const data = nonEmptyString(record["data"]);
    const url = nonEmptyString(record["url"]);
    const artifactUri = nonEmptyString(record["artifactUri"]);
    const durationMs = readDurationMs(record["durationMs"]);
    const base = {
      index,
      label: createLabel(durationMs),
      mimeType,
      ...(artifactUri ? { artifactUri } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };

    if (data) {
      projected.push({
        ...base,
        source: "data-url",
        src: `data:${mimeType};base64,${data}`,
      });
      return;
    }

    if (url) {
      projected.push({
        ...base,
        source: "url",
        src: url,
      });
      return;
    }

    if (artifactUri) {
      projected.push({
        ...base,
        source: "artifact",
      });
    }
  });

  return projected;
}

export function formatVoiceAudioOutputForTerminal(part: VoiceAudioOutputProjection): string {
  const location = part.artifactUri ?? part.src ?? "inline audio data";
  return `[Voice audio: ${part.label} | ${part.mimeType} | ${location}]`;
}
