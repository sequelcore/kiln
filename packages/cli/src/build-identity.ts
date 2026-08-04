import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };

/**
 * Identity of the build that is actually executing.
 *
 * A globally installed kiln resolves through a launcher shim and can lag the
 * working tree by arbitrary amounts. When such a build validates config against
 * the schema it was compiled with, a field the operator legitimately added is
 * rejected as unknown, and that is indistinguishable from a genuine config
 * error. Any diagnostic whose correctness depends on the build's own schema
 * knowledge must therefore state which build produced it.
 */
export const RUNNING_CLI_VERSION: string = pkg.version;

/**
 * Filesystem location of this module in the build that is executing. It is a
 * module path rather than the CLI entrypoint, because the question it answers
 * is "which installation is running", and any module inside that installation
 * answers it.
 */
export function resolveRunningCliModulePath(): string {
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return import.meta.url;
  }
}

export function describeRunningCliBuild(): string {
  return `kiln ${RUNNING_CLI_VERSION} at ${resolveRunningCliModulePath()}`;
}
