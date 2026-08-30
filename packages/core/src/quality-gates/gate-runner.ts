import type { QualityGate } from "../engine/domain/quality-gate.js";
import type {
  QualityGateCommandExecutor,
  VerificationCheck,
} from "./index.js";

const MAX_OUTPUT_LENGTH = 2000;

export class GateRunner {
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly commandExecutor: QualityGateCommandExecutor;

  constructor({
    cwd,
    timeoutMs = 60_000,
    commandExecutor,
  }: {
    cwd: string;
    timeoutMs?: number;
    commandExecutor: QualityGateCommandExecutor;
  }) {
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.commandExecutor = commandExecutor;
  }

  async run(gate: QualityGate): Promise<VerificationCheck> {
    const start = Date.now();

    try {
      const result = await this.commandExecutor.execute({
        command: gate.command,
        cwd: this.cwd,
        timeoutMs: this.timeoutMs,
      });
      const duration = Date.now() - start;
      const output = result.output.length > MAX_OUTPUT_LENGTH
        ? result.output.slice(0, MAX_OUTPUT_LENGTH)
        : result.output;

      return { name: gate.name, passed: result.exitCode === 0, output, duration };
    } catch (err) {
      const duration = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return { name: gate.name, passed: false, output: message, duration };
    }
  }

  async runAll(gates: readonly QualityGate[]): Promise<VerificationCheck[]> {
    const results: VerificationCheck[] = [];
    for (const gate of gates) {
      results.push(await this.run(gate));
    }
    return results;
  }

  async runRequired(gates: readonly QualityGate[]): Promise<{ passed: boolean; checks: VerificationCheck[] }> {
    const checks = await this.runAll(gates);
    const passed = gates.every((gate, i) => !gate.required || checks[i]!.passed);
    return { passed, checks };
  }
}
