import { describe, expect, it } from "vitest";
import {
  createSignedArtifactMediaUrl,
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
    const url = createSignedArtifactMediaUrl({
      appName: "test-app",
      publicBaseUrl: "https://gateway.example.com",
      namespace: "voice-synthesis",
      id: "artifact_1",
      signingSecret: "secret",
      now: () => 1_000,
      ttlMs: 60_000,
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://gateway.example.com");
    expect(parsed.pathname).toBe("/media/test-app/voice-synthesis/artifact_1/content");
    expect(parsed.searchParams.get("expires")).toBe("61000");
    expect(verifySignedArtifactMediaRequest({
      appName: "test-app",
      namespace: "voice-synthesis",
      id: "artifact_1",
      expires: "61000",
      signature: parsed.searchParams.get("sig") ?? "",
      signingSecret: "secret",
      now: () => 2_000,
    })).toEqual({ ok: true });
  });
});
