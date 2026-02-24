/** Verification check result */
export interface VerificationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly output: string;
  readonly duration: number;
}

/** Full verification result */
export interface VerificationResult {
  readonly passed: boolean;
  readonly checks: readonly VerificationCheck[];
  readonly iteration: number;
  readonly maxIterations: number;
}

/** Verification loop configuration */
export interface VerificationConfig {
  readonly maxIterations: number;
  readonly coverageThreshold: number;
}

export { GateRunner } from "./gate-runner.js";
export { VerificationLoop } from "./verification-loop.js";
export type { FixHandler, GateRunnerPort } from "./verification-loop.js";
export { parseCoverageFromOutput, checkCoverage } from "./coverage-parser.js";
