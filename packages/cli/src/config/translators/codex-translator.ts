import { translatePermission } from "../../wrapper/session-registry.js";
import type { KilnPermissionPolicy } from "../../wrapper/session.js";
import {
  asRecord,
  createPermissionProjection,
  PERMISSION_PROJECTION_TARGET_IDS,
  toPermissionSyncMetadata,
  type PermissionProjection,
} from "./permission-projection.js";
import { resolveNativeDefaultRouteProjection } from "../native-route-integrity.js";
import type { KilnYaml } from "../../kiln-yaml-types.js";

export function translateCodexPermissionProjection(input: {
  readonly policy: KilnPermissionPolicy;
  readonly existingDocument: Record<string, unknown>;
  readonly kilnYaml?: KilnYaml;
  readonly ownsManagedDefault?: boolean;
}): PermissionProjection {
  const translated = translatePermission(input.policy, "codex");
  const cfg = translated.config as { approvalMode: string; sandboxMode: string };
  const existingDocument = sanitizeCodexConfigDocument(input.existingDocument);
  const defaultRoute = input.kilnYaml
    ? resolveNativeDefaultRouteProjection("codex", input.kilnYaml)
    : undefined;
  const managedFields = [
    "approval_policy",
    "sandbox_mode",
    "kiln.permission_sync",
    ...(defaultRoute?.status === "project" ? ["model"] : []),
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
  if (defaultRoute?.status === "project" && defaultRoute.nativeModel) {
    document.model = defaultRoute.nativeModel;
  } else if ((defaultRoute?.status === "remove-stale" || defaultRoute?.status === "missing-default") && input.ownsManagedDefault) {
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
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "enforced",
        networkBoundary: "enforced",
        strength: "strong",
      },
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
