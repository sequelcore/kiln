import { describe, expect, it } from "vitest";
import { createGuiDevServerOutput } from "../../src/commands/gui-dev-server-output.js";

class MemoryOutput {
  readonly lines: string[] = [];

  write(chunk: string | Uint8Array): boolean {
    this.lines.push(chunk.toString());
    return true;
  }
}

describe("GUI dev server output", () => {
  it("condenses Vite startup noise into one readable readiness line", () => {
    const stdout = new MemoryOutput();
    const stderr = new MemoryOutput();
    const output = createGuiDevServerOutput({ stdout, stderr });

    output.writeStdout([
      "$ vite --port \"5183\"",
      "",
      "  VITE v7.3.1  ready in 2006 ms",
      "",
      "  ➜  Local:   http://localhost:5183/gui/",
      "  ➜  Network: use --host to expose",
      "",
    ].join("\n"));

    expect(stdout.lines).toEqual(["Dev server: ready in 2006 ms\n"]);
    expect(stderr.lines).toEqual([]);
  });

  it("preserves unknown dev-server diagnostics with a stable prefix", () => {
    const stdout = new MemoryOutput();
    const stderr = new MemoryOutput();
    const output = createGuiDevServerOutput({ stdout, stderr });

    output.writeStderr("warning: dependency was pre-bundled\n");
    output.writeStdout("hmr update /src/App.tsx\n");

    expect(stderr.lines).toEqual(["Dev server: warning: dependency was pre-bundled\n"]);
    expect(stdout.lines).toEqual(["Dev server: hmr update /src/App.tsx\n"]);
  });

  it("handles chunk boundaries without emitting partial lines", () => {
    const stdout = new MemoryOutput();
    const stderr = new MemoryOutput();
    const output = createGuiDevServerOutput({ stdout, stderr });

    output.writeStdout("  VITE v7.3.1  ready");
    output.writeStdout(" in 20 ms\n");

    expect(stdout.lines).toEqual(["Dev server: ready in 20 ms\n"]);
  });

  it("normalizes ANSI-colored Vite startup lines before filtering", () => {
    const stdout = new MemoryOutput();
    const stderr = new MemoryOutput();
    const output = createGuiDevServerOutput({ stdout, stderr });

    output.writeStdout("\u001B[36mVITE v7.3.1 \u001B[32mready in 41 ms\u001B[39m\n");
    output.writeStdout("\u001B[32m➜\u001B[39m  Local:   http://localhost:5183/gui/\n");

    expect(stdout.lines).toEqual(["Dev server: ready in 41 ms\n"]);
    expect(stderr.lines).toEqual([]);
  });
});
