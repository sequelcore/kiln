import { spawn } from "node:child_process";
import type { QualityGate } from "../engine/composites/team.js";
import type { VerificationCheck } from "./index.js";

const MAX_OUTPUT_LENGTH = 2000;

export class GateRunner {
  private readonly cwd: string;
  private readonly timeoutMs: number;

  constructor({ cwd, timeoutMs = 60_000 }: { cwd: string; timeoutMs?: number }) {
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
  }

  async run(gate: QualityGate): Promise<VerificationCheck> {
    const start = Date.now();

    try {
      const result = await this.execute(gate.command);
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

  private execute(command: string): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, { cwd: this.cwd, shell: true });
      const chunks: string[] = [];

      child.stdout?.on("data", (data: Buffer) => {
        chunks.push(data.toString());
      });

      child.stderr?.on("data", (data: Buffer) => {
        chunks.push(data.toString());
      });

      const timer = setTimeout(() => {
        child.kill();
        resolve({ exitCode: 1, output: `timeout after ${this.timeoutMs}ms` });
      }, this.timeoutMs);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? 1, output: chunks.join("") });
      });
    });
  }
}
