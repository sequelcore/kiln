export interface GuiDevServerOutput {
  readonly writeStdout: (chunk: Buffer | string) => void;
  readonly writeStderr: (chunk: Buffer | string) => void;
}

interface GuiDevServerOutputOptions {
  readonly stdout: Pick<NodeJS.WriteStream, "write">;
  readonly stderr: Pick<NodeJS.WriteStream, "write">;
}

interface GuiDevServerOutputState {
  stdoutBuffer: string;
  stderrBuffer: string;
  readyReported: boolean;
}

export function createGuiDevServerOutput(options: GuiDevServerOutputOptions): GuiDevServerOutput {
  const state: GuiDevServerOutputState = {
    stdoutBuffer: "",
    stderrBuffer: "",
    readyReported: false,
  };

  return {
    writeStdout: (chunk) => {
      state.stdoutBuffer = writeGuiDevServerChunk({
        chunk,
        buffer: state.stdoutBuffer,
        state,
        output: options.stdout,
      });
    },
    writeStderr: (chunk) => {
      state.stderrBuffer = writeGuiDevServerChunk({
        chunk,
        buffer: state.stderrBuffer,
        state,
        output: options.stderr,
      });
    },
  };
}

function writeGuiDevServerChunk(input: {
  readonly chunk: Buffer | string;
  readonly buffer: string;
  readonly state: GuiDevServerOutputState;
  readonly output: Pick<NodeJS.WriteStream, "write">;
}): string {
  const normalized = `${input.buffer}${input.chunk.toString().replace(/\r\n/g, "\n")}`;
  const lines = normalized.split("\n");
  const trailing = lines.pop() ?? "";
  for (const line of lines) {
    writeGuiDevServerLine(line, input.state, input.output);
  }
  return trailing;
}

function writeGuiDevServerLine(
  rawLine: string,
  state: GuiDevServerOutputState,
  output: Pick<NodeJS.WriteStream, "write">,
): void {
  const line = stripAnsi(rawLine).trim();
  if (line.length === 0) return;

  const readyMatch = /^VITE v[^\s]+\s+ready in\s+(.+)$/u.exec(line);
  if (readyMatch) {
    if (!state.readyReported) {
      state.readyReported = true;
      output.write(`Dev server: ready in ${readyMatch[1]}\n`);
    }
    return;
  }

  if (isSuppressedViteStartupLine(line)) {
    return;
  }

  output.write(`Dev server: ${line}\n`);
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "");
}

function isSuppressedViteStartupLine(line: string): boolean {
  return /^\$\s+vite(?:\s|$)/u.test(line)
    || /^➜\s+Local:/u.test(line)
    || /^➜\s+Network:/u.test(line);
}
