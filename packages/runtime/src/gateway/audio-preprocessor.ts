// Audio preprocessor -- transcribes AudioParts to TextParts before orchestration

import type { ContentPart, SttAdapter } from "@kilnai/core";

export interface MediaDownloader {
  download(url: string): Promise<{ data: Uint8Array; mimeType: string }>;
}

export function createWhatsAppMediaDownloader(accessToken: string): MediaDownloader {
  return {
    async download(url: string): Promise<{ data: Uint8Array; mimeType: string }> {
      // Step 1: Resolve media URL from Graph API (url is graph.facebook.com/.../mediaId)
      const metaRes = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!metaRes.ok) {
        throw new Error(`WhatsApp media metadata fetch failed: ${metaRes.status}`);
      }
      const meta = (await metaRes.json()) as { url: string; mime_type: string };

      // Step 2: Download actual media binary
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

export async function preprocessAudio(
  parts: readonly ContentPart[],
  stt: SttAdapter,
  downloader: MediaDownloader,
): Promise<readonly ContentPart[]> {
  const result: ContentPart[] = [];

  for (const part of parts) {
    if (part.type !== "audio") {
      result.push(part);
      continue;
    }

    try {
      let data: Uint8Array;
      let mimeType: string;

      if (part.url) {
        const downloaded = await downloader.download(part.url);
        data = downloaded.data;
        mimeType = downloaded.mimeType;
      } else if (part.data) {
        // Base64-encoded audio
        const binary = atob(part.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        data = bytes;
        mimeType = part.mimeType;
      } else {
        result.push({ type: "text", text: "[Voice note: transcription unavailable]" });
        continue;
      }

      const transcription = await stt.transcribe(data, mimeType);
      result.push({ type: "text", text: `[Voice note transcription]: ${transcription.text}` });
    } catch {
      result.push({ type: "text", text: "[Voice note: transcription unavailable]" });
    }
  }

  return result;
}
