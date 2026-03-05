import type { ModeBSession } from "./mode-b-session.js";

export interface SessionStore {
  get(key: string): Promise<ModeBSession | undefined>;
  set(key: string, session: ModeBSession): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteByPrefix(prefix: string): Promise<number>;
  keys(): Promise<string[]>;
}
