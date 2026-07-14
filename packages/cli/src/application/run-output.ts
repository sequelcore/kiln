import type { VerificationResult } from "@kilnai/core";
import {
  VerifiedEfficiencyEvidenceProjectionSchema,
  type ContextUsageProjection,
  type VerifiedEfficiencyEvidenceProjection,
} from "@kilnai/gateway-contracts";
import type { ContextGovernanceSummary, SessionReport } from "../wrapper/index.js";
import type { RunSessionAttemptResult } from "./run-session.js";

export const RUN_OUTPUT_MODES = ["human", "answer", "json"] as const;

export type RunOutputMode = typeof RUN_OUTPUT_MODES[number];

export interface RunOutputSink {
  readonly mode: RunOutputMode;
  writeAssistantDelta(content: string): void;
  resetAssistantAnswer(answer: string): void;
  writeToolUse(toolName: string): void;
  writeProviderFallback(providerId: string): void;
}

export interface RunOutputController extends RunOutputSink {
  readonly capturedAnswer: string;
  writeTelemetryLine(line?: string): void;
  writeErrorLine(line: string): void;
  emitAnswer(answer: string): void;
  emitJson(envelope: RunJsonOutputEnvelope): void;
}

export interface RunJsonOutputEnvelope {
  readonly schemaVersion: "kiln.run.output.v1";
  readonly mode: "json";
  readonly answer: string;
  readonly telemetry: {
    readonly sessionId: string;
    readonly task: string;
    readonly domain: string;
    readonly sessionSucceeded: boolean;
    readonly provider?: string;
    readonly model?: string;
    readonly costUsd: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly toolCallCount: number;
    readonly turnDepth: number;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly durationMs: number;
    readonly verificationPassed?: boolean;
    readonly contextGovernance?: ContextGovernanceSummary;
    readonly contextUsage?: ContextUsageProjection;
    readonly efficiencyEvidence?: VerifiedEfficiencyEvidenceProjection;
  };
  readonly diagnostics: {
    readonly lastError: string | null;
    readonly attempts: readonly RunSessionAttemptResult[];
    readonly verificationResult?: VerificationResult;
    readonly evalScore?: SessionReport["evalScore"];
  };
  readonly resources: {
    readonly exactArtifacts: readonly string[];
  };
}

export function parseRunOutputMode(value: string | undefined): RunOutputMode {
  if (value === undefined || value.trim() === "") {
    return "human";
  }
  const normalized = value.trim().toLowerCase();
  if (isRunOutputMode(normalized)) {
    return normalized;
  }
  throw new Error(`Unknown run output mode '${value}'. Use human, answer, or json.`);
}

export function createRunOutputController(mode: RunOutputMode): RunOutputController {
  let capturedAnswer = "";
  return {
    mode,
    get capturedAnswer() {
      return capturedAnswer;
    },
    writeAssistantDelta(content: string): void {
      capturedAnswer += content;
      if (mode === "human") {
        process.stdout.write(content);
      }
    },
    resetAssistantAnswer(answer: string): void {
      capturedAnswer = answer;
    },
    writeToolUse(toolName: string): void {
      const line = `[tool] ${toolName}`;
      if (mode === "human") {
        console.log(line);
      } else {
        writeNonHumanTelemetry(line);
      }
    },
    writeProviderFallback(providerId: string): void {
      const line = `[kiln] Provider ${providerId} failed, trying next...`;
      if (mode === "human") {
        console.error(line);
      } else {
        writeNonHumanTelemetry(line);
      }
    },
    writeTelemetryLine(line = ""): void {
      if (mode === "human") {
        console.log(line);
      } else {
        writeNonHumanTelemetry(line);
      }
    },
    writeErrorLine(line: string): void {
      if (mode === "human") {
        console.error(line);
      } else {
        writeNonHumanTelemetry(line);
      }
    },
    emitAnswer(answer: string): void {
      if (mode === "answer") {
        process.stdout.write(answer);
      }
    },
    emitJson(envelope: RunJsonOutputEnvelope): void {
      if (mode === "json") {
        process.stdout.write(`${JSON.stringify(envelope)}\n`);
      }
    },
  };
}

export function createNonHumanRunOutputSink(mode: Exclude<RunOutputMode, "human"> = "answer"): RunOutputSink {
  return {
    mode,
    writeAssistantDelta(): void {},
    resetAssistantAnswer(): void {},
    writeToolUse(toolName: string): void {
      writeNonHumanTelemetry(`[tool] ${toolName}`);
    },
    writeProviderFallback(providerId: string): void {
      writeNonHumanTelemetry(`[kiln] Provider ${providerId} failed, trying next...`);
    },
  };
}

export function buildRunJsonOutputEnvelope(input: {
  readonly answer: string;
  readonly sessionId: string;
  readonly task: string;
  readonly domain: string;
  readonly sessionSucceeded: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly toolCallCount: number;
  readonly turnDepth: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly verificationPassed?: boolean;
  readonly contextGovernance?: ContextGovernanceSummary;
  readonly contextUsage?: ContextUsageProjection;
  readonly efficiencyEvidence?: VerifiedEfficiencyEvidenceProjection;
  readonly lastError: string | null;
  readonly attempts: readonly RunSessionAttemptResult[];
  readonly verificationResult?: VerificationResult;
  readonly evalScore?: SessionReport["evalScore"];
  readonly exactArtifacts: readonly string[];
}): RunJsonOutputEnvelope {
  return {
    schemaVersion: "kiln.run.output.v1",
    mode: "json",
    answer: input.answer,
    telemetry: {
      sessionId: input.sessionId,
      task: input.task,
      domain: input.domain,
      sessionSucceeded: input.sessionSucceeded,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      costUsd: input.costUsd,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      toolCallCount: input.toolCallCount,
      turnDepth: input.turnDepth,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs: input.durationMs,
      ...(input.verificationPassed !== undefined ? { verificationPassed: input.verificationPassed } : {}),
      ...(input.contextGovernance ? { contextGovernance: input.contextGovernance } : {}),
      ...(input.contextUsage ? { contextUsage: input.contextUsage } : {}),
      ...(input.efficiencyEvidence
        ? { efficiencyEvidence: VerifiedEfficiencyEvidenceProjectionSchema.parse(input.efficiencyEvidence) }
        : {}),
    },
    diagnostics: {
      lastError: input.lastError,
      attempts: input.attempts,
      ...(input.verificationResult ? { verificationResult: input.verificationResult } : {}),
      ...(input.evalScore ? { evalScore: input.evalScore } : {}),
    },
    resources: {
      exactArtifacts: input.exactArtifacts,
    },
  };
}

function isRunOutputMode(value: string): value is RunOutputMode {
  return RUN_OUTPUT_MODES.includes(value as RunOutputMode);
}

function writeNonHumanTelemetry(line = ""): void {
  process.stderr.write(`${line}\n`);
}
