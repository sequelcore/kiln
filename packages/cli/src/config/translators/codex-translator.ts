import { translatePermission } from "../../wrapper/session-registry.js";
import type { KilnPermissionPolicy } from "../../wrapper/session.js";
import {
  asRecord,
  PERMISSION_PROJECTION_TARGET_IDS,
  toPermissionSyncMetadata,
  type PermissionProjection,
} from "./permission-projection.js";

export function translateCodexPermissionProjection(input: {
  readonly policy: KilnPermissionPolicy;
  readonly existingDocument: Record<string, unknown>;
}): PermissionProjection {
  const translated = translatePermission(input.policy, "codex");
  const cfg = translated.config as { approvalMode: string; sandboxMode: string };

  return {
    targetId: PERMISSION_PROJECTION_TARGET_IDS.codex,
    managedFields: ["approval_policy", "sandbox_mode", "kiln.permission_sync"],
    document: {
      ...input.existingDocument,
      approval_policy: cfg.approvalMode,
      sandbox_mode: cfg.sandboxMode,
      kiln: {
        ...asRecord(input.existingDocument.kiln),
        permission_sync: toPermissionSyncMetadata(translated),
      },
    },
  };
}
