export class CleanupRegistry {
  private handlers: Set<() => Promise<void>> = new Set();

  register(fn: () => Promise<void>): void {
    this.handlers.add(fn);
  }

  async runAll(): Promise<void> {
    const handlers = [...this.handlers];
    this.handlers.clear();
    await Promise.allSettled(handlers.map((fn) => fn()));
  }
}

export const cleanupRegistry = new CleanupRegistry();
