import {
  MemoryArtifactResourceStore,
  type DefaultBuiltinToolRegistryOptions,
} from "@kilnai/core";
import { join } from "node:path";
import type { AuthorityDescriptor, InvocationAdmission } from "@kilnai/core";
import type { BoundedWorkCapabilityObservation } from "@kilnai/core/work-governance";
import type { KilnAppConfig } from "../config.js";
import {
  loadConfiguredWebToolSurfaceOptions,
  type LoadConfiguredWebToolSurfaceOptionsInput,
} from "./web-tools-config.js";
import { loadConfiguredInteractiveUseToolSurfaceOptions } from "./interactive-use-config.js";
import { ExternalEngagementResourceProvider } from "./external-engagement-resource-provider.js";
import { readGlobalConfig, type KilnGlobalConfig } from "./global-config.js";
import { resolveFormalVerificationConfiguration } from "./formal-verification-config.js";
import { createPermissionEvaluator } from "../wrapper/permission-evaluator.js";
import { digestKilnPermissionPolicy } from "./model-facing-permission-policy.js";
import type { KilnPermissionPolicy } from "../wrapper/session.js";
import { resolveProjectStateBinding } from "../application/project-state-root.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";

export const PROGRESSIVE_RUNTIME_READ_ONLY_TOOLS = [
  "read",
  "read_many",
  "grep",
  "glob",
  "tree",
  "stat",
  "git",
  "json_query",
  "code_intelligence",
  "web_search",
  "web_fetch",
  "web_extract",
  "kiln_config.read",
  "work_governance.assess",
  "work_profile.list",
  "work_item.list",
] as const;

const configuredInvocationAdmissions = new WeakMap<object, `sha256:${string}`>();

export const PROGRESSIVE_RUNTIME_EXECUTION_TOOLS = [
  ...PROGRESSIVE_RUNTIME_READ_ONLY_TOOLS,
  "bash",
  "write",
  "edit",
  "patch",
  "kiln_config.propose_change",
  "kiln_config.apply_change",
  "work_item.update",
  "work_item.complete",
  "work_item.execution.start",
  "work_item.execution.finish",
  "work_item.execution.fail",
  "goal.create",
  "goal.evidence.record",
  "goal.complete",
] as const;

export type ProgressiveRuntimeToolProfile = "read-only" | "execute";

export function observeFormalVerificationCapability(
  options: Pick<DefaultBuiltinToolRegistryOptions, "formalVerify">,
): BoundedWorkCapabilityObservation {
  return {
    metric: "formal_verification",
    status: options.formalVerify === undefined ? "unavailable" : "available",
  };
}

export interface LoadConfiguredBuiltinToolSurfaceOptionsInput extends LoadConfiguredWebToolSurfaceOptionsInput {
  readonly globalConfig?: KilnGlobalConfig | null;
  readonly runDafnyVersion?: (executable: string) => string;
  readonly platform?: NodeJS.Platform;
  readonly discoveredPaths?: readonly string[];
}

/**
 * Adapts the CLI-owned permission evaluator to Core's narrow invocation port.
 * The adapter has no approval channel: conditional decisions therefore block
 * at the Core bridge until a future caller supplies an explicit grant.
 */
export function createConfiguredInvocationAdmission(
  policy: KilnPermissionPolicy,
): InvocationAdmission {
  const evaluator = createPermissionEvaluator(policy);
  const admission: InvocationAdmission = {
    authorize({ toolName, toolInput, resolvedEffect }) {
      const decisions = [evaluator.evaluateTool(toolName)];
      const command = firstString(toolInput, ["command", "cmd"]);
      if (command !== undefined) {
        decisions.push(evaluator.evaluateCommand(command));
      }
      const filePath = firstString(toolInput, ["filePath", "path", "file"]);
      if (filePath !== undefined) {
        decisions.push(evaluator.evaluateFile(filePath));
      }
      const destination = resolvedEffect.dataEgress === "none"
        ? undefined
        : firstString(toolInput, ["destination", "dataDestination", "url", "endpoint", "uri"]);
      if (destination !== undefined) {
        decisions.push(evaluator.evaluateDestination(destination));
      }
      return combinePermissionDecisions(decisions);
    },
  };
  configuredInvocationAdmissions.set(admission, digestKilnPermissionPolicy(policy));
  return admission;
}

/** Rejects arbitrary callbacks that merely implement the invocation port shape. */
export function assertConfiguredInvocationAdmission(
  value: InvocationAdmission | undefined,
  policy: KilnPermissionPolicy,
): InvocationAdmission {
  if (!value || configuredInvocationAdmissions.get(value) !== digestKilnPermissionPolicy(policy)) {
    throw new Error("Configured invocation admission is missing, counterfeit, or bound to another permission policy.");
  }
  return value;
}

function firstString(input: Readonly<Record<string, unknown>>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function combinePermissionDecisions(
  decisions: readonly { action: string; source: string; match?: { reason?: string } }[],
): AuthorityDescriptor {
  const forbidden = decisions.filter((decision) => decision.action === "deny" || decision.action === "forbid");
  const approval = decisions.filter((decision) => decision.action === "ask" || decision.action === "require-approval");
  if (forbidden.length > 0) {
    return {
      level: 4,
      allowed: false,
      requiresApproval: false,
      reason: forbidden.map(formatPermissionDecision).join("; "),
    };
  }
  if (approval.length > 0) {
    return {
      level: 3,
      allowed: false,
      requiresApproval: true,
      reason: approval.map(formatPermissionDecision).join("; "),
    };
  }
  return {
    level: 1,
    allowed: true,
    requiresApproval: false,
    reason: decisions.map(formatPermissionDecision).join("; ") || "Configured policy allows invocation",
  };
}

function formatPermissionDecision(decision: { action: string; source: string; match?: { reason?: string } }): string {
  return decision.match?.reason ?? `permission ${decision.action} (${decision.source})`;
}

export async function loadConfiguredBuiltinToolSurfaceOptions(
  appConfig: KilnAppConfig,
  projectPath: string,
  options: LoadConfiguredBuiltinToolSurfaceOptionsInput = {},
): Promise<DefaultBuiltinToolRegistryOptions> {
  const artifactStore = new MemoryArtifactResourceStore();
  const globalConfig = options.globalConfig === undefined ? readGlobalConfig() : options.globalConfig;
  const formalVerification = resolveFormalVerificationConfiguration({
    globalConfig,
    ...(options.runDafnyVersion === undefined ? {} : { runVersion: options.runDafnyVersion }),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.discoveredPaths === undefined ? {} : { discoveredPaths: options.discoveredPaths }),
  });
  const [webOptions, interactiveOptions] = await Promise.all([
    loadConfiguredWebToolSurfaceOptions(appConfig, projectPath, {
      ...(options.memoryAuthority === undefined ? {} : { memoryAuthority: options.memoryAuthority }),
    }),
    loadConfiguredInteractiveUseToolSurfaceOptions(appConfig, projectPath, { artifactStore }),
  ]);
  const merged = mergeBuiltinToolSurfaceOptions(webOptions, interactiveOptions);
  const invocationPolicy = options.memoryAuthority?.permissionPolicy;
  const resourceProviders = [
    ...(merged.resourceProviders ?? []),
    new ExternalEngagementResourceProvider(
      join(
        resolveProjectStateBinding(resolveProjectRoot({ explicitPath: projectPath }).rootPath).evidencePath,
        "external-engagement",
      ),
    ),
  ];
  return {
    ...merged,
    ...(invocationPolicy
      ? { invocationAdmission: createConfiguredInvocationAdmission(invocationPolicy) }
      : {}),
    ...(formalVerification.options === undefined ? {} : { formalVerify: formalVerification.options }),
    artifactResources: merged.artifactResources ?? { store: artifactStore },
    resourceProviders,
  };
}

export function withProgressiveRuntimeToolProjection(
  options: DefaultBuiltinToolRegistryOptions,
  profile: ProgressiveRuntimeToolProfile,
  additionalAlwaysOnTools: readonly string[] = [],
): DefaultBuiltinToolRegistryOptions {
  const profileTools = profile === "read-only"
    ? PROGRESSIVE_RUNTIME_READ_ONLY_TOOLS
    : PROGRESSIVE_RUNTIME_EXECUTION_TOOLS;
  return {
    ...options,
    toolProjection: {
      mode: "deferred",
      alwaysOnTools: [
        ...(options.toolProjection?.alwaysOnTools ?? []),
        ...profileTools,
        ...additionalAlwaysOnTools,
      ],
    },
  };
}

export function mergeBuiltinToolSurfaceOptions(
  left: DefaultBuiltinToolRegistryOptions,
  right: DefaultBuiltinToolRegistryOptions,
): DefaultBuiltinToolRegistryOptions {
  const additionalTools = [
    ...(left.additionalTools ?? []),
    ...(right.additionalTools ?? []),
  ];
  const resourceProviders = [
    ...(left.resourceProviders ?? []),
    ...(right.resourceProviders ?? []),
  ];

  return {
    ...left,
    ...right,
    ...(additionalTools.length > 0 ? { additionalTools } : {}),
    ...(resourceProviders.length > 0 ? { resourceProviders } : {}),
  };
}
