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
import {
  dispatchRuntimeMediaAction,
  type RuntimeMediaActionClaimContext,
} from "../execution-kernel/runtime-media-action-claim.js";

const execFile = promisify(execFileCallback);
const DEFAULT_NAMESPACE = "multimodal-transforms";
const DEFAULT_OCR_LANGUAGE = "eng";
const DEFAULT_MAX_IMAGE_EDGE = 1536;
const DEFAULT_JPEG_QUALITY = 82;

export interface DefaultRuntimeMultimodalTransformOptions {
  readonly artifactStore?: ArtifactResourceStore;
  readonly artifactNamespace?: string;
  readonly ocrLanguage?: string;
  readonly maxImageEdge?: number;
  readonly jpegQuality?: number;
}

export function createDefaultRuntimeMultimodalTransformRoutes(
  options: DefaultRuntimeMultimodalTransformOptions = {},
): readonly RuntimeMultimodalTransformRoute[] {
  const namespace = options.artifactNamespace ?? DEFAULT_NAMESPACE;
  const ocrLanguage = options.ocrLanguage ?? DEFAULT_OCR_LANGUAGE;
  const maxImageEdge = options.maxImageEdge ?? DEFAULT_MAX_IMAGE_EDGE;
  const jpegQuality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY;

  return [
    Object.freeze({
      transform: "ocr",
      sourceModalities: ["image"] as const,
      outputModality: "text",
      provenance: "tesseract",
      degradation: "Extracts visible text from image input before model transport; non-text visual context is not preserved.",
      implementation: "runtime-built-in",
      artifactStore: options.artifactStore,
      artifactNamespace: namespace,
      ocrLanguage,
    }),
    Object.freeze({
      transform: "document-extraction",
      sourceModalities: ["document"] as const,
      outputModality: "text",
      provenance: "unpdf",
      degradation: "Extracts PDF text before model transport; layout, images, and unsupported document formats are not preserved.",
      implementation: "runtime-built-in",
      artifactStore: options.artifactStore,
      artifactNamespace: namespace,
    }),
    Object.freeze({
      transform: "downsample",
      sourceModalities: ["image"] as const,
      outputModality: "image",
      provenance: "sharp",
      degradation: "Reduces image dimensions and JPEG quality before model transport; the original image remains the transform source.",
      implementation: "runtime-built-in",
      artifactStore: options.artifactStore,
      artifactNamespace: namespace,
      maxImageEdge,
      jpegQuality,
    }),
  ];
}

export function runtimeMultimodalTransformEffectMode(
  route: RuntimeMultimodalTransformRoute,
): "deterministic" | "consequential" {
  return route.transform === "ocr" ? "consequential" : "deterministic";
}

/** Execute only the closed set of Runtime-owned built-in transforms. */
export async function executeDefaultRuntimeMultimodalTransform(input: {
  readonly route: RuntimeMultimodalTransformRoute;
  readonly execution: RuntimeMultimodalTransformExecutionInput;
}): Promise<RuntimeMultimodalTransformExecutionResult> {
  if (input.route.implementation !== "runtime-built-in") {
    throw new Error("Unsupported multimodal transform implementation.");
  }
  const artifactNamespace = input.route.artifactNamespace ?? DEFAULT_NAMESPACE;
  switch (input.route.transform) {
    case "ocr":
      return executeOcrTransform(input.execution, {
        artifactStore: input.route.artifactStore,
        namespace: artifactNamespace,
        language: input.route.ocrLanguage ?? DEFAULT_OCR_LANGUAGE,
      });
    case "document-extraction":
      return executeDocumentExtractionTransform(input.execution, {
        artifactStore: input.route.artifactStore,
        namespace: artifactNamespace,
      });
    case "downsample":
      return executeDownsampleTransform(input.execution, {
        artifactStore: input.route.artifactStore,
        namespace: artifactNamespace,
        maxImageEdge: input.route.maxImageEdge ?? DEFAULT_MAX_IMAGE_EDGE,
        jpegQuality: input.route.jpegQuality ?? DEFAULT_JPEG_QUALITY,
      });
  }
}

async function executeOcrTransform(
  input: RuntimeMultimodalTransformExecutionInput,
  options: {
    readonly artifactStore?: ArtifactResourceStore;
    readonly namespace: string;
    readonly language: string;
  },
): Promise<RuntimeMultimodalTransformExecutionResult> {
  const replacements = new Map<RuntimeMultimodalTransformSourcePart, readonly ContentPart[]>();
  const outputArtifactUris: string[] = [];
  let totalTextLength = 0;

  for (const source of pairSources(input, "image")) {
    const outcome = await dispatchRuntimeMediaAction({
      context: requireTransformMediaActionContext(input),
      authorityAdmission: input.authorityAdmission,
      attemptId: input.attemptId!,
      callerId: input.callerId!,
      idempotencyKey: input.idempotencyKey!,
      actionKind: "multimodal-process",
      sourceIdentity: source.artifact.uri,
      adapterIdentity: "local-command:tesseract",
      logicalSendSlot: `${input.logicalSendSlotPrefix ?? "multimodal:ocr"}:${source.artifact.uri}`,
      payload: {
        sourceArtifactUri: source.artifact.uri,
        sourceMimeType: source.part.mimeType,
        language: options.language,
      },
      abortSignal: input.abortSignal,
      call: async () => {
        const media = await resolveSourceBytes(source.part, input.abortSignal);
        return runTesseractOcr({
          data: media.data,
          mimeType: media.mimeType,
          language: options.language,
          signal: input.abortSignal,
        });
      },
    });
    const result = outcome;
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
    const result = await extractPdfText({ data: media.data });
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
    readonly maxImageEdge: number;
    readonly jpegQuality: number;
  },
): Promise<RuntimeMultimodalTransformExecutionResult> {
  const replacements = new Map<RuntimeMultimodalTransformSourcePart, readonly ContentPart[]>();
  const outputArtifactUris: string[] = [];

  for (const source of pairSources(input, "image")) {
    const media = await resolveSourceBytes(source.part);
    const result = await downsampleWithSharp({
      data: media.data,
      maxEdge: options.maxImageEdge,
      quality: options.jpegQuality,
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
  readonly signal?: AbortSignal;
}): Promise<{ readonly text: string; readonly source: string }> {
  const extension = imageExtension(request.mimeType);
  const path = join(tmpdir(), `kiln-ocr-${randomUUID()}.${extension}`);
  await writeFile(path, request.data);
  try {
    const result = await execFile("tesseract", [path, "stdout", "-l", request.language], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
      signal: request.signal,
    });
    return {
      text: result.stdout.trim(),
      source: "tesseract",
    };
  } finally {
    await rm(path, { force: true });
  }
}

function requireTransformMediaActionContext(
  input: RuntimeMultimodalTransformExecutionInput,
): RuntimeMediaActionClaimContext {
  if (!input.mediaActionClaims || !input.authorityAdmission || !input.attemptId
    || !input.callerId || !input.idempotencyKey) {
    throw new Error(
      "Consequential multimodal transforms require a workload-owned media action claim bound to the complete authority admission.",
    );
  }
  return input.mediaActionClaims;
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

async function resolveSourceBytes(
  part: RuntimeMultimodalTransformSourcePart,
  signal?: AbortSignal,
): Promise<{
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
    const res = await fetch(url, { signal });
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
