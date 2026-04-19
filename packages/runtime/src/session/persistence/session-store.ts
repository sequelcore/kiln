import type { RuntimeSession } from "../runtime-session.js";

export interface SessionStore {
  get(key: string): Promise<RuntimeSession | undefined>;
  set(key: string, session: RuntimeSession): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteByPrefix(prefix: string): Promise<number>;
  keys(): Promise<string[]>;
}
