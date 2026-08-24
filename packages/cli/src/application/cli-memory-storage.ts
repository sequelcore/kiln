import { join } from "node:path";
import {
  resolveProjectStateBinding,
  type ProjectStateRootOptions,
} from "./project-state-root.js";

export type CliMemoryStorageOptions = Pick<ProjectStateRootOptions, "kilnHome">;

export interface CliMemoryStorageResolution {
  readonly projectRoot: string;
  readonly projectRuntimeId: `krp_${string}`;
  readonly stateDir: string;
  readonly memoryDbPath: string;
}

/**
 * Resolve Memory Lattice storage inside the project's one operator-private
 * namespace. Legacy app-state locations are intentionally not consulted.
 */
export function resolveCliMemoryStorage(
  projectPath: string,
  options: CliMemoryStorageOptions = {},
): CliMemoryStorageResolution {
  const binding = resolveProjectStateBinding(projectPath, options);
  const stateDir = binding.memoryPath;
  return {
    projectRoot: binding.canonicalRoot,
    projectRuntimeId: binding.projectRuntimeId,
    stateDir,
    memoryDbPath: join(stateDir, "memory.db"),
  };
}
