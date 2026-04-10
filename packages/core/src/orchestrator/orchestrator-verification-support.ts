import { GateRunner, VerificationLoop } from "../verification/index.js";
import type { VerificationResult, VerificationConfig, FixHandler } from "../verification/index.js";
import type { EventBus } from "../events/event-bus.js";
import type { QualityGate } from "../engine/composites/team.js";

interface VerificationSupportDeps {
  readonly eventBus: EventBus;
  readonly getSessionId: () => string;
  readonly getMaxIterations: () => number;
}

export class OrchestratorVerificationSupport {
  private lastVerificationResult: VerificationResult | null = null;

  constructor(private readonly deps: VerificationSupportDeps) {}

  get verificationResult(): VerificationResult | null {
    return this.lastVerificationResult;
  }

  async runVerification(
    gates: readonly QualityGate[],
    cwd: string,
    fixHandler?: FixHandler,
  ): Promise<VerificationResult> {
    const gateRunner = new GateRunner({ cwd });
    const verificationConfig: VerificationConfig = {
      maxIterations: this.deps.getMaxIterations(),
      coverageThreshold: 0,
    };
    const loop = new VerificationLoop({
      gateRunner,
      eventBus: this.deps.eventBus,
      config: verificationConfig,
      gates,
      sessionId: this.deps.getSessionId(),
    });
    const result = await loop.run(fixHandler);
    this.lastVerificationResult = result;
    return result;
  }
}
