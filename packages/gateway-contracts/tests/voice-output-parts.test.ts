import { describe, expect, it } from "vitest";
import { projectVoiceAudioOutputParts } from "../src/voice-output-parts.js";

describe("projectVoiceAudioOutputParts", () => {
  it("projects audio parts with data URLs, remote URLs, and artifact references", () => {
    const projected = projectVoiceAudioOutputParts([
      { type: "text", text: "hello" },
      { type: "audio", mimeType: "audio/mpeg", data: "AQID", artifactUri: "kiln://artifacts/voice-synthesis/artifact_1/content", durationMs: 1234 },
      { type: "audio", mimeType: "audio/ogg", url: "https://cdn.example.com/out.ogg" },
      { type: "audio", mimeType: "audio/wav", artifactUri: "kiln://artifacts/voice-synthesis/artifact_2/content" },
    ]);

    expect(projected).toEqual([
      {
        index: 1,
        label: "Audio output 1.2s",
        mimeType: "audio/mpeg",
        source: "data-url",
        src: "data:audio/mpeg;base64,AQID",
        artifactUri: "kiln://artifacts/voice-synthesis/artifact_1/content",
        durationMs: 1234,
      },
      {
        index: 2,
        label: "Audio output",
        mimeType: "audio/ogg",
        source: "url",
        src: "https://cdn.example.com/out.ogg",
      },
      {
        index: 3,
        label: "Audio output",
        mimeType: "audio/wav",
        source: "artifact",
        artifactUri: "kiln://artifacts/voice-synthesis/artifact_2/content",
      },
    ]);
  });

  it("ignores malformed audio-like parts", () => {
    expect(projectVoiceAudioOutputParts([
      { type: "audio", mimeType: "text/plain", data: "bad" },
      { type: "audio", data: "bad" },
      null,
      "audio",
    ])).toEqual([]);
  });
});
