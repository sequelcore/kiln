import { translatePermission } from "../../wrapper/session-registry.js";
import type { KilnPermissionPolicy } from "../../wrapper/session.js";
import {
  asRecord,
  PERMISSION_PROJECTION_TARGET_IDS,
  toPermissionSyncMetadata,
  type PermissionProjection,
} from "./permission-projection.js";

export function translateOpenCodePermissionProjection(input: {
  readonly policy: KilnPermissionPolicy;
  readonly existingDocument: Record<string, unknown>;
}): PermissionProjection {
  const translated = translatePermission(input.policy, "opencode");
  const cfg = translated.config as { permissionDefault: string };

  return {
    targetId: PERMISSION_PROJECTION_TARGET_IDS.opencode,
    managedFields: ["permission", "kiln.permissionSync"],
    document: {
      ...input.existingDocument,
      permission: { default: cfg.permissionDefault },
      kiln: {
        ...asRecord(input.existingDocument.kiln),
        permissionSync: toPermissionSyncMetadata(translated),
      },
    },
  };
}
