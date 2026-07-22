import { translatePermission } from "../../wrapper/session-registry.js";
import type { KilnPermissionPolicy } from "../../wrapper/session.js";
import {
  createPermissionProjection,
  PERMISSION_PROJECTION_TARGET_IDS,
  type PermissionProjection,
} from "./permission-projection.js";
import { resolveNativeDefaultRouteProjection } from "../native-route-integrity.js";
import type { KilnYaml } from "../../kiln-yaml-types.js";
import { mergeManagedFields, stripManagedFields } from "../native-projection-state.js";
import type { OpenCodeResponsesProjection } from "../model-gateway-native-projection.js";

export function translateOpenCodePermissionProjection(input: {
  readonly policy: KilnPermissionPolicy;
  readonly existingDocument: Record<string, unknown>;
  readonly kilnYaml?: KilnYaml;
  readonly ownsManagedDefault?: boolean;
  readonly gatewayProjection?: OpenCodeResponsesProjection;
  readonly previousManagedFields?: readonly string[];
}): PermissionProjection {
  const translated = translatePermission(input.policy, "opencode");
  const cfg = translated.config as { permissionDefault: string };
  const { kiln: _legacyKilnMetadata, ...rawExistingDocument } = input.existingDocument;
  const staleGatewayFields = (input.previousManagedFields ?? []).filter((field) => field === "provider.kiln");
  const existingDocument = stripManagedFields({ currentDocument: rawExistingDocument, managedFields: staleGatewayFields });
  if ((input.previousManagedFields ?? []).includes("enabled_providers") && !input.gatewayProjection) {
    const enabled = Array.isArray(existingDocument.enabled_providers)
      ? existingDocument.enabled_providers.filter((provider) => provider !== "kiln")
      : undefined;
    if (enabled?.length) existingDocument.enabled_providers = enabled;
    else delete existingDocument.enabled_providers;
  }
  const defaultRoute = !input.gatewayProjection && input.kilnYaml
    ? resolveNativeDefaultRouteProjection("opencode", input.kilnYaml)
    : undefined;
  const managedFields = [
    "permission",
    ...(defaultRoute?.status === "project" ? ["model"] : []),
    ...(input.gatewayProjection?.managedFields ?? []),
  ];
  const document: Record<string, unknown> = {
    ...existingDocument,
    permission: { default: cfg.permissionDefault },
  };
  if (input.gatewayProjection) {
    if (!input.gatewayProjection.managedFields.includes("model") && input.ownsManagedDefault) delete document.model;
    return createPermissionProjection({
      targetId: PERMISSION_PROJECTION_TARGET_IDS.opencode,
      managedFields: [...new Set(managedFields)],
      document: mergeManagedFields({ currentDocument: document, managedPatch: input.gatewayProjection.patch, managedFields: input.gatewayProjection.managedFields }),
      integrity: {
        harness: "opencode", policy: input.policy, translated,
        semanticLoss: cfg.permissionDefault === "allow"
          ? ["OpenCode allow resolves permission prompts but does not provide filesystem sandbox enforcement."]
          : ["OpenCode permission rules do not provide filesystem sandbox enforcement."],
        enforcement: { approvalControl: cfg.permissionDefault === "allow" || cfg.permissionDefault === "deny" ? "enforced" : "unknown", filesystemSandbox: "not-enforced", networkBoundary: "not-enforced", strength: "rules-only" },
      },
    });
  }
  if (defaultRoute?.status === "project" && defaultRoute.nativeModel) {
    document.model = defaultRoute.nativeModel;
  } else if ((defaultRoute?.status === "remove-stale" || defaultRoute?.status === "missing-default") && input.ownsManagedDefault) {
    delete document.model;
  }

  return createPermissionProjection({
    targetId: PERMISSION_PROJECTION_TARGET_IDS.opencode,
    managedFields,
    document,
    integrity: {
      harness: "opencode",
      policy: input.policy,
      translated,
      semanticLoss: cfg.permissionDefault === "allow"
        ? ["OpenCode allow resolves permission prompts but does not provide filesystem sandbox enforcement."]
        : ["OpenCode permission rules do not provide filesystem sandbox enforcement."],
      enforcement: {
        approvalControl: cfg.permissionDefault === "allow" || cfg.permissionDefault === "deny" ? "enforced" : "unknown",
        filesystemSandbox: "not-enforced",
        networkBoundary: "not-enforced",
        strength: "rules-only",
      },
    },
  });
}
