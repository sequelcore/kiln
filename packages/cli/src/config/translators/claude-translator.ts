import { translatePermission } from "../../wrapper/session-registry.js";
import type { KilnPermissionPolicy } from "../../wrapper/session.js";
import {
  asRecord,
  createPermissionProjection,
  PERMISSION_PROJECTION_TARGET_IDS,
  toPermissionSyncMetadata,
  type PermissionProjection,
} from "./permission-projection.js";
import { mergeManagedFields, stripManagedFields } from "../native-projection-state.js";
import type { ClaudeMessagesProjection } from "../model-gateway-native-projection.js";

export function translateClaudePermissionProjection(input: {
  readonly policy: KilnPermissionPolicy;
  readonly existingDocument: Record<string, unknown>;
  readonly gatewayProjection?: ClaudeMessagesProjection;
  readonly previousManagedFields?: readonly string[];
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

  const staleGatewayFields = (input.previousManagedFields ?? []).filter((field) => field === "model" || field.startsWith("env."));
  const existingDocument = stripManagedFields({
    currentDocument: input.existingDocument,
    managedFields: staleGatewayFields,
  });
  const document: Record<string, unknown> = {
    ...existingDocument,
    permissions: { allow, deny },
    kiln: {
      ...asRecord(existingDocument.kiln),
      permissionSync: toPermissionSyncMetadata(translated),
    },
  };
  const managedFields = ["permissions", "kiln.permissionSync", ...(input.gatewayProjection?.managedFields ?? [])];

  return createPermissionProjection({
    targetId: PERMISSION_PROJECTION_TARGET_IDS.claude,
    managedFields: [...new Set(managedFields)],
    document: input.gatewayProjection
      ? mergeManagedFields({ currentDocument: document, managedPatch: input.gatewayProjection.patch, managedFields: input.gatewayProjection.managedFields })
      : document,
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
