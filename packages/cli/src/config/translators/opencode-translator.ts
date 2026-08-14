import { describeTrustedExecutionEnforcement, OPENCODE_NO_FILESYSTEM_SANDBOX, type TrustedExecutionAuthorizationRecord } from "@kilnai/core";
import type { KilnYaml } from "../../kiln-yaml-types.js";
import type { KilnPermissionPolicy } from "../../wrapper/session.js";
import { type OpenCodeNativeRules, translatePermission } from "../../wrapper/session-registry.js";
import type { OpenCodeResponsesProjection } from "../model-gateway-native-projection.js";
import { mergeManagedFields, stripManagedFields } from "../native-projection-state.js";
import { resolveNativeDefaultRouteProjection } from "../native-route-integrity.js";
import {
  createPermissionProjection,
  PERMISSION_PROJECTION_TARGET_IDS,
  type PermissionProjection,
} from "./permission-projection.js";

type OpenCodePermissionRule = string | Record<string, string>;

/**
 * OpenCode keys permission rules by tool action, resolves them with `findLast`,
 * and normalizes a bare action to the `"*"` key.  Two consequences shape this
 * projection: the broad rule must be written first so specific rules override
 * it, and there is no `default` key -- writing one produces a rule for a tool
 * named "default" that matches nothing.
 */
function buildOpenCodePermissionDocument(
  defaultAction: string,
  rules: OpenCodeNativeRules,
): Record<string, OpenCodePermissionRule> {
  const permission: Record<string, OpenCodePermissionRule> = { "*": defaultAction };

  const scope = (action: string, resource: string, effect: string): void => {
    const existing = permission[action];
    permission[action] =
      typeof existing === "object"
        ? { ...existing, [resource]: effect }
        : { ...(typeof existing === "string" ? { "*": existing } : {}), [resource]: effect };
  };

  for (const rule of rules.tools) {
    const existing = permission[rule.tool];
    // A tool already scoped by resource keeps its patterns; the bare action
    // becomes that tool's own wildcard rather than discarding them.
    if (typeof existing === "object") {
      permission[rule.tool] = { "*": rule.action, ...existing };
      continue;
    }
    permission[rule.tool] = rule.action;
  }
  for (const rule of rules.commands) {
    scope("bash", rule.pattern, rule.action);
  }
  for (const [effect, globs] of [
    ["deny", rules.fileGovernance.denyGlobs],
    ["ask", rules.fileGovernance.askGlobs],
    ["allow", rules.fileGovernance.allowGlobs],
  ] as const) {
    for (const glob of globs) {
      // A file-governance glob governs reaching the file at all, so it binds
      // both the read and the edit action.
      scope("read", glob, effect);
      scope("edit", glob, effect);
    }
  }

  return permission;
}

export function translateOpenCodePermissionProjection(input: {
  readonly policy: KilnPermissionPolicy;
  readonly existingDocument: Record<string, unknown>;
  readonly kilnYaml?: KilnYaml;
  readonly ownsManagedDefault?: boolean;
  readonly gatewayProjection?: OpenCodeResponsesProjection;
  readonly previousManagedFields?: readonly string[];
  readonly storedAuthorization?: TrustedExecutionAuthorizationRecord;
}): PermissionProjection {
  const translated = translatePermission(input.policy, "opencode");
  const cfg = translated.config as { permissionDefault: string };
  const { kiln: _legacyKilnMetadata, ...rawExistingDocument } = input.existingDocument;
  const staleGatewayFields = (input.previousManagedFields ?? []).filter((field) => field === "provider.kiln");
  const existingSkillPermission = typeof rawExistingDocument.permission === "object"
    && rawExistingDocument.permission !== null && !Array.isArray(rawExistingDocument.permission)
    ? (rawExistingDocument.permission as Record<string, unknown>).skill
    : undefined;
  const existingDocument = stripManagedFields({
    currentDocument: rawExistingDocument,
    managedFields: staleGatewayFields,
  });
  const defaultRoute =
    !input.gatewayProjection && input.kilnYaml
      ? resolveNativeDefaultRouteProjection("opencode", input.kilnYaml)
      : undefined;
  const permission = buildOpenCodePermissionDocument(cfg.permissionDefault, translated.nativeRules as OpenCodeNativeRules);
  delete permission.skill;
  if (existingSkillPermission !== undefined) permission.skill = existingSkillPermission as OpenCodePermissionRule;
  const managedFields = [
    ...Object.keys(permission).filter((key) => key !== "skill").map((key) => `permission.${key}`),
    ...(defaultRoute?.status === "project" ? ["model"] : []),
    ...(input.gatewayProjection?.managedFields ?? []),
  ];
  const document: Record<string, unknown> = {
    ...existingDocument,
    permission,
  };
  if (input.gatewayProjection) {
    if (!input.gatewayProjection.managedFields.includes("model") && input.ownsManagedDefault) delete document.model;
    return createPermissionProjection({
      targetId: PERMISSION_PROJECTION_TARGET_IDS.opencode,
      managedFields: [...new Set(managedFields)],
      document: mergeManagedFields({
        currentDocument: document,
        managedPatch: input.gatewayProjection.patch,
        managedFields: input.gatewayProjection.managedFields,
      }),
      integrity: {
        harness: "opencode",
        policy: input.policy,
        translated,
        semanticLoss:
          cfg.permissionDefault === "allow"
            ? ["OpenCode allow resolves permission prompts but does not provide filesystem sandbox enforcement."]
            : ["OpenCode permission rules do not provide filesystem sandbox enforcement."],
        semanticLimitations: [OPENCODE_NO_FILESYSTEM_SANDBOX],
        enforcement: describeTrustedExecutionEnforcement({
          harness: "opencode",
          permissionDefault: cfg.permissionDefault,
        }),
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
    targetId: PERMISSION_PROJECTION_TARGET_IDS.opencode,
    managedFields,
    document,
    integrity: {
      harness: "opencode",
      policy: input.policy,
      translated,
      semanticLoss:
        cfg.permissionDefault === "allow"
          ? ["OpenCode allow resolves permission prompts but does not provide filesystem sandbox enforcement."]
          : ["OpenCode permission rules do not provide filesystem sandbox enforcement."],
      semanticLimitations: [OPENCODE_NO_FILESYSTEM_SANDBOX],
      enforcement: describeTrustedExecutionEnforcement({
        harness: "opencode",
        permissionDefault: cfg.permissionDefault,
      }),
      storedAuthorization: input.storedAuthorization,
    },
  });
}
