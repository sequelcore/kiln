import { describeTrustedExecutionEnforcement, type TrustedExecutionAuthorizationRecord } from "@kilnai/core";
import type { KilnYaml } from "../../kiln-yaml-types.js";
import type { KilnPermissionPolicy } from "../../wrapper/session.js";
import { translatePermission } from "../../wrapper/session-registry.js";
import type { CodexResponsesProjection } from "../model-gateway-native-projection.js";
import { mergeManagedFields, stripManagedFields } from "../native-projection-state.js";
import { resolveNativeDefaultRouteProjection } from "../native-route-integrity.js";
import {
  asRecord,
  createPermissionProjection,
  PERMISSION_PROJECTION_TARGET_IDS,
  type PermissionProjection,
  toPermissionSyncMetadata,
} from "./permission-projection.js";

export function translateCodexPermissionProjection(input: {
  readonly policy: KilnPermissionPolicy;
  readonly existingDocument: Record<string, unknown>;
  readonly kilnYaml?: KilnYaml;
  readonly ownsManagedDefault?: boolean;
  readonly gatewayProjection?: CodexResponsesProjection;
  readonly previousManagedFields?: readonly string[];
  readonly storedAuthorization?: TrustedExecutionAuthorizationRecord;
}): PermissionProjection {
  const translated = translatePermission(input.policy, "codex");
  const cfg = translated.config as { approvalMode: string; sandboxMode: string };
  const staleGatewayFields = (input.previousManagedFields ?? []).filter(
    (field) =>
      field === "model_provider" ||
      field === "model_catalog_json" ||
      field === "web_search" ||
      field === "model_providers.kiln",
  );
  const existingDocument = stripManagedFields({
    currentDocument: sanitizeCodexConfigDocument(input.existingDocument),
    managedFields: staleGatewayFields,
  });
  const defaultRoute =
    !input.gatewayProjection && input.kilnYaml
      ? resolveNativeDefaultRouteProjection("codex", input.kilnYaml)
      : undefined;
  const managedFields = [
    "approval_policy",
    "sandbox_mode",
    "kiln.permission_sync",
    ...(defaultRoute?.status === "project" ? ["model"] : []),
    ...(input.gatewayProjection?.managedFields ?? []),
  ];
  const document: Record<string, unknown> = {
    ...existingDocument,
    approval_policy: cfg.approvalMode,
    sandbox_mode: cfg.sandboxMode,
    kiln: {
      ...asRecord(existingDocument.kiln),
      permission_sync: toPermissionSyncMetadata(translated),
    },
  };
  if (input.gatewayProjection) {
    if (!input.gatewayProjection.managedFields.includes("model") && input.ownsManagedDefault) delete document.model;
    return createPermissionProjection({
      targetId: PERMISSION_PROJECTION_TARGET_IDS.codex,
      managedFields: [...new Set(managedFields)],
      document: mergeManagedFields({
        currentDocument: document,
        managedPatch: input.gatewayProjection.patch,
        managedFields: input.gatewayProjection.managedFields,
      }),
      integrity: {
        harness: "codex",
        policy: input.policy,
        translated,
        enforcement: describeTrustedExecutionEnforcement({ harness: "codex" }),
        storedAuthorization: input.storedAuthorization,
      },
    });
  }
  if (defaultRoute?.status === "project" && defaultRoute.nativeModel) {
    document.model = defaultRoute.nativeModel;
  } else if (
    (defaultRoute?.status === "remove-stale" || defaultRoute?.status === "missing-default") &&
    input.ownsManagedDefault
  ) {
    delete document.model;
  }

  return createPermissionProjection({
    targetId: PERMISSION_PROJECTION_TARGET_IDS.codex,
    managedFields,
    document,
    integrity: {
      harness: "codex",
      policy: input.policy,
      translated,
      enforcement: describeTrustedExecutionEnforcement({ harness: "codex" }),
      storedAuthorization: input.storedAuthorization,
    },
  });
}

function sanitizeCodexConfigDocument(document: Record<string, unknown>): Record<string, unknown> {
  const next = { ...document };
  const serviceTier = next.service_tier;
  if (serviceTier !== "fast" && serviceTier !== "flex") {
    delete next.service_tier;
  }
  return next;
}
