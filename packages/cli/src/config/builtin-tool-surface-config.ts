import { join } from "node:path";
import type { AuthorityDescriptor, InvocationAdmission } from "@kilnai/core";
import {
  type DefaultBuiltinToolRegistryOptions,
  MemoryArtifactResourceStore,
  type ToolCatalogConfigurationDiagnostic,
  type ToolCatalogConfiguredProducerDiagnostic,
} from "@kilnai/core";
import type { BoundedWorkCapabilityObservation } from "@kilnai/core/work-governance";
import {
  discoverVerificationCapabilities,
  type CapabilityCatalogContribution,
  type VerificationCapabilityToolSchema,
} from "@kilnai/core/capabilities";
import {
  createFormalVerifyTool,
  createGentleReviewTool,
  createQualityAnalyzeTool,
  createStaticAnalyzeTool,
} from "@kilnai/runtime";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import { resolveProjectStateBinding } from "../application/project-state-root.js";
import type { KilnAppConfig } from "../config.js";
import { createPermissionEvaluator } from "../wrapper/permission-evaluator.js";
import type { KilnPermissionPolicy } from "../wrapper/session.js";
import { ExternalEngagementResourceProvider } from "./external-engagement-resource-provider.js";
import { type KilnGlobalConfig, readGlobalConfig } from "./global-config.js";
import { loadConfiguredInteractiveUseToolSurfaceOptions } from "./interactive-use-config.js";
import { digestKilnPermissionPolicy } from "./model-facing-permission-policy.js";
import { resolveFormalVerificationConfiguration } from "./verification/dafny.js";
import { resolveGentleAiConfiguration } from "./verification/gentle-ai.js";
import {
  type ResolveStaticAnalysisConfigurationInput,
  resolveStaticAnalysisConfiguration,
} from "./verification/oxlint.js";
import { resolveQualityAnalysisConfiguration } from "./verification/quality.js";
import { projectVerificationDiscoveryInput } from "./verification/discovery.js";
import {
  type LoadConfiguredWebToolSurfaceOptionsInput,
  loadConfiguredWebToolSurfaceOptions,
} from "./web-tools-config.js";

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
  options: Pick<DefaultBuiltinToolRegistryOptions, "verificationTools">,
): BoundedWorkCapabilityObservation {
  return {
    metric: "formal_verification",
    status:
      options.verificationTools?.some((tool) => tool.name === "formal_verify") === true ? "available" : "unavailable",
  };
}

export interface LoadConfiguredBuiltinToolSurfaceOptionsInput extends LoadConfiguredWebToolSurfaceOptionsInput {
  readonly globalConfig?: KilnGlobalConfig | null;
  readonly runDafnyVersion?: (executable: string) => string;
  readonly observeDafnyInstallationDigest?: Parameters<
    typeof resolveFormalVerificationConfiguration
  >[0]["observeInstallationDigest"];
  readonly runOxlintVersion?: (executable: string) => string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly resolveManagedOxlintBinary?: ResolveStaticAnalysisConfigurationInput["resolveManagedBinary"];
  readonly runGentleAiVersion?: (executable: string) => string;
  readonly now?: () => Date;
}

export interface ConfiguredBuiltinToolSurfaceOptions extends DefaultBuiltinToolRegistryOptions {
  readonly capabilityEvaluatedAt: string;
  readonly capabilityContributions: readonly CapabilityCatalogContribution[];
  readonly capabilityToolSchemas: readonly VerificationCapabilityToolSchema[];
}

/**
 * Adapts the CLI-owned permission evaluator to Core's narrow invocation port.
 * The adapter has no approval channel: conditional decisions therefore block
 * at the Core bridge until a future caller supplies an explicit grant.
 */
export function createConfiguredInvocationAdmission(policy: KilnPermissionPolicy): InvocationAdmission {
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
      const destination =
        resolvedEffect.dataEgress === "none"
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
  decisions: readonly {
    action: string;
    source: string;
    dataFirewallAction?: "allow" | "redact" | "deny";
    match?: { reason?: string };
  }[],
): AuthorityDescriptor {
  const forbidden = decisions.filter((decision) => decision.action === "deny" || decision.action === "forbid");
  const requiresRedaction = decisions.filter((decision) => decision.dataFirewallAction === "redact");
  const approval = decisions.filter((decision) => decision.action === "ask" || decision.action === "require-approval");
  if (forbidden.length > 0) {
    return {
      level: 4,
      allowed: false,
      requiresApproval: false,
      reason: forbidden.map(formatPermissionDecision).join("; "),
    };
  }
  if (requiresRedaction.length > 0) {
    return {
      level: 4,
      allowed: false,
      requiresApproval: false,
      reason:
        "Data firewall requires redaction; invocation is denied until a preventive redactor owns this destination.",
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
): Promise<ConfiguredBuiltinToolSurfaceOptions> {
  const artifactStore = new MemoryArtifactResourceStore();
  const globalConfig = options.globalConfig === undefined ? readGlobalConfig() : options.globalConfig;
  const formalVerification = resolveFormalVerificationConfiguration({
    globalConfig,
    ...(options.runDafnyVersion === undefined ? {} : { runVersion: options.runDafnyVersion }),
    ...(options.observeDafnyInstallationDigest === undefined
      ? {}
      : { observeInstallationDigest: options.observeDafnyInstallationDigest }),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
  });
  const staticAnalysis = resolveStaticAnalysisConfiguration({
    globalConfig,
    ...(options.runOxlintVersion === undefined ? {} : { runVersion: options.runOxlintVersion }),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.arch === undefined ? {} : { arch: options.arch }),
    ...(options.resolveManagedOxlintBinary === undefined
      ? {}
      : { resolveManagedBinary: options.resolveManagedOxlintBinary }),
  });
  const gentleReview = resolveGentleAiConfiguration({
    globalConfig,
    repositoryRoot: resolveProjectRoot({ explicitPath: projectPath }).rootPath,
    ...(options.runGentleAiVersion === undefined ? {} : { runVersion: options.runGentleAiVersion }),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
  });
  const qualityAnalysis = resolveQualityAnalysisConfiguration(globalConfig);
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const validUntil = new Date(Date.parse(observedAt) + 5 * 60_000).toISOString();
  const verificationDiscovery = discoverVerificationCapabilities(projectVerificationDiscoveryInput({
    observedAt,
    validUntil,
    formal: formalVerification,
    staticAnalysis,
    quality: qualityAnalysis,
    inferential: gentleReview,
  }));
  const configuredProducerDiagnostics = collectConfiguredProducerDiagnostics([
    { canonicalName: "formal_verify", diagnostic: formalVerification.diagnostic },
    { canonicalName: "static_analyze", diagnostic: staticAnalysis.diagnostic },
    { canonicalName: "quality_analyze", diagnostic: qualityAnalysis.diagnostic },
    { canonicalName: "gentle_review", diagnostic: gentleReview.diagnostic },
  ]);
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
    ...(invocationPolicy ? { invocationAdmission: createConfiguredInvocationAdmission(invocationPolicy) } : {}),
    verificationTools: [
      ...(formalVerification.options === undefined ? [] : [createFormalVerifyTool(formalVerification.options)]),
      ...(staticAnalysis.options === undefined ? [] : [createStaticAnalyzeTool(staticAnalysis.options)]),
      ...(qualityAnalysis.options === undefined ? [] : [createQualityAnalyzeTool(qualityAnalysis.options)]),
      ...(gentleReview.options === undefined ? [] : [createGentleReviewTool(gentleReview.options)]),
    ],
    capabilityEvaluatedAt: observedAt,
    capabilityContributions: [verificationDiscovery.contribution],
    capabilityToolSchemas: verificationDiscovery.toolSchemas,
    ...(configuredProducerDiagnostics.length > 0 ? { configuredProducerDiagnostics } : {}),
    artifactResources: merged.artifactResources ?? { store: artifactStore },
    resourceProviders,
  };
}

function collectConfiguredProducerDiagnostics(
  resolutions: readonly {
    readonly canonicalName: string;
    readonly diagnostic: ConfiguredProducerResolutionDiagnostic | undefined;
  }[],
): readonly ToolCatalogConfiguredProducerDiagnostic[] {
  return resolutions.flatMap(({ canonicalName, diagnostic }) => {
    if (!diagnostic || diagnostic.code === "not_configured") {
      return [];
    }
    const status =
      diagnostic.code === "executable_unavailable" || diagnostic.code === "managed_artifact_unavailable"
        ? "configured_unavailable"
        : "validation_failed";
    return [
      {
        canonicalName,
        status,
        configuration: projectConfiguredProducerDiagnostic(canonicalName, diagnostic),
      },
    ];
  });
}

type ConfiguredProducerResolutionDiagnostic = NonNullable<
  (
    | ReturnType<typeof resolveFormalVerificationConfiguration>
    | ReturnType<typeof resolveStaticAnalysisConfiguration>
    | ReturnType<typeof resolveQualityAnalysisConfiguration>
    | ReturnType<typeof resolveGentleAiConfiguration>
  )["diagnostic"]
>;

function projectConfiguredProducerDiagnostic(
  canonicalName: string,
  diagnostic: ConfiguredProducerResolutionDiagnostic,
): ToolCatalogConfigurationDiagnostic {
  const versionRelated =
    diagnostic.code === "version_probe_failed" ||
    diagnostic.code === "version_unparseable" ||
    diagnostic.code === "version_mismatch";
  const expectedVersion = versionRelated ? optionalDiagnosticVersion(diagnostic, "expectedVersion") : undefined;
  const observedVersion = versionRelated ? optionalDiagnosticVersion(diagnostic, "observedVersion") : undefined;
  return {
    code: diagnostic.code === "managed_artifact_unavailable" ? "executable_unavailable" : diagnostic.code,
    message: `Configured producer "${canonicalName}" reported ${diagnostic.code}.`,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    ...(observedVersion === undefined ? {} : { observedVersion }),
  };
}

function optionalDiagnosticVersion(
  diagnostic: ConfiguredProducerResolutionDiagnostic,
  field: "expectedVersion" | "observedVersion",
): string | undefined {
  if (field === "expectedVersion") {
    if (!("expectedVersion" in diagnostic)) return undefined;
    return typeof diagnostic.expectedVersion === "string" ? diagnostic.expectedVersion : undefined;
  }
  if (!("observedVersion" in diagnostic)) return undefined;
  return typeof diagnostic.observedVersion === "string" ? diagnostic.observedVersion : undefined;
}

export function withProgressiveRuntimeToolProjection(
  options: DefaultBuiltinToolRegistryOptions,
  profile: ProgressiveRuntimeToolProfile,
  additionalAlwaysOnTools: readonly string[] = [],
): DefaultBuiltinToolRegistryOptions {
  const profileTools =
    profile === "read-only" ? PROGRESSIVE_RUNTIME_READ_ONLY_TOOLS : PROGRESSIVE_RUNTIME_EXECUTION_TOOLS;
  return {
    ...options,
    toolProjection: {
      mode: "deferred",
      alwaysOnTools: [...(options.toolProjection?.alwaysOnTools ?? []), ...profileTools, ...additionalAlwaysOnTools],
    },
  };
}

export function mergeBuiltinToolSurfaceOptions(
  left: DefaultBuiltinToolRegistryOptions,
  right: DefaultBuiltinToolRegistryOptions,
): DefaultBuiltinToolRegistryOptions {
  const additionalTools = [...(left.additionalTools ?? []), ...(right.additionalTools ?? [])];
  const resourceProviders = [...(left.resourceProviders ?? []), ...(right.resourceProviders ?? [])];

  return {
    ...left,
    ...right,
    ...(additionalTools.length > 0 ? { additionalTools } : {}),
    ...(resourceProviders.length > 0 ? { resourceProviders } : {}),
  };
}
