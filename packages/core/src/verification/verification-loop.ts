import type { EventBus } from "../events/event-bus.js";
import type { VerificationResultEvent } from "../events/index.js";
import type { QualityGate } from "../engine/composites/team.js";
import type { VerificationCheck, VerificationResult, VerificationConfig } from "./index.js";
import { checkCoverage } from "./coverage-parser.js";

/** Port for running quality gates (allows mocking in tests) */
export interface GateRunnerPort {
  runRequired(
    gates: readonly QualityGate[],
  ): Promise<{ passed: boolean; checks: VerificationCheck[] }>;
}

/** Handler called between iterations to fix failing gates */
export type FixHandler = (failedChecks: readonly VerificationCheck[]) => Promise<void>;

/**
 * Iterative verification loop: runs quality gates, optionally retries with a fix handler,
 * and emits verification_result events on each iteration.
 */
export class VerificationLoop {
  private readonly gateRunner: GateRunnerPort;
  private readonly eventBus: EventBus;
  private readonly config: VerificationConfig;
  private readonly gates: readonly QualityGate[];
  private readonly sessionId: string;

  constructor(opts: {
    gateRunner: GateRunnerPort;
    eventBus: EventBus;
    config: VerificationConfig;
    gates: readonly QualityGate[];
    sessionId?: string;
  }) {
    this.gateRunner = opts.gateRunner;
    this.eventBus = opts.eventBus;
    this.config = opts.config;
    this.gates = opts.gates;
    this.sessionId = opts.sessionId ?? "";
  }

  async run(fixHandler?: FixHandler): Promise<VerificationResult> {
    for (let iteration = 1; iteration <= this.config.maxIterations; iteration++) {
      const gateResult = await this.gateRunner.runRequired(this.gates);
      const checks: VerificationCheck[] = [...gateResult.checks];
      let passed = gateResult.passed;

      // Coverage threshold check
      if (this.config.coverageThreshold > 0) {
        const testCheck = checks.find((c) => c.name.toLowerCase().includes("test"));
        if (testCheck) {
          const cov = checkCoverage(testCheck.output, this.config.coverageThreshold);
          if (!cov.passed) {
            checks.push({
              name: "coverage",
              passed: false,
              output: `Coverage ${cov.coverage ?? 0}% below threshold ${this.config.coverageThreshold}%`,
              duration: 0,
            });
            passed = false;
          }
        }
      }

      const result: VerificationResult = {
        passed,
        checks,
        iteration,
        maxIterations: this.config.maxIterations,
      };

      // Emit event
      const event: VerificationResultEvent = {
        type: "verification_result",
        passed: result.passed,
        iteration,
        maxIterations: this.config.maxIterations,
        checks: result.checks.map((c) => ({ name: c.name, passed: c.passed, output: c.output })),
        timestamp: new Date(),
        sessionId: this.sessionId,
      };
      this.eventBus.emit(event);

      if (passed) {
        return result;
      }

      if (iteration < this.config.maxIterations && fixHandler) {
        const failedChecks = checks.filter((c) => !c.passed);
        await fixHandler(failedChecks);
        continue;
      }

      return result;
    }

    // Unreachable in practice (loop always returns), but satisfies TypeScript
    throw new Error("VerificationLoop: unexpected exit");
  }
}
