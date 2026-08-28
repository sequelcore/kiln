// Local voice adapters -- private Runtime command protocol for offline STT/TTS

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import type { KilnErrorCode, SttAdapter, SttOptions, SttResult, TtsAdapter, TtsOptions, TtsResult } from "@kilnai/core";
import { KilnError } from "@kilnai/core";

const DEFAULT_LOCAL_VOICE_TIMEOUT_MS = 120_000;

interface LocalVoiceCommandConfig {
  readonly command: string;
  readonly args?: readonly string[];
  readonly model?: string;
  readonly modelPath?: string;
  readonly device?: string;
  readonly timeoutMs?: number;
}

export interface WhisperLocalSttAdapterConfig extends LocalVoiceCommandConfig {
  readonly language?: string;
}

export interface KokoroLocalTtsAdapterConfig extends LocalVoiceCommandConfig {
  readonly voice?: string;
  readonly format?: string;
}

interface LocalVoiceCommandRequest {
  readonly operation: "transcribe" | "synthesize";
  readonly provider: "whisper-local" | "kokoro-local";
  readonly model?: string;
  readonly modelPath?: string;
  readonly device?: string;
  readonly language?: string;
  readonly mimeType?: string;
  readonly audioBase64?: string;
  readonly text?: string;
  readonly voice?: string;
  readonly speed?: number;
  readonly format?: string;
}

export class WhisperLocalSttAdapter implements SttAdapter {
  readonly name = "whisper-local";

  constructor(private readonly config: WhisperLocalSttAdapterConfig) {}

  async transcribe(audio: Uint8Array, mimeType: string, options: SttOptions = {}): Promise<SttResult> {
    const response = await runLocalVoiceCommand(
      this.config,
      {
        operation: "transcribe",
        provider: "whisper-local",
        model: this.config.model,
        modelPath: this.config.modelPath,
        device: this.config.device,
        language: this.config.language,
        mimeType,
        audioBase64: Buffer.from(audio).toString("base64"),
      },
      "STT_FAILED",
      options.signal,
    );

    if (typeof response.text !== "string") {
      throw new KilnError("STT_FAILED", "Local STT command response must include text", {
        context: { provider: this.name },
      });
    }

    return {
      text: response.text,
      ...(typeof response.confidence === "number" ? { confidence: response.confidence } : {}),
      ...(typeof response.durationMs === "number" ? { durationMs: response.durationMs } : {}),
    };
  }
}

export class KokoroLocalTtsAdapter implements TtsAdapter {
  readonly name = "kokoro-local";

  constructor(private readonly config: KokoroLocalTtsAdapterConfig) {}

  async synthesize(text: string, options: TtsOptions = {}): Promise<TtsResult> {
    const format = options.format ?? this.config.format;
    const response = await runLocalVoiceCommand(
      this.config,
      {
        operation: "synthesize",
        provider: "kokoro-local",
        model: this.config.model,
        modelPath: this.config.modelPath,
        device: this.config.device,
        text,
        voice: options.voice ?? this.config.voice,
        language: options.language,
        speed: options.speed,
        format,
      },
      "TTS_FAILED",
      options.signal,
    );

    if (typeof response.audioBase64 !== "string") {
      throw new KilnError("TTS_FAILED", "Local TTS command response must include audioBase64", {
        context: { provider: this.name },
      });
    }

    const audio = Buffer.from(response.audioBase64, "base64");
    if (audio.byteLength === 0) {
      throw new KilnError("TTS_FAILED", "Local TTS command returned empty audio", {
        context: { provider: this.name },
      });
    }

    return {
      audio: new Uint8Array(audio),
      mimeType: typeof response.mimeType === "string" ? response.mimeType : `audio/${format ?? "wav"}`,
      ...(typeof response.durationMs === "number" ? { durationMs: response.durationMs } : {}),
    };
  }
}

async function runLocalVoiceCommand(
  config: LocalVoiceCommandConfig,
  request: LocalVoiceCommandRequest,
  failureCode: KilnErrorCode,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const stdout = await executeLocalVoiceCommand(config, request, failureCode, signal);

  try {
    const parsed = JSON.parse(stdout);
    if (!isRecord(parsed)) {
      throw new Error("response is not an object");
    }
    return parsed;
  } catch (error) {
    throw new KilnError(failureCode, "Local voice command returned invalid JSON", {
      context: { command: config.command },
      cause: error,
    });
  }
}

function executeLocalVoiceCommand(
  config: LocalVoiceCommandConfig,
  request: LocalVoiceCommandRequest,
  failureCode: KilnErrorCode,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.command, [...(config.args ?? [])], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      signal,
    });

    let settled = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timeoutMs = config.timeoutMs ?? DEFAULT_LOCAL_VOICE_TIMEOUT_MS;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new KilnError(failureCode, "Local voice command timed out", {
        context: { command: config.command, timeoutMs },
        retryable: false,
      }));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new KilnError(failureCode, "Local voice command could not start", {
        context: { command: config.command },
        cause: error,
      }));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

      if (code !== 0) {
        reject(new KilnError(failureCode, `Local voice command failed with exit code ${code ?? "unknown"}`, {
          context: { command: config.command, exitCode: code, stderr },
        }));
        return;
      }

      resolve(stdout);
    });

    child.stdin.end(JSON.stringify(request));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
