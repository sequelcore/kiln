import type { SessionContext } from "../wrapper/index.js";
import type { KilnPermissionPolicy } from "../wrapper/session.js";

export function governSessionContext(
  context: SessionContext,
  permissionPolicy: KilnPermissionPolicy,
): SessionContext {
  if (permissionPolicy.fileGovernance?.excludeFromContext === true) {
    return {
      ...context,
      memorySnapshot: undefined,
    };
  }
  return context;
}
