import { describe, expect, it } from "vitest";
import {
  VOICE_INPUT_CAPTURE_MIME_TYPES,
  createVoiceInputParts,
  selectVoiceInputCaptureMimeType,
  voiceInputDisplayText,
} from "../src/voice-input-parts.js";

describe("voice input parts", () => {
  it("creates text plus audio content parts from a recorded audio blob", async () => {
    const parts = await createVoiceInputParts({
      audio: new Blob(["abc"], { type: "audio/webm" }),
      transcript: "spoken request",
      durationMs: 1234,
    });

    expect(parts).toEqual([
      { type: "text", text: "spoken request" },
      {
        type: "audio",
        mimeType: "audio/webm",
        data: "YWJj",
        durationMs: 1234,
      },
    ]);
  });

  it("rejects non-audio blobs before building content parts", async () => {
    await expect(createVoiceInputParts({
      audio: new Blob(["abc"], { type: "text/plain" }),
    })).rejects.toThrow("Voice input must be an audio MIME type.");
  });

  it("selects the first supported browser recording MIME type", () => {
    const selected = selectVoiceInputCaptureMimeType((mimeType) => mimeType === "audio/webm;codecs=opus");

    expect(selected).toBe("audio/webm;codecs=opus");
    expect(VOICE_INPUT_CAPTURE_MIME_TYPES).toContain(selected);
  });

  it("formats compact display text for recorded voice input", () => {
    expect(voiceInputDisplayText(1234)).toBe("Voice input 1.2s");
    expect(voiceInputDisplayText()).toBe("Voice input");
  });
});
