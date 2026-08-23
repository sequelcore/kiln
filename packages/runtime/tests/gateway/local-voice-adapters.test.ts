import { describe, expect, it } from "vitest";
import { KokoroLocalTtsAdapter, WhisperLocalSttAdapter } from "../../src/gateway/local-voice-adapters.js";

function protocolScript(handler: string): string {
  return `
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  ${handler}
});
`;
}

describe("local voice adapters", () => {
  it("transcribes audio through the local command protocol", async () => {
    const adapter = new WhisperLocalSttAdapter({
      command: process.execPath,
      args: ["-e", protocolScript(`
        if (request.operation !== "transcribe") throw new Error("wrong operation");
        if (request.model !== "small") throw new Error("wrong model");
        if (request.audioBase64 !== "AQID") throw new Error("wrong audio");
        process.stdout.write(JSON.stringify({ text: "hola mundo", confidence: 0.9, durationMs: 1000 }));
      `)],
      model: "small",
      language: "es",
    });

    const result = await adapter.transcribe(new Uint8Array([1, 2, 3]), "audio/wav");

    expect(result).toEqual({ text: "hola mundo", confidence: 0.9, durationMs: 1000 });
  });

  it("synthesizes speech through the local command protocol", async () => {
    const adapter = new KokoroLocalTtsAdapter({
      command: process.execPath,
      args: ["-e", protocolScript(`
        if (request.operation !== "synthesize") throw new Error("wrong operation");
        if (request.text !== "hola") throw new Error("wrong text");
        if (request.voice !== "es") throw new Error("wrong voice");
        process.stdout.write(JSON.stringify({ audioBase64: "BAUG", mimeType: "audio/wav", durationMs: 700 }));
      `)],
      model: "kokoro-v1",
      voice: "es",
      format: "wav",
    });

    const result = await adapter.synthesize("hola");

    expect(result).toEqual({
      audio: new Uint8Array([4, 5, 6]),
      mimeType: "audio/wav",
      durationMs: 700,
    });
  });

  it("fails closed when the local command returns invalid JSON", async () => {
    const adapter = new WhisperLocalSttAdapter({
      command: process.execPath,
      args: ["-e", "process.stdout.write('not-json')"],
      model: "small",
    });

    await expect(adapter.transcribe(new Uint8Array([1]), "audio/wav"))
      .rejects.toThrow("Local voice command returned invalid JSON");
  });

  it("terminates an in-flight local voice child when the active turn is cancelled", async () => {
    const adapter = new WhisperLocalSttAdapter({
      command: process.execPath,
      args: ["-e", "process.stdin.resume(); setInterval(() => undefined, 1000)"],
      model: "small",
    });
    const abort = new AbortController();
    const transcription = adapter.transcribe(new Uint8Array([1]), "audio/wav", { signal: abort.signal });

    abort.abort();

    await expect(transcription).rejects.toThrow();
  });
});
