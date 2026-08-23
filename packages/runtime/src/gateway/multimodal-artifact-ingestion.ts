import type {
  ArtifactResourceStore,
  ContentPart,
  MultimodalArtifactSource,
  MultimodalTransportModality,
  ToolResultPayloadPart,
} from "@kilnai/core";
import { KilnError, projectMultimodalArtifactResource } from "@kilnai/core";
import type { MediaDownloader } from "./audio-preprocessor.js";

export interface MultimodalArtifactCaptureOptions {
  readonly artifactStore: ArtifactResourceStore;
  readonly downloader?: MediaDownloader;
  readonly artifactNamespace?: string;
  readonly sourceKind: MultimodalArtifactSource["kind"];
  readonly sourceIdPrefix: string;
  readonly producerName: string;
  readonly maxArtifacts?: number;
  readonly abortSignal?: AbortSignal;
}

interface BinarySource {
  readonly blob: string;
  readonly mimeType: string;
}

const DEFAULT_ARTIFACT_NAMESPACE = "inbound-multimodal";

export async function captureMultimodalArtifacts(
  parts: readonly ContentPart[],
  options: MultimodalArtifactCaptureOptions,
): Promise<readonly ContentPart[]> {
  const normalized: ContentPart[] = [];
  for (let index = 0; index < parts.length; index++) {
    normalized.push(await captureContentPart(parts[index]!, options, `part:${index}`));
  }
  return normalized;
}

async function captureContentPart(
  part: ContentPart,
  options: MultimodalArtifactCaptureOptions,
  path: string,
): Promise<ContentPart> {
  if (part.type === "tool_result") {
    if (!part.contentParts) {
      return part;
    }
    const contentParts: ToolResultPayloadPart[] = [];
    for (let index = 0; index < part.contentParts.length; index++) {
      contentParts.push(await captureToolResultPayloadPart(
        part.contentParts[index]!,
        options,
        `${path}.contentParts.${index}`,
      ));
    }
    return { ...part, contentParts };
  }
  if (part.type === "image" || part.type === "audio" || part.type === "file") {
    return captureBinaryPart(part, options, path);
  }
  return part;
}

async function captureToolResultPayloadPart(
  part: ToolResultPayloadPart,
  options: MultimodalArtifactCaptureOptions,
  path: string,
): Promise<ToolResultPayloadPart> {
  if (part.type === "text") {
    return part;
  }
  return captureBinaryPart(part, options, path);
}

async function captureBinaryPart<T extends Extract<ContentPart, { type: "image" | "audio" | "file" }>>(
  part: T,
  options: MultimodalArtifactCaptureOptions,
  path: string,
): Promise<T> {
  if (part.artifactUri) {
    return part;
  }

  const source = await resolveBinarySource(part, options);
  const namespace = options.artifactNamespace ?? DEFAULT_ARTIFACT_NAMESPACE;
  const modality = modalityForPart(part);
  const metadata = options.artifactStore.put({
    namespace,
    title: `Inbound ${modality} ${path.replace(/^part:/, "")}`,
    mimeType: source.mimeType,
    content: {
      type: "blob",
      blob: source.blob,
    },
    producer: { kind: "gateway", name: options.producerName },
    retention: { scope: "session", maxArtifacts: options.maxArtifacts ?? 100 },
    multimodal: {
      modality,
      source: {
        kind: options.sourceKind,
        id: `${options.sourceIdPrefix}:${path}`,
      },
      ...(part.type === "audio" && part.durationMs !== undefined ? { durationMs: part.durationMs } : {}),
    },
  });
  const artifact = options.artifactStore.get(namespace, metadata.id);
  const projected = artifact ? projectMultimodalArtifactResource(artifact) : undefined;
  if (!projected) {
    throw new KilnError(
      "INTERNAL_ERROR",
      "Captured multimodal artifact could not be projected as a replay reference.",
      { context: { namespace, id: metadata.id, modality } },
    );
  }
  return { ...part, mimeType: source.mimeType, artifactUri: projected.uri };
}

async function resolveBinarySource(
  part: Extract<ContentPart, { type: "image" | "audio" | "file" }>,
  options: MultimodalArtifactCaptureOptions,
): Promise<BinarySource> {
  if (part.data !== undefined) {
    return {
      blob: part.data,
      mimeType: part.mimeType,
    };
  }
  if (part.url !== undefined) {
    if (!options.downloader) {
      throw new KilnError(
        "UNSUPPORTED_MODALITY",
        "URL-backed multimodal parts require a configured media downloader before artifact replay capture.",
        { context: { url: part.url, modality: modalityForPart(part) } },
      );
    }
    options.abortSignal?.throwIfAborted();
    const downloaded = await options.downloader.download(part.url, options.abortSignal);
    return {
      blob: Buffer.from(downloaded.data).toString("base64"),
      mimeType: downloaded.mimeType || part.mimeType,
    };
  }
  throw new KilnError(
    "UNSUPPORTED_MODALITY",
    `${part.type} part must include data or url before artifact replay capture.`,
    { context: { modality: modalityForPart(part) } },
  );
}

function modalityForPart(
  part: Extract<ContentPart, { type: "image" | "audio" | "file" }>,
): MultimodalTransportModality {
  if (part.type === "image") {
    return "image";
  }
  if (part.type === "audio") {
    return "audio";
  }
  return "document";
}
