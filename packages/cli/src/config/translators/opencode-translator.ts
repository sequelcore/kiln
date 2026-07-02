import { translatePermission } from "../../wrapper/session-registry.js";
import type { KilnPermissionPolicy } from "../../wrapper/session.js";
import {
  createPermissionProjectionIntegrity,
  PERMISSION_PROJECTION_TARGET_IDS,
  type PermissionProjection,
} from "./permission-projection.js";
import { resolveNativeDefaultRouteProjection } from "../native-route-integrity.js";
import type { KilnYaml } from "../../kiln-yaml-types.js";

export function translateOpenCodePermissionProjection(input: {
  readonly policy: KilnPermissionPolicy;
  readonly existingDocument: Record<string, unknown>;
  readonly kilnYaml?: KilnYaml;
  readonly ownsManagedDefault?: boolean;
}): PermissionProjection {
  const translated = translatePermission(input.policy, "opencode");
  const cfg = translated.config as { permissionDefault: string };
  const { kiln: _legacyKilnMetadata, ...existingDocument } = input.existingDocument;
  const defaultRoute = input.kilnYaml
    ? resolveNativeDefaultRouteProjection("opencode", input.kilnYaml)
    : undefined;
  const managedFields = [
    "permission",
    ...(defaultRoute?.status === "project" ? ["model"] : []),
  ];
  const document: Record<string, unknown> = {
    ...existingDocument,
    permission: { default: cfg.permissionDefault },
  };
  if (defaultRoute?.status === "project" && defaultRoute.nativeModel) {
    document.model = defaultRoute.nativeModel;
  } else if ((defaultRoute?.status === "remove-stale" || defaultRoute?.status === "missing-default") && input.ownsManagedDefault) {
    delete document.model;
  }

  return {
    targetId: PERMISSION_PROJECTION_TARGET_IDS.opencode,
    managedFields,
    document,
    integrity: createPermissionProjectionIntegrity({
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
    }),
  };
}
