import { describeTrustedExecutionEnforcement, type TrustedExecutionAuthorizationRecord } from "@kilnai/core";
import type { KilnPermissionPolicy } from "../../wrapper/session.js";
import { type ClaudeNativeRules, translatePermission } from "../../wrapper/session-registry.js";
import type { ClaudeMessagesProjection } from "../model-gateway-native-projection.js";
import { mergeManagedFields, stripManagedFields } from "../native-projection-state.js";
import {
  asRecord,
  createPermissionProjection,
  PERMISSION_PROJECTION_TARGET_IDS,
  type PermissionProjection,
  toPermissionSyncMetadata,
} from "./permission-projection.js";

export function translateClaudePermissionProjection(input: {
  readonly policy: KilnPermissionPolicy;
  readonly existingDocument: Record<string, unknown>;
  readonly gatewayProjection?: ClaudeMessagesProjection;
  readonly previousManagedFields?: readonly string[];
  readonly storedAuthorization?: TrustedExecutionAuthorizationRecord;
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

  // The coarse mode sets the baseline; the rules the policy states explicitly
  // are layered on top. Without this the granular rules Kiln classifies as
  // natively representable are computed and then dropped.
  const nativeRules = translated.nativeRules as ClaudeNativeRules;
  const ask = [...nativeRules.ask];
  allow.push(...nativeRules.allow.filter((rule) => !allow.includes(rule)));
  deny.push(...nativeRules.deny.filter((rule) => !deny.includes(rule)));

  const staleGatewayFields = (input.previousManagedFields ?? []).filter(
    (field) => field === "model" || field.startsWith("env."),
  );
  const existingDocument = stripManagedFields({
    currentDocument: input.existingDocument,
    managedFields: staleGatewayFields,
  });
  const document: Record<string, unknown> = {
    ...existingDocument,
    permissions: { allow, deny, ask, defaultMode: cfg.permissionMode },
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
      ? mergeManagedFields({
          currentDocument: document,
          managedPatch: input.gatewayProjection.patch,
          managedFields: input.gatewayProjection.managedFields,
        })
      : document,
    integrity: {
      harness: "claude-code",
      policy: input.policy,
      translated,
      semanticLoss:
        cfg.permissionMode === "bypassPermissions"
          ? ["Claude Code bypassPermissions bypasses prompts but is not equivalent to Codex sandbox enforcement."]
          : [],
      enforcement: describeTrustedExecutionEnforcement({
        harness: "claude-code",
        allowDangerouslySkipPermissions: cfg.allowDangerouslySkipPermissions,
      }),
      storedAuthorization: input.storedAuthorization,
    },
  });
}
