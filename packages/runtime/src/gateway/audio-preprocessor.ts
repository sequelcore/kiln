// Governed audio transform route for gateway voice-note input.

import type {
  ArtifactResourceStore,
  ContentPart,
  EventBus,
  MultimodalRoutedEvent,
  SttAdapter,
} from "@kilnai/core";
import { projectMultimodalArtifactResource } from "@kilnai/core";

export interface MediaDownloader {
  download(url: string): Promise<{ data: Uint8Array; mimeType: string }>;
}

export type AudioTransformStatus = "succeeded" | "failed";

export interface AudioTranscriptionTransformEvidence {
  readonly transform: "transcription";
  readonly status: AudioTransformStatus;
  readonly requestedCapability: "transcription";
  readonly sourceModality: "audio";
  readonly outputModality: "text";
  readonly sourceArtifactUri: string;
  readonly sourceMimeType: string;
  readonly sourceBytes?: number;
  readonly provider: string;
  readonly provenance: string;
  readonly degradation: string;
  readonly outputText?: string;
  readonly confidence?: number;
  readonly durationMs?: number;
  readonly errorMessage?: string;
}

export interface AudioTransformResult {
  readonly parts: readonly ContentPart[];
  readonly transforms: readonly AudioTranscriptionTransformEvidence[];
}

export interface AudioTransformRoutingEventContext {
  readonly eventBus?: EventBus;
  readonly sessionId: string;
  readonly tenantId?: string;
  readonly provider?: string;
  readonly model: string;
}

export interface AudioTransformOptions {
  readonly artifactStore: ArtifactResourceStore;
  readonly sourceIdPrefix: string;
  readonly artifactNamespace?: string;
  readonly maxArtifacts?: number;
}

export class AudioTransformError extends Error {
  readonly transforms: readonly AudioTranscriptionTransformEvidence[];

  constructor(
    message: string,
    transforms: readonly AudioTranscriptionTransformEvidence[],
  ) {
    super(message);
    this.name = "AudioTransformError";
    this.transforms = transforms;
  }
}

const TRANSCRIPTION_DEGRADATION =
  "Audio is converted to text before model transport; original audio remains the governed transform source.";

export function createWhatsAppMediaDownloader(accessToken: string): MediaDownloader {
  return {
    async download(url: string): Promise<{ data: Uint8Array; mimeType: string }> {
      const metaRes = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!metaRes.ok) {
        throw new Error(`WhatsApp media metadata fetch failed: ${metaRes.status}`);
      }
      const meta = (await metaRes.json()) as { url: string; mime_type: string };

      const mediaRes = await fetch(meta.url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!mediaRes.ok) {
        throw new Error(`WhatsApp media download failed: ${mediaRes.status}`);
      }

      const buffer = await mediaRes.arrayBuffer();
      return { data: new Uint8Array(buffer), mimeType: meta.mime_type };
    },
  };
}

export function createGenericMediaDownloader(): MediaDownloader {
  return {
    async download(url: string): Promise<{ data: Uint8Array; mimeType: string }> {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Media download failed: ${res.status}`);
      }
      const buffer = await res.arrayBuffer();
      const mimeType = res.headers.get("content-type") ?? "audio/ogg";
      return { data: new Uint8Array(buffer), mimeType };
    },
  };
}

export async function transformAudioParts(
  parts: readonly ContentPart[],
  stt: SttAdapter,
  downloader: MediaDownloader,
  options: AudioTransformOptions,
): Promise<AudioTransformResult> {
  const transformedParts: ContentPart[] = [];
  const transforms: AudioTranscriptionTransformEvidence[] = [];

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (part.type !== "audio") {
      transformedParts.push(part);
      continue;
    }

    let sourceArtifactUri = part.artifactUri ?? audioSourceArtifactUri(index);
    const fallbackMimeType = part.mimeType || "application/octet-stream";

    try {
      const source = await resolveAudioSource(part, downloader);
      sourceArtifactUri = part.artifactUri ?? persistAudioSourceArtifact(index, source, options);
      const transcription = await stt.transcribe(source.data, source.mimeType);
      transforms.push({
        transform: "transcription",
        status: "succeeded",
        requestedCapability: "transcription",
        sourceModality: "audio",
        outputModality: "text",
        sourceArtifactUri,
        sourceMimeType: source.mimeType,
        sourceBytes: source.data.byteLength,
        provider: stt.name,
        provenance: `stt:${stt.name}`,
        degradation: TRANSCRIPTION_DEGRADATION,
        outputText: transcription.text,
        ...(transcription.confidence !== undefined ? { confidence: transcription.confidence } : {}),
        ...(transcription.durationMs !== undefined ? { durationMs: transcription.durationMs } : {}),
      });
      transformedParts.push({ type: "text", text: `[Voice note transcription]: ${transcription.text}` });
    } catch (err) {
      const failure = failedTransformEvidence({
        sourceArtifactUri,
        sourceMimeType: fallbackMimeType,
        provider: stt.name,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      const nextTransforms = [...transforms, failure];
      throw new AudioTransformError("Audio transcription transform failed", nextTransforms);
    }
  }

  return {
    parts: transformedParts,
    transforms,
  };
}

export function emitAudioTransformRoutingEvents(
  context: AudioTransformRoutingEventContext,
  transforms: readonly AudioTranscriptionTransformEvidence[],
): void {
  for (const event of createAudioTransformRoutingEvents(context, transforms)) {
    context.eventBus?.emit(event);
  }
}

export function createAudioTransformRoutingEvents(
  context: Omit<AudioTransformRoutingEventContext, "eventBus">,
  transforms: readonly AudioTranscriptionTransformEvidence[],
): readonly MultimodalRoutedEvent[] {
  return transforms.map((transform) => {
    const succeeded = transform.status === "succeeded";
    const reasonCode = succeeded
      ? "audio_transcription_transform_succeeded"
      : "audio_transcription_transform_failed";
    return {
      type: "multimodal_routed",
      provider: context.provider ?? "gateway-transform",
      model: context.model,
      strategy: succeeded ? "transform" : "unsupported",
      reasonCode,
      reason: succeeded
        ? "Audio input was transformed to text by the governed transcription route."
        : "Audio input could not be transformed to text by the governed transcription route.",
      requestedCapability: "transcription",
      requiredModalities: ["audio"],
      artifactUris: [transform.sourceArtifactUri],
      diagnostics: [
        {
          code: reasonCode,
          severity: succeeded ? "info" : "error",
          message: succeeded
            ? transform.degradation
            : transform.errorMessage ?? "Audio transcription transform failed.",
          provider: context.provider ?? "gateway-transform",
          model: context.model,
        },
      ],
      timestamp: new Date(),
      sessionId: context.sessionId,
      ...(context.tenantId ? { tenantId: context.tenantId } : {}),
    } satisfies MultimodalRoutedEvent;
  });
}

export function createGatewayAudioTransformSessionId(
  appName: string,
  tenantId: string,
  externalUserId: string,
): string {
  return `gateway:${appName}:${tenantId}:${externalUserId}:audio-transform`;
}

async function resolveAudioSource(
  part: Extract<ContentPart, { type: "audio" }>,
  downloader: MediaDownloader,
): Promise<{ data: Uint8Array; mimeType: string }> {
  if (part.url) {
    return downloader.download(part.url);
  }
  if (part.data) {
    return {
      data: decodeBase64(part.data),
      mimeType: part.mimeType,
    };
  }
  throw new Error("Audio part must include a url or base64 data.");
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function persistAudioSourceArtifact(
  partIndex: number,
  source: { readonly data: Uint8Array; readonly mimeType: string },
  options: AudioTransformOptions,
): string {
  const namespace = options.artifactNamespace ?? "audio-transforms";
  const metadata = options.artifactStore.put({
    namespace,
    title: `Gateway audio source ${partIndex}`,
    mimeType: source.mimeType,
    content: {
      type: "blob",
      blob: Buffer.from(source.data).toString("base64"),
    },
    producer: { kind: "gateway", name: "audio-transcription-transform" },
    retention: { scope: "session", maxArtifacts: options.maxArtifacts ?? 50 },
    multimodal: {
      modality: "audio",
      source: {
        kind: "webhook-attachment",
        id: `${options.sourceIdPrefix}:part:${partIndex}`,
      },
    },
  });
  const artifact = options.artifactStore.get(namespace, metadata.id);
  const projected = artifact ? projectMultimodalArtifactResource(artifact) : undefined;
  if (!projected) {
    throw new Error("Stored audio artifact could not be projected as a multimodal replay reference.");
  }
  return projected.uri;
}

function failedTransformEvidence(input: {
  readonly sourceArtifactUri: string;
  readonly sourceMimeType: string;
  readonly provider: string;
  readonly errorMessage: string;
}): AudioTranscriptionTransformEvidence {
  return {
    transform: "transcription",
    status: "failed",
    requestedCapability: "transcription",
    sourceModality: "audio",
    outputModality: "text",
    sourceArtifactUri: input.sourceArtifactUri,
    sourceMimeType: input.sourceMimeType,
    provider: input.provider,
    provenance: `stt:${input.provider}`,
    degradation: TRANSCRIPTION_DEGRADATION,
    errorMessage: input.errorMessage,
  };
}

function audioSourceArtifactUri(partIndex: number): string {
  return `kiln://gateway/audio-transforms/source/${partIndex}`;
}
