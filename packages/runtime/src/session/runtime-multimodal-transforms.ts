import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  ArtifactResourceStore,
  ContentPart,
  MultimodalArtifact,
} from "@kilnai/core";
import { projectMultimodalArtifactResource } from "@kilnai/core";
import type {
  RuntimeMultimodalTransformExecutionInput,
  RuntimeMultimodalTransformExecutionResult,
  RuntimeMultimodalTransformRoute,
  RuntimeMultimodalTransformSourcePart,
} from "./runtime-session-orchestrator.types.js";

const execFile = promisify(execFileCallback);
const DEFAULT_NAMESPACE = "multimodal-transforms";
const DEFAULT_OCR_LANGUAGE = "eng";
const DEFAULT_MAX_IMAGE_EDGE = 1536;
const DEFAULT_JPEG_QUALITY = 82;

export interface RuntimeOcrRunner {
  (request: {
    readonly data: Uint8Array;
    readonly mimeType: string;
    readonly language: string;
    readonly sourceArtifactUri: string;
  }): Promise<{
    readonly text: string;
    readonly confidence?: number;
    readonly source?: string;
  }>;
}

export interface RuntimeDocumentTextExtractor {
  (request: {
    readonly data: Uint8Array;
    readonly mimeType: string;
    readonly filename?: string;
    readonly sourceArtifactUri: string;
  }): Promise<{
    readonly text: string;
    readonly totalPages?: number;
    readonly source?: string;
  }>;
}

export interface RuntimeImageDownsampler {
  (request: {
    readonly data: Uint8Array;
    readonly mimeType: string;
    readonly maxEdge: number;
    readonly quality: number;
    readonly sourceArtifactUri: string;
  }): Promise<{
    readonly data: Uint8Array;
    readonly mimeType: string;
    readonly width?: number;
    readonly height?: number;
    readonly source?: string;
  }>;
}

export interface DefaultRuntimeMultimodalTransformOptions {
  readonly artifactStore?: ArtifactResourceStore;
  readonly artifactNamespace?: string;
  readonly ocrRunner?: RuntimeOcrRunner;
  readonly documentTextExtractor?: RuntimeDocumentTextExtractor;
  readonly imageDownsampler?: RuntimeImageDownsampler;
  readonly ocrLanguage?: string;
  readonly maxImageEdge?: number;
  readonly jpegQuality?: number;
}

export function createDefaultRuntimeMultimodalTransformRoutes(
  options: DefaultRuntimeMultimodalTransformOptions = {},
): readonly RuntimeMultimodalTransformRoute[] {
  const namespace = options.artifactNamespace ?? DEFAULT_NAMESPACE;
  const ocrRunner = options.ocrRunner ?? runTesseractOcr;
  const documentTextExtractor = options.documentTextExtractor ?? extractPdfText;
  const imageDownsampler = options.imageDownsampler ?? downsampleWithSharp;
  const ocrLanguage = options.ocrLanguage ?? DEFAULT_OCR_LANGUAGE;
  const maxImageEdge = options.maxImageEdge ?? DEFAULT_MAX_IMAGE_EDGE;
  const jpegQuality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY;

  return [
    {
      transform: "ocr",
      sourceModalities: ["image"],
      outputModality: "text",
      provenance: "tesseract",
      degradation: "Extracts visible text from image input before model transport; non-text visual context is not preserved.",
      execute: (input) => executeOcrTransform(input, {
        artifactStore: options.artifactStore,
        namespace,
        runner: ocrRunner,
        language: ocrLanguage,
      }),
    },
    {
      transform: "document-extraction",
      sourceModalities: ["document"],
      outputModality: "text",
      provenance: "unpdf",
      degradation: "Extracts PDF text before model transport; layout, images, and unsupported document formats are not preserved.",
      execute: (input) => executeDocumentExtractionTransform(input, {
        artifactStore: options.artifactStore,
        namespace,
        extractor: documentTextExtractor,
      }),
    },
    {
      transform: "downsample",
      sourceModalities: ["image"],
      outputModality: "image",
      provenance: "sharp",
      degradation: "Reduces image dimensions and JPEG quality before model transport; the original image remains the transform source.",
      execute: (input) => executeDownsampleTransform(input, {
        artifactStore: options.artifactStore,
        namespace,
        downsampler: imageDownsampler,
        maxImageEdge,
        jpegQuality,
      }),
    },
  ];
}

async function executeOcrTransform(
  input: RuntimeMultimodalTransformExecutionInput,
  options: {
    readonly artifactStore?: ArtifactResourceStore;
    readonly namespace: string;
    readonly runner: RuntimeOcrRunner;
    readonly language: string;
  },
): Promise<RuntimeMultimodalTransformExecutionResult> {
  const replacements = new Map<RuntimeMultimodalTransformSourcePart, readonly ContentPart[]>();
  const outputArtifactUris: string[] = [];
  let totalTextLength = 0;

  for (const source of pairSources(input, "image")) {
    const media = await resolveSourceBytes(source.part);
    const result = await options.runner({
      data: media.data,
      mimeType: media.mimeType,
      language: options.language,
      sourceArtifactUri: source.artifact.uri,
    });
    const text = result.text.trim();
    totalTextLength += text.length;
    const rendered = `[Image OCR transform from ${source.artifact.uri}]: ${text || "(no text detected)"}`;
    const artifactUri = persistTextTransformArtifact(options.artifactStore, {
      namespace: options.namespace,
      title: "Image OCR transform",
      transform: "ocr",
      text: rendered,
      sourceArtifact: source.artifact,
    });
    if (artifactUri) outputArtifactUris.push(artifactUri);
    replacements.set(source.part, [{ type: "text", text: rendered }]);
  }

  return {
    parts: replaceSourceParts(input.userParts, replacements),
    summary: `OCR transform completed for ${replacements.size} image artifact(s).`,
    ...(outputArtifactUris.length > 0 ? { outputArtifactUris } : {}),
    metadata: {
      imageCount: replacements.size,
      textLength: totalTextLength,
      language: options.language,
    },
  };
}

async function executeDocumentExtractionTransform(
  input: RuntimeMultimodalTransformExecutionInput,
  options: {
    readonly artifactStore?: ArtifactResourceStore;
    readonly namespace: string;
    readonly extractor: RuntimeDocumentTextExtractor;
  },
): Promise<RuntimeMultimodalTransformExecutionResult> {
  const replacements = new Map<RuntimeMultimodalTransformSourcePart, readonly ContentPart[]>();
  const outputArtifactUris: string[] = [];
  let totalPages = 0;
  let totalTextLength = 0;

  for (const source of pairSources(input, "file")) {
    const media = await resolveSourceBytes(source.part);
    if (media.mimeType !== "application/pdf") {
      throw new Error(`Document extraction supports application/pdf, received ${media.mimeType}.`);
    }
    const result = await options.extractor({
      data: media.data,
      mimeType: media.mimeType,
      filename: source.part.filename,
      sourceArtifactUri: source.artifact.uri,
    });
    const text = result.text.trim();
    totalPages += result.totalPages ?? 0;
    totalTextLength += text.length;
    const rendered = `[Document extraction from ${source.artifact.uri}]: ${text || "(no text extracted)"}`;
    const artifactUri = persistTextTransformArtifact(options.artifactStore, {
      namespace: options.namespace,
      title: "Document extraction transform",
      transform: "document-extraction",
      text: rendered,
      sourceArtifact: source.artifact,
    });
    if (artifactUri) outputArtifactUris.push(artifactUri);
    replacements.set(source.part, [{ type: "text", text: rendered }]);
  }

  return {
    parts: replaceSourceParts(input.userParts, replacements),
    summary: `Document extraction completed for ${replacements.size} document artifact(s).`,
    ...(outputArtifactUris.length > 0 ? { outputArtifactUris } : {}),
    metadata: {
      documentCount: replacements.size,
      totalPages,
      textLength: totalTextLength,
    },
  };
}

async function executeDownsampleTransform(
  input: RuntimeMultimodalTransformExecutionInput,
  options: {
    readonly artifactStore?: ArtifactResourceStore;
    readonly namespace: string;
    readonly downsampler: RuntimeImageDownsampler;
    readonly maxImageEdge: number;
    readonly jpegQuality: number;
  },
): Promise<RuntimeMultimodalTransformExecutionResult> {
  const replacements = new Map<RuntimeMultimodalTransformSourcePart, readonly ContentPart[]>();
  const outputArtifactUris: string[] = [];

  for (const source of pairSources(input, "image")) {
    const media = await resolveSourceBytes(source.part);
    const result = await options.downsampler({
      data: media.data,
      mimeType: media.mimeType,
      maxEdge: options.maxImageEdge,
      quality: options.jpegQuality,
      sourceArtifactUri: source.artifact.uri,
    });
    const data = Buffer.from(result.data).toString("base64");
    const artifactUri = persistBlobTransformArtifact(options.artifactStore, {
      namespace: options.namespace,
      title: "Image downsample transform",
      transform: "downsample",
      data,
      mimeType: result.mimeType,
      sourceArtifact: source.artifact,
      width: result.width,
      height: result.height,
    });
    if (artifactUri) outputArtifactUris.push(artifactUri);
    replacements.set(source.part, [{
      type: "image",
      mimeType: result.mimeType,
      data,
    }]);
  }

  return {
    parts: replaceSourceParts(input.userParts, replacements),
    summary: `Image downsample completed for ${replacements.size} image artifact(s).`,
    ...(outputArtifactUris.length > 0 ? { outputArtifactUris } : {}),
    metadata: {
      imageCount: replacements.size,
      maxImageEdge: options.maxImageEdge,
      jpegQuality: options.jpegQuality,
    },
  };
}

async function runTesseractOcr(request: {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly language: string;
}): Promise<{ readonly text: string; readonly source: string }> {
  const extension = imageExtension(request.mimeType);
  const path = join(tmpdir(), `kiln-ocr-${randomUUID()}.${extension}`);
  await writeFile(path, request.data);
  try {
    const result = await execFile("tesseract", [path, "stdout", "-l", request.language], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    });
    return {
      text: result.stdout.trim(),
      source: "tesseract",
    };
  } finally {
    await rm(path, { force: true });
  }
}

async function extractPdfText(request: {
  readonly data: Uint8Array;
}): Promise<{ readonly text: string; readonly totalPages: number; readonly source: string }> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(request.data);
  const result = await extractText(pdf, { mergePages: true });
  return {
    text: result.text,
    totalPages: result.totalPages,
    source: "unpdf",
  };
}

async function downsampleWithSharp(request: {
  readonly data: Uint8Array;
  readonly maxEdge: number;
  readonly quality: number;
}): Promise<{
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly width?: number;
  readonly height?: number;
  readonly source: string;
}> {
  const sharp = (await import("sharp")).default;
  const output = await sharp(request.data)
    .rotate()
    .resize({
      width: request.maxEdge,
      height: request.maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: request.quality })
    .toBuffer();
  const metadata = await sharp(output).metadata();
  return {
    data: output,
    mimeType: "image/jpeg",
    source: "sharp",
    ...(metadata.width !== undefined ? { width: metadata.width } : {}),
    ...(metadata.height !== undefined ? { height: metadata.height } : {}),
  };
}

type RuntimeMultimodalTransformSourcePartOfType<T extends RuntimeMultimodalTransformSourcePart["type"]> = Extract<
  RuntimeMultimodalTransformSourcePart,
  { readonly type: T }
>;

function pairSources<T extends RuntimeMultimodalTransformSourcePart["type"]>(
  input: RuntimeMultimodalTransformExecutionInput,
  partType: T,
): readonly {
  readonly artifact: MultimodalArtifact;
  readonly part: RuntimeMultimodalTransformSourcePartOfType<T>;
}[] {
  const sourceParts = input.sourceParts.filter(
    (part): part is RuntimeMultimodalTransformSourcePartOfType<T> => part.type === partType,
  );
  return input.sourceArtifacts
    .map((artifact, index) => {
      const part = sourceParts[index];
      return part ? { artifact, part } : undefined;
    })
    .filter(
      (
        pair,
      ): pair is { readonly artifact: MultimodalArtifact; readonly part: RuntimeMultimodalTransformSourcePartOfType<T> } =>
        pair !== undefined,
    );
}

async function resolveSourceBytes(part: RuntimeMultimodalTransformSourcePart): Promise<{
  readonly data: Uint8Array;
  readonly mimeType: string;
}> {
  if (part.data) {
    return {
      data: Buffer.from(part.data, "base64"),
      mimeType: part.mimeType,
    };
  }
  if (part.url) {
    const url = new URL(part.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error(`Unsupported transform source URL protocol: ${url.protocol}`);
    }
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Transform source download failed: ${res.status}`);
    }
    return {
      data: new Uint8Array(await res.arrayBuffer()),
      mimeType: res.headers.get("content-type") ?? part.mimeType,
    };
  }
  throw new Error(`Transform source ${part.type} part has neither data nor URL.`);
}

function replaceSourceParts(
  userParts: readonly ContentPart[],
  replacements: ReadonlyMap<RuntimeMultimodalTransformSourcePart, readonly ContentPart[]>,
): readonly ContentPart[] {
  return userParts.flatMap((part) => {
    if (isRuntimeTransformSourcePart(part)) {
      return replacements.get(part) ?? [part];
    }
    return [part];
  });
}

function isRuntimeTransformSourcePart(part: ContentPart): part is RuntimeMultimodalTransformSourcePart {
  return part.type === "image" || part.type === "file";
}

function persistTextTransformArtifact(
  store: ArtifactResourceStore | undefined,
  input: {
    readonly namespace: string;
    readonly title: string;
    readonly transform: string;
    readonly text: string;
    readonly sourceArtifact: MultimodalArtifact;
  },
): string | undefined {
  if (!store) {
    return undefined;
  }
  const metadata = store.put({
    namespace: input.namespace,
    title: input.title,
    mimeType: "text/plain",
    content: { type: "text", text: input.text },
    producer: {
      kind: "runtime-transform",
      name: input.transform,
    },
    retention: { scope: "session" },
    multimodal: {
      modality: "text",
      source: {
        kind: "transform-output",
        id: `${input.transform}:${input.sourceArtifact.uri}`,
      },
    },
  });
  const artifact = store.get(input.namespace, metadata.id);
  return artifact ? projectMultimodalArtifactResource(artifact)?.uri : undefined;
}

function persistBlobTransformArtifact(
  store: ArtifactResourceStore | undefined,
  input: {
    readonly namespace: string;
    readonly title: string;
    readonly transform: string;
    readonly data: string;
    readonly mimeType: string;
    readonly sourceArtifact: MultimodalArtifact;
    readonly width?: number;
    readonly height?: number;
  },
): string | undefined {
  if (!store) {
    return undefined;
  }
  const metadata = store.put({
    namespace: input.namespace,
    title: input.title,
    mimeType: input.mimeType,
    content: { type: "blob", blob: input.data },
    producer: {
      kind: "runtime-transform",
      name: input.transform,
    },
    retention: { scope: "session" },
    multimodal: {
      modality: "image",
      source: {
        kind: "transform-output",
        id: `${input.transform}:${input.sourceArtifact.uri}`,
      },
      ...(input.width !== undefined && input.height !== undefined
        ? { dimensions: { width: input.width, height: input.height } }
        : {}),
    },
  });
  const artifact = store.get(input.namespace, metadata.id);
  return artifact ? projectMultimodalArtifactResource(artifact)?.uri : undefined;
}

function imageExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "img";
  }
}
