import type { Checkpoint, CheckpointOptions } from "./checkpoint-types.js";

export interface CheckpointStore {
  save(checkpoint: Checkpoint, options?: CheckpointOptions): Promise<void>;
  load(id: string): Promise<Checkpoint | null>;
  listBySession(sessionId: string): Promise<readonly Checkpoint[]>;
  listChildren(parentId: string): Promise<readonly Checkpoint[]>;
  delete(id: string): Promise<void>;
}
