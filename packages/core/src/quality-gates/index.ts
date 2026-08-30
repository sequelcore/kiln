/** One quality-gate execution result. */
export interface VerificationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly output: string;
  readonly duration: number;
}

/** Request passed to the Runtime-owned quality-gate command executor. */
export interface QualityGateCommandExecutionRequest {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
}

/** Result returned by a quality-gate command executor. */
export interface QualityGateCommandExecutionResult {
  readonly exitCode: number;
  readonly output: string;
}

/** Narrow process boundary used by Core's semantic quality-gate runner. */
export interface QualityGateCommandExecutor {
  execute(
    request: QualityGateCommandExecutionRequest,
  ): Promise<QualityGateCommandExecutionResult>;
}

/** Full iterative quality-gate result. */
export interface VerificationResult {
  readonly passed: boolean;
  readonly checks: readonly VerificationCheck[];
  readonly iteration: number;
  readonly maxIterations: number;
}

/** Quality-gate loop configuration. */
export interface VerificationConfig {
  readonly maxIterations: number;
  readonly coverageThreshold: number;
}

export { GateRunner } from "./gate-runner.js";
export { VerificationLoop } from "./verification-loop.js";
export type { FixHandler, GateRunnerPort } from "./verification-loop.js";
export { checkCoverage, parseCoverageFromOutput } from "./coverage-parser.js";
