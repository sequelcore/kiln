import { translatePermission } from "../../wrapper/session-registry.js";
import type { KilnPermissionPolicy } from "../../wrapper/session.js";
import {
  asRecord,
  createPermissionProjection,
  PERMISSION_PROJECTION_TARGET_IDS,
  toPermissionSyncMetadata,
  type PermissionProjection,
} from "./permission-projection.js";

export function translateClaudePermissionProjection(input: {
  readonly policy: KilnPermissionPolicy;
  readonly existingDocument: Record<string, unknown>;
}): PermissionProjection {
  const translated = translatePermission(input.policy, "claude");
  const cfg = translated.config as { permissionMode: string; allowDangerouslySkipPermissions: boolean };

  const allow: string[] = [];
  const deny: string[] = [];

  if (cfg.allowDangerouslySkipPermissions) {
    allow.push("Write", "Edit", "Bash", "NotebookEdit", "WebFetch", "Read");
  } else if (cfg.permissionMode === "default") {
    allow.push("Read", "WebFetch");
  } else if (cfg.permissionMode === "plan") {
    deny.push("Write", "Edit", "Bash", "NotebookEdit", "WebFetch");
  }

  return createPermissionProjection({
    targetId: PERMISSION_PROJECTION_TARGET_IDS.claude,
    managedFields: ["permissions", "kiln.permissionSync"],
    document: {
      ...input.existingDocument,
      permissions: { allow, deny },
      kiln: {
        ...asRecord(input.existingDocument.kiln),
        permissionSync: toPermissionSyncMetadata(translated),
      },
    },
    integrity: {
      harness: "claude-code",
      policy: input.policy,
      translated,
      semanticLoss: cfg.permissionMode === "bypassPermissions"
        ? ["Claude Code bypassPermissions bypasses prompts but is not equivalent to Codex sandbox enforcement."]
        : [],
      enforcement: {
        approvalControl: cfg.allowDangerouslySkipPermissions ? "enforced" : "unknown",
        filesystemSandbox: "not-enforced",
        networkBoundary: "not-enforced",
        strength: "rules-only",
      },
    },
  });
}
