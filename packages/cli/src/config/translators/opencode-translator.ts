import { translatePermission } from "../../wrapper/session-registry.js";
import type { KilnPermissionPolicy } from "../../wrapper/session.js";
import {
  PERMISSION_PROJECTION_TARGET_IDS,
  type PermissionProjection,
} from "./permission-projection.js";

export function translateOpenCodePermissionProjection(input: {
  readonly policy: KilnPermissionPolicy;
  readonly existingDocument: Record<string, unknown>;
}): PermissionProjection {
  const translated = translatePermission(input.policy, "opencode");
  const cfg = translated.config as { permissionDefault: string };
  const { kiln: _legacyKilnMetadata, ...existingDocument } = input.existingDocument;

  return {
    targetId: PERMISSION_PROJECTION_TARGET_IDS.opencode,
    managedFields: ["permission"],
    document: {
      ...existingDocument,
      permission: { default: cfg.permissionDefault },
    },
  };
}
