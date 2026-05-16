import { createHmac, timingSafeEqual } from "node:crypto";
import type { ContentPart } from "@kilnai/core";

export interface ArtifactContentReference {
  readonly namespace: string;
  readonly id: string;
}

export interface OutboundMediaPublishInput {
  readonly channel: string;
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly mimeType: string;
  readonly artifactUri?: string;
  readonly sourceUrl?: string;
  readonly filename?: string;
  readonly purpose: "assistant-output";
}

export interface OutboundMediaPublication {
  readonly url: string;
  readonly mimeType: string;
  readonly artifactUri?: string;
}

export interface OutboundMediaPublisher {
  publish(input: OutboundMediaPublishInput): Promise<OutboundMediaPublication>;
}

export interface SignedArtifactMediaPublisherOptions {
  readonly appName: string;
  readonly publicBaseUrl: string;
  readonly signingSecret: string;
  readonly ttlMs?: number;
  readonly now?: () => number;
}

export interface SignedArtifactMediaRequest {
  readonly appName: string;
  readonly namespace: string;
  readonly id: string;
  readonly expires: string | undefined;
  readonly signature: string | undefined;
  readonly signingSecret: string;
  readonly now?: () => number;
}

export interface OutboundAudioMediaDelivery {
  readonly url: string;
  readonly mimeType: string;
  readonly artifactUri?: string;
}

export interface OutboundAudioMediaFailure {
  readonly index: number;
  readonly reason: string;
  readonly artifactUri?: string;
}

export interface ResolveOutboundAudioMediaResult {
  readonly deliveries: readonly OutboundAudioMediaDelivery[];
  readonly failures: readonly OutboundAudioMediaFailure[];
}

const DEFAULT_PUBLIC_MEDIA_TTL_MS = 5 * 60 * 1000;
const ARTIFACT_CONTENT_URI_PATTERN = /^kiln:\/\/artifacts\/([^/]+)\/([^/]+)\/content$/u;

export function parseArtifactContentUri(uri: string): ArtifactContentReference {
  const match = ARTIFACT_CONTENT_URI_PATTERN.exec(uri);
  if (!match) {
    throw new Error(`Invalid artifact content URI: ${uri}`);
  }
  return { namespace: match[1]!, id: match[2]! };
}

export function createSignedArtifactMediaPublisher(
  options: SignedArtifactMediaPublisherOptions,
): OutboundMediaPublisher {
  return {
    async publish(input) {
      if (!input.artifactUri) {
        throw new Error("Public media publishing requires an artifactUri.");
      }
      const reference = parseArtifactContentUri(input.artifactUri);
      return {
        url: createSignedArtifactMediaUrl({
          appName: options.appName,
          publicBaseUrl: options.publicBaseUrl,
          namespace: reference.namespace,
          id: reference.id,
          signingSecret: options.signingSecret,
          ttlMs: options.ttlMs,
          now: options.now,
        }),
        mimeType: input.mimeType,
        artifactUri: input.artifactUri,
      };
    },
  };
}

export function createSignedArtifactMediaUrl(input: {
  readonly appName: string;
  readonly publicBaseUrl: string;
  readonly namespace: string;
  readonly id: string;
  readonly signingSecret: string;
  readonly ttlMs?: number;
  readonly now?: () => number;
}): string {
  const now = input.now ?? Date.now;
  const expires = now() + (input.ttlMs ?? DEFAULT_PUBLIC_MEDIA_TTL_MS);
  const signature = signArtifactMediaRequest({
    appName: input.appName,
    namespace: input.namespace,
    id: input.id,
    expires,
    signingSecret: input.signingSecret,
  });
  const url = new URL(
    `/media/${encodeURIComponent(input.appName)}/${encodeURIComponent(input.namespace)}/${encodeURIComponent(input.id)}/content`,
    input.publicBaseUrl.endsWith("/") ? input.publicBaseUrl : `${input.publicBaseUrl}/`,
  );
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("sig", signature);
  return url.toString();
}

export function verifySignedArtifactMediaRequest(input: SignedArtifactMediaRequest): { ok: true } | { ok: false; reason: string } {
  if (!input.expires || !input.signature) {
    return { ok: false, reason: "missing-signature" };
  }
  const expires = Number(input.expires);
  if (!Number.isSafeInteger(expires) || expires < 0) {
    return { ok: false, reason: "invalid-expires" };
  }
  const now = input.now ?? Date.now;
  if (expires < now()) {
    return { ok: false, reason: "expired" };
  }
  const expected = signArtifactMediaRequest({
    appName: input.appName,
    namespace: input.namespace,
    id: input.id,
    expires,
    signingSecret: input.signingSecret,
  });
  if (!safeEqualHex(input.signature, expected)) {
    return { ok: false, reason: "invalid-signature" };
  }
  return { ok: true };
}

export async function resolveOutboundAudioMedia(
  parts: readonly ContentPart[],
  context: {
    readonly publisher?: OutboundMediaPublisher;
    readonly appName: string;
    readonly tenantId: string;
    readonly userId: string;
    readonly channel: string;
  },
): Promise<ResolveOutboundAudioMediaResult> {
  const deliveries: OutboundAudioMediaDelivery[] = [];
  const failures: OutboundAudioMediaFailure[] = [];

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (part.type !== "audio") {
      continue;
    }
    if (!part.mimeType.startsWith("audio/")) {
      failures.push({ index, reason: "invalid-audio-mime", artifactUri: part.artifactUri });
      continue;
    }
    if (part.url && isPublicHttpsUrl(part.url)) {
      deliveries.push({ url: part.url, mimeType: part.mimeType, ...(part.artifactUri ? { artifactUri: part.artifactUri } : {}) });
      continue;
    }
    if (!context.publisher) {
      failures.push({ index, reason: "missing-public-media-publisher", artifactUri: part.artifactUri });
      continue;
    }
    try {
      const publication = await context.publisher.publish({
        channel: context.channel,
        appName: context.appName,
        tenantId: context.tenantId,
        userId: context.userId,
        mimeType: part.mimeType,
        ...(part.artifactUri ? { artifactUri: part.artifactUri } : {}),
        ...(part.url ? { sourceUrl: part.url } : {}),
        purpose: "assistant-output",
      });
      if (!isPublicHttpsUrl(publication.url)) {
        failures.push({ index, reason: "publisher-returned-non-https-url", artifactUri: part.artifactUri });
        continue;
      }
      deliveries.push(publication);
    } catch (error) {
      failures.push({
        index,
        reason: error instanceof Error ? error.message : String(error),
        artifactUri: part.artifactUri,
      });
    }
  }

  return { deliveries, failures };
}

function signArtifactMediaRequest(input: {
  readonly appName: string;
  readonly namespace: string;
  readonly id: string;
  readonly expires: number;
  readonly signingSecret: string;
}): string {
  return createHmac("sha256", input.signingSecret)
    .update(`${input.appName}\n${input.namespace}\n${input.id}\n${input.expires}`)
    .digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/iu.test(left) || !/^[a-f0-9]+$/iu.test(right)) {
    return false;
  }
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
