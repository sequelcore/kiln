import { describeTrustedExecutionEnforcement } from "@kilnai/core";
import type { ResolvedKilnConfig } from "../../kiln-yaml-types.js";
import type { KilnPermissionPolicy } from "../../wrapper/session.js";
import { translatePermission } from "../../wrapper/session-registry.js";
import { stripManagedFields } from "../native-projection-state.js";
import { resolveNativeDefaultRouteProjection } from "../native-route-integrity.js";
import {
  createPermissionProjection,
  PERMISSION_PROJECTION_TARGET_IDS,
  type PermissionProjection,
} from "./permission-projection.js";

export function translateCodexPermissionProjection(input: {
  readonly policy: KilnPermissionPolicy;
  readonly existingDocument: Record<string, unknown>;
  readonly kilnYaml?: ResolvedKilnConfig;
  readonly ownsManagedDefault?: boolean;
  readonly suppressManagedDefault?: boolean;
  readonly previousManagedFields?: readonly string[];
}): PermissionProjection {
  const translated = translatePermission(input.policy, "codex");
  const cfg = translated.config as { approvalMode: string; sandboxMode: string };
  const staleManagedFields = (input.previousManagedFields ?? []).filter(
    (field) =>
      field === "kiln.permission_sync" ||
      field === "model_provider" ||
      field === "model_catalog_json" ||
      field === "web_search" ||
      field === "model_providers.kiln",
  );
  const existingDocument = stripManagedFields({
    currentDocument: sanitizeCodexConfigDocument(input.existingDocument),
    managedFields: staleManagedFields,
  });
  const defaultRoute = !input.suppressManagedDefault && input.kilnYaml
    ? resolveNativeDefaultRouteProjection("codex", input.kilnYaml)
    : undefined;
  const managedFields = [
    "approval_policy",
    "sandbox_mode",
    ...(defaultRoute?.status === "project" ? ["model"] : []),
  ];
  const document: Record<string, unknown> = {
    ...existingDocument,
    approval_policy: cfg.approvalMode,
    sandbox_mode: cfg.sandboxMode,
  };
  if (input.suppressManagedDefault && input.ownsManagedDefault) {
    delete document.model;
  } else if (defaultRoute?.status === "project" && defaultRoute.nativeModel) {
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
