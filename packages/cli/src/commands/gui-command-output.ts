import { EOL } from "node:os";

export interface GuiCommandOutput {
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly error: (message: string) => void;
}

interface GuiCommandOutputOptions {
  readonly stdout: Pick<NodeJS.WriteStream, "write">;
  readonly stderr: Pick<NodeJS.WriteStream, "write">;
}

export function createGuiCommandOutput(options: GuiCommandOutputOptions): GuiCommandOutput {
  return {
    info: (message) => writeRecord(options.stdout, message),
    warn: (message) => writeRecord(options.stderr, `Warning: ${message}`),
    error: (message) => writeRecord(options.stderr, `Error: ${message}`),
  };
}

function writeRecord(
  output: Pick<NodeJS.WriteStream, "write">,
  message: string,
): void {
  const singleLine = message.replace(/\r\n?|\n/gu, "\\n");
  output.write(`${singleLine}${EOL}`);
}
