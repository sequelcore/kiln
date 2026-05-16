import { describe, expect, it } from "vitest";
import {
  createSignedArtifactMediaPublisher,
  parseArtifactContentUri,
  verifySignedArtifactMediaRequest,
} from "../../src/gateway/public-media-delivery.js";

describe("public media delivery", () => {
  it("parses canonical artifact content URIs", () => {
    expect(parseArtifactContentUri("kiln://artifacts/voice-synthesis/artifact_1/content")).toEqual({
      namespace: "voice-synthesis",
      id: "artifact_1",
    });
  });

  it("creates signed public URLs for channel media delivery", async () => {
    const publisher = createSignedArtifactMediaPublisher({
      appName: "test-app",
      publicBaseUrl: "https://gateway.example.com",
      signingSecret: "secret",
      now: () => 1_000,
      ttlMs: 60_000,
    });

    const publication = await publisher.publish({
      channel: "whatsapp",
      appName: "test-app",
      tenantId: "tenant-1",
      userId: "+521234",
      mimeType: "audio/mpeg",
      artifactUri: "kiln://artifacts/voice-synthesis/artifact_1/content",
      purpose: "assistant-output",
    });

    const url = new URL(publication.url);
    expect(url.origin).toBe("https://gateway.example.com");
    expect(url.pathname).toBe("/media/test-app/voice-synthesis/artifact_1/content");
    expect(url.searchParams.get("expires")).toBe("61000");
    expect(verifySignedArtifactMediaRequest({
      appName: "test-app",
      namespace: "voice-synthesis",
      id: "artifact_1",
      expires: "61000",
      signature: url.searchParams.get("sig") ?? "",
      signingSecret: "secret",
      now: () => 2_000,
    })).toEqual({ ok: true });
  });
});
