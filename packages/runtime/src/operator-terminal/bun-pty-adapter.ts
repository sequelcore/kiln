import type {
  OperatorPtyAdapter,
  OperatorPtyProcess,
  OperatorPtySpawnInput,
} from "./operator-terminal-service.js";

class BunPtyProcess implements OperatorPtyProcess {
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: { readonly exitCode: number }) => void>();
  private readonly backlog: string[];
  private exited = false;
  private exitEvent: { readonly exitCode: number } | undefined;

  constructor(
    private readonly process: Bun.Subprocess,
    private readonly terminal: Bun.Terminal,
    pendingData: readonly string[],
    finalizeData: () => string,
  ) {
    this.backlog = [...pendingData];
    void process.exited.then((exitCode) => {
      if (this.exited) return;
      const finalData = finalizeData();
      if (finalData) this.emitData(finalData);
      this.exited = true;
      this.exitEvent = { exitCode };
      for (const listener of this.exitListeners) listener(this.exitEvent);
      this.exitListeners.clear();
      this.dataListeners.clear();
      this.terminal.close();
    });
  }

  emitData(data: string): void {
    if (this.dataListeners.size === 0) {
      this.backlog.push(data);
      return;
    }
    for (const listener of this.dataListeners) listener(data);
  }

  write(data: string): void {
    this.terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  kill(): void {
    if (!this.exited) this.process.kill();
  }

  onData(listener: (data: string) => void): () => void {
    this.dataListeners.add(listener);
    for (const data of this.backlog.splice(0)) listener(data);
    return () => this.dataListeners.delete(listener);
  }

  onExit(listener: (event: { readonly exitCode: number }) => void): () => void {
    if (this.exitEvent) {
      listener(this.exitEvent);
      return () => undefined;
    }
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }
}

export class BunPtyAdapter implements OperatorPtyAdapter {
  async spawn(input: OperatorPtySpawnInput): Promise<OperatorPtyProcess> {
    const decoder = new TextDecoder();
    const pendingData: string[] = [];
    let wrapper: BunPtyProcess | undefined;
    const process = Bun.spawn([input.executable, ...input.args], {
      cwd: input.cwd,
      env: { ...input.env, TERM: globalThis.process.platform === "win32" ? "xterm-color" : "xterm-256color" },
      terminal: {
        cols: input.cols,
        rows: input.rows,
        data(_terminal, data) {
          const decoded = decoder.decode(data, { stream: true });
          if (!decoded) return;
          if (wrapper) wrapper.emitData(decoded);
          else pendingData.push(decoded);
        },
      },
    });
    if (!process.terminal) {
      process.kill();
      throw new Error("Bun did not attach a terminal to the operator shell.");
    }
    wrapper = new BunPtyProcess(process, process.terminal, pendingData, () => decoder.decode());
    return wrapper;
  }
}
