import type { RuntimeSession } from "../runtime-session.js";
import type { SessionStore } from "./session-store.js";

export class InMemorySessionStore implements SessionStore {
  private readonly store = new Map<string, RuntimeSession>();

  async get(key: string): Promise<RuntimeSession | undefined> {
    return this.store.get(key);
  }

  async set(key: string, session: RuntimeSession): Promise<void> {
    this.store.set(key, session);
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  async keys(): Promise<string[]> {
    return [...this.store.keys()];
  }
}
