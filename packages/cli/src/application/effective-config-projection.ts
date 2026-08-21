import {
  KILN_EFFECTIVE_CONFIG_SCHEMA_REVISION,
  type KilnConfigSourceSnapshot,
  type KilnEffectiveConfigActivation,
  type KilnEffectiveConfigFieldSnapshot,
  type KilnEffectiveConfigHealth,
  type KilnEffectiveConfigOverrideStep,
  type KilnEffectiveConfigSensitivity,
  type KilnEffectiveConfigSnapshot,
  type KilnProjectionTargetSnapshot,
  type TrustedExecutionIntegrity,
} from "@kilnai/gateway-contracts";
import type { KilnGlobalConfig } from "../config/global-config.js";
import {
  PROJECT_CONFIG_FIELD_DESCRIPTORS,
  type KilnProjectConfig,
} from "../config/project-config-schema.js";
import type { ResolvedKilnConfig } from "../kiln-yaml-types.js";

type EffectiveRoot = keyof ResolvedKilnConfig & string;
type CompositionMode = "default" | "global" | "project" | "compose";

interface EffectiveFieldMetadata {
  readonly mode: CompositionMode;
  readonly sensitivity?: KilnEffectiveConfigSensitivity;
  readonly activation?: KilnEffectiveConfigActivation;
}

const EFFECTIVE_FIELD_METADATA = {
  version: { mode: "default" },
  activeInstructionProfiles: { mode: "compose" },
  workGovernance: { mode: "compose", activation: "next-turn" },
  domain: { mode: "project" },
  channels: { mode: "project" },
  teamMode: { mode: "project" },
  requireApproval: { mode: "project" },
  maxDepth: { mode: "project" },
  parallelWorkers: { mode: "project" },
  mcp: { mode: "compose", sensitivity: "secret-reference" },
  permissions: { mode: "compose" },
  communication: { mode: "compose" },
  web: { mode: "compose", sensitivity: "secret-reference" },
  interactiveUse: { mode: "compose" },
  skills: { mode: "compose" },
  qualityGates: { mode: "project" },
  contextGovernance: { mode: "project" },
  provider: { mode: "global" },
  model: { mode: "global" },
  providers: { mode: "global" },
  managedAgents: { mode: "global" },
  modelTaskSuitability: { mode: "global" },
  deliberationPolicy: { mode: "global" },
  skillGeneration: { mode: "global" },
  hooks: { mode: "global", sensitivity: "secret-reference" },
  targetCatalog: { mode: "global" },
  authorityProfiles: { mode: "global" },
} as const satisfies Readonly<Record<EffectiveRoot, EffectiveFieldMetadata>>;

const PROJECT_ROOT_DESCRIPTORS = new Map(
  PROJECT_CONFIG_FIELD_DESCRIPTORS
    .filter((descriptor) => /^\/[^/]+$/u.test(descriptor.identity))
    .map((descriptor) => [descriptor.identity, descriptor]),
);

export interface ProjectEffectiveConfigInput {
  readonly effectiveConfig: ResolvedKilnConfig;
  readonly globalConfig: KilnGlobalConfig | null;
  readonly projectConfig: KilnProjectConfig | null;
  readonly globalSource: KilnConfigSourceSnapshot;
  readonly projectSource: KilnConfigSourceSnapshot;
  readonly projections: readonly KilnProjectionTargetSnapshot[];
  readonly permissionIntegrity: readonly TrustedExecutionIntegrity[];
}

/**
 * The single operator-facing projection of resolved configuration. It is
 * derived per read, carries no authority of its own, and never returns values
 * from configuration families that may contain inline secrets.
 */
export function projectEffectiveConfig(input: ProjectEffectiveConfigInput): KilnEffectiveConfigSnapshot {
  const health = effectiveProjectionHealth(input.projections, input.permissionIntegrity);
  const fields = Object.entries(input.effectiveConfig)
    .filter((entry): entry is [EffectiveRoot, ResolvedKilnConfig[EffectiveRoot]] => entry[1] !== undefined)
    .map(([name, value]) => projectField(name, value, input, health))
    .sort((left, right) => left.identity.localeCompare(right.identity));
  return {
    schemaRevision: KILN_EFFECTIVE_CONFIG_SCHEMA_REVISION,
    health,
    fields,
  };
}

export function effectiveConfigField(
  snapshot: KilnEffectiveConfigSnapshot | undefined,
  identity: string,
): KilnEffectiveConfigFieldSnapshot | undefined {
  return snapshot?.fields.find((field) => field.identity === identity);
}

export function publicEffectiveConfigValue(
  snapshot: KilnEffectiveConfigSnapshot | undefined,
  identity: string,
): unknown {
  const field = effectiveConfigField(snapshot, identity);
  return field?.sensitivity === "public" ? field.value : undefined;
}

function projectField(
  name: EffectiveRoot,
  value: ResolvedKilnConfig[EffectiveRoot],
  input: ProjectEffectiveConfigInput,
  health: KilnEffectiveConfigHealth,
): KilnEffectiveConfigFieldSnapshot {
  const identity = `/${escapeJsonPointer(name)}`;
  const metadata: EffectiveFieldMetadata = EFFECTIVE_FIELD_METADATA[name];
  const descriptor = PROJECT_ROOT_DESCRIPTORS.get(identity);
  const globalContributes = globalFieldContributes(name, input.globalConfig);
  const projectContributes = hasOwn(input.projectConfig, name);
  const overrideChain = overrideChainFor(
    metadata.mode,
    globalContributes,
    projectContributes,
    input.globalSource.path,
    input.projectSource.path,
  );
  const source = sourceFor(metadata.mode, globalContributes, projectContributes);
  const sensitivity = metadata.sensitivity ?? descriptor?.sensitivity ?? "public";
  const common = {
    identity,
    scope: "effective" as const,
    source,
    sourcePath: sourcePathFor(source, identity, input.globalSource.path, input.projectSource.path),
    defaultStatus: source === "default" ? "default" as const : "explicit" as const,
    overrideChain,
    health,
    schemaRevision: KILN_EFFECTIVE_CONFIG_SCHEMA_REVISION,
    activation: metadata.activation ?? descriptor?.activation ?? "next-session",
    sensitivity,
  };
  return sensitivity === "secret-reference"
    ? { ...common, redacted: { present: true } }
    : { ...common, value: structuredClone(value) };
}

function globalFieldContributes(name: EffectiveRoot, globalConfig: KilnGlobalConfig | null): boolean {
  if (!globalConfig) return false;
  if (name === "provider" || name === "model") {
    return globalConfig.targetRouting !== undefined && globalConfig.targetCatalog !== undefined;
  }
  if (name === "version") return false;
  return hasOwn(globalConfig, name);
}

function sourceFor(
  mode: CompositionMode,
  globalContributes: boolean,
  projectContributes: boolean,
): "default" | "global" | "project" | "composed" {
  if (mode === "default") return projectContributes ? "project" : "default";
  if (mode === "global") return globalContributes ? "global" : "default";
  if (mode === "project") return projectContributes ? "project" : globalContributes ? "global" : "default";
  if (globalContributes && projectContributes && mode === "compose") return "composed";
  if (projectContributes) return "project";
  if (globalContributes) return "global";
  return "default";
}

function overrideChainFor(
  mode: CompositionMode,
  globalContributes: boolean,
  projectContributes: boolean,
  globalPath: string,
  projectPath: string,
): readonly KilnEffectiveConfigOverrideStep[] {
  if (!globalContributes && !projectContributes) {
    return [{ scope: "default", sourcePath: "kiln://defaults", disposition: "default" }];
  }
  if (globalContributes && projectContributes) {
    return mode === "compose"
      ? [
        { scope: "global", sourcePath: globalPath, disposition: "contributed" },
        { scope: "project", sourcePath: projectPath, disposition: "contributed" },
      ]
      : [
        { scope: "global", sourcePath: globalPath, disposition: "overridden" },
        { scope: "project", sourcePath: projectPath, disposition: "selected" },
      ];
  }
  return globalContributes
    ? [{ scope: "global", sourcePath: globalPath, disposition: "selected" }]
    : [{ scope: "project", sourcePath: projectPath, disposition: "selected" }];
}

function sourcePathFor(
  source: "default" | "global" | "project" | "composed",
  identity: string,
  globalPath: string,
  projectPath: string,
): string {
  if (source === "global") return globalPath;
  if (source === "project") return projectPath;
  return source === "composed" ? `kiln://effective${identity}` : "kiln://defaults";
}

function effectiveProjectionHealth(
  projections: readonly KilnProjectionTargetSnapshot[],
  permissionIntegrity: readonly TrustedExecutionIntegrity[],
): KilnEffectiveConfigHealth {
  if (
    projections.some((projection) => projection.status === "drifted")
    || permissionIntegrity.some((integrity) => integrity.classification === "native-projection-drift")
  ) return "drifted";
  if (
    projections.some((projection) => projection.status === "stale")
    || permissionIntegrity.some((integrity) => integrity.classification === "stale-evidence")
  ) return "stale";
  if (permissionIntegrity.some((integrity) =>
    integrity.classification === "effective-policy-unproven"
    || integrity.classification === "partial-observation"
    || integrity.classification === "observation-failed"
  )) return "unknown";
  return "current";
}

function hasOwn(value: object | null, key: PropertyKey): boolean {
  return value !== null && Object.prototype.hasOwnProperty.call(value, key);
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
