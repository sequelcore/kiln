import { describe, expect, it } from "vitest";
import type { KilnGlobalConfig } from "../../src/config/global-config.js";
import { resolveOperatorVoiceRuntime } from "../../src/config/operator-voice.js";

describe("resolveOperatorVoiceRuntime", () => {
  it("dynamically loads the Runtime factories for both configured voice adapters", async () => {
    const config = {
      version: "7",
      operatorVoice: {
        stt: {
          provider: "whisper-local",
          command: process.execPath,
        },
        tts: {
          provider: "kokoro-local",
          command: process.execPath,
        },
      },
    } satisfies KilnGlobalConfig;

    const resolved = await resolveOperatorVoiceRuntime(config);

    expect(resolved.sttAdapter?.name).toBe("whisper-local");
    expect(resolved.ttsAdapter?.name).toBe("kokoro-local");
    expect(resolved.warnings).toEqual([]);
  });
});
