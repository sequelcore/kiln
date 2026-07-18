import { EOL } from "node:os";
import { describe, expect, it } from "vitest";
import { createGuiCommandOutput } from "../../src/commands/gui-command-output.js";

class MemoryOutput {
  readonly writes: string[] = [];

  write(chunk: string | Uint8Array): boolean {
    this.writes.push(chunk.toString());
    return true;
  }
}

describe("GUI command output", () => {
  it("writes every human message atomically with the platform line ending", () => {
    const stdout = new MemoryOutput();
    const stderr = new MemoryOutput();
    const output = createGuiCommandOutput({ stdout, stderr });

    output.info("Kiln GUI");
    output.warn("Provider discovery unavailable");
    output.error("GUI window failed");

    expect(stdout.writes).toEqual([`Kiln GUI${EOL}`]);
    expect(stderr.writes).toEqual([
      `Warning: Provider discovery unavailable${EOL}`,
      `Error: GUI window failed${EOL}`,
    ]);
  });

  it("normalizes embedded line endings so one message cannot corrupt later records", () => {
    const stdout = new MemoryOutput();
    const stderr = new MemoryOutput();
    const output = createGuiCommandOutput({ stdout, stderr });

    output.warn("first\r\nsecond\nthird");

    expect(stderr.writes).toEqual([
      `Warning: first\\nsecond\\nthird${EOL}`,
    ]);
  });
});
