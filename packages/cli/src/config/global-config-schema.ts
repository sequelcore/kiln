import { Type, type ObjectOptions, type Static, type TObject, type TProperties, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type {
  CommunicationIntent,
  ModelGatewayConfig,
  VoiceConfig,
} from "@kilnai/core";
import { describeRunningCliBuild } from "../build-identity.js";
import { KilnYamlError } from "../kiln-yaml.js";
import type {
  KilnAuthorityProfileConfig,
  KilnDeliberationPolicyConfig,
  KilnHooksConfig,
  KilnManagedAgentsConfig,
  KilnModelTaskSuitabilityOverride,
  KilnTargetCatalogIntentConfig,
  KilnWorkGovernanceConfig,
  KilnExternalCatalogPolicy,
  KilnYamlInteractiveUseConfig,
  KilnYamlMcp,
  KilnYamlPermissions,
  KilnYamlWebExtractProvider,
  KilnYamlWebNetPolicy,
  KilnYamlWebSearchProvider,
} from "../kiln-yaml-types.js";

export const GLOBAL_CONFIG_SCHEMA_REVISION = 1;
export const GLOBAL_CONFIG_SCHEMA_ID = "https://kiln.dev/schemas/global-config-v1.json";
export const CANONICAL_GLOBAL_CONFIG_VERSION = "4" as const;

export type GlobalConfigActivation = "hot" | "next-turn" | "next-session" | "reconcile" | "restart-required";
export type GlobalConfigSensitivity = "public" | "secret-reference";
export type GlobalConfigAuthorityImpact = "none" | "authority-bearing";

export interface GlobalConfigFieldDescriptor {
  readonly identity: string;
  readonly structuralOwner: string;
  readonly semanticOwner: string;
  readonly scope: "global";
  readonly sensitivity: GlobalConfigSensitivity;
  readonly authorityImpact: GlobalConfigAuthorityImpact;
  readonly activation: GlobalConfigActivation;
  readonly defaultPosture: "omitted" | "required";
  readonly schemaRevision: number;
  readonly valueType: string;
}

function strictObject<T extends TProperties>(properties: T, options: ObjectOptions = {}): TObject<T> {
  return Type.Object(properties, { ...options, additionalProperties: false });
}

function governedExternal<T>(semanticOwner: string, options: ObjectOptions = {}): TSchema & { static: T } {
  return Type.Unsafe<T>({
    ...Type.Unknown(),
    ...options,
    "x-kiln-semantic-owner": semanticOwner,
    "x-kiln-authority-impact": "authority-bearing",
  });
}

const nonEmptyString = Type.String({ minLength: 1 });
const identity = strictObject({
  name: Type.ReadonlyOptional(nonEmptyString),
  timezone: Type.ReadonlyOptional(nonEmptyString),
}, {
  "x-kiln-semantic-owner": "operator-preferences",
  "x-kiln-activation": "hot",
});
const engineBilling = Type.Union([
  Type.Literal("subscription"),
  Type.Literal("plus-quota"),
  Type.Literal("free"),
  Type.Literal("api-key"),
  Type.Literal("local"),
]);
const engine = strictObject({
  enabled: Type.ReadonlyOptional(Type.Boolean()),
  billing: Type.ReadonlyOptional(engineBilling),
});
const targetRouting = strictObject({ defaultTargetId: Type.Readonly(nonEmptyString) });
const sessionTurnBudget = strictObject({
  tokenLimit: Type.Readonly(Type.Number({ exclusiveMinimum: 0 })),
  action: Type.Readonly(Type.Literal("stop")),
});
const permissionCeiling = strictObject({
  approval: Type.ReadonlyOptional(Type.Unsafe<NonNullable<KilnYamlPermissions["approval"]>>(Type.Unknown())),
  sandbox: Type.ReadonlyOptional(Type.Unsafe<NonNullable<KilnYamlPermissions["sandbox"]>>(Type.Unknown())),
});
const web = strictObject({
  enabled: Type.ReadonlyOptional(Type.Boolean()),
  netPolicy: Type.ReadonlyOptional(Type.Unsafe<KilnYamlWebNetPolicy>(Type.Union([
    Type.Literal("none"),
    Type.Literal("documentation"),
    Type.Literal("package-managers"),
    Type.Literal("full"),
  ]))),
  allowedDomains: Type.ReadonlyOptional(Type.Array(nonEmptyString)),
  searchProvider: Type.ReadonlyOptional(Type.Unsafe<KilnYamlWebSearchProvider>(Type.Unknown())),
  searchFallbackProviders: Type.ReadonlyOptional(Type.Array(Type.Unsafe<KilnYamlWebSearchProvider>(Type.Unknown()))),
  extractProvider: Type.ReadonlyOptional(Type.Unsafe<KilnYamlWebExtractProvider>(Type.Unknown())),
});
const dafny = strictObject({
  executable: Type.Readonly(nonEmptyString),
  expectedVersion: Type.Readonly(nonEmptyString),
});
const lemmaScript = strictObject({
  packageRoot: Type.Readonly(nonEmptyString),
  entrypoint: Type.Readonly(nonEmptyString),
  expectedVersion: Type.Readonly(nonEmptyString),
});
const formalScreening = strictObject({
  packagePath: Type.Readonly(nonEmptyString),
  lemmaScript: Type.Readonly(lemmaScript),
});
const formalVerification = strictObject({
  dafny: Type.Readonly(dafny),
  screening: Type.ReadonlyOptional(formalScreening),
});
const verification = strictObject({ formal: Type.Readonly(formalVerification) });
const uiTargetSelection = strictObject({
  targetId: Type.Readonly(nonEmptyString),
  accountOverrideId: Type.ReadonlyOptional(nonEmptyString),
});
const ui = strictObject({
  theme: Type.ReadonlyOptional(nonEmptyString),
  targetSelection: Type.ReadonlyOptional(uiTargetSelection),
}, {
  "x-kiln-semantic-owner": "operator-preferences",
  "x-kiln-activation": "hot",
});
const components = strictObject({ include: Type.ReadonlyOptional(Type.Array(nonEmptyString)) });
const skillVisibility = Type.Union([
  Type.Literal("implicit"),
  Type.Literal("explicit-only"),
  Type.Literal("disabled"),
]);
const builtinSkills = strictObject({
  enabled: Type.ReadonlyOptional(Type.Boolean()),
  include: Type.ReadonlyOptional(Type.Array(nonEmptyString)),
  exclude: Type.ReadonlyOptional(Type.Array(nonEmptyString)),
}, {
  "x-kiln-semantic-owner": "skill-catalog",
  "x-kiln-authority-impact": "authority-bearing",
  "x-kiln-activation": "reconcile",
});
const skillSelection = strictObject({
  mode: Type.ReadonlyOptional(Type.Union([Type.Literal("advisory"), Type.Literal("auto")])),
}, {
  "x-kiln-semantic-owner": "skill-catalog",
  "x-kiln-authority-impact": "authority-bearing",
  "x-kiln-activation": "next-session",
});
const skillVisibilityConfig = strictObject({
  default: Type.ReadonlyOptional(skillVisibility),
  overrides: Type.ReadonlyOptional(Type.Record(Type.String(), skillVisibility)),
}, {
  "x-kiln-semantic-owner": "skill-catalog",
  "x-kiln-authority-impact": "authority-bearing",
  "x-kiln-activation": "reconcile",
});
const skills = strictObject({
  builtin: Type.ReadonlyOptional(builtinSkills),
  selection: Type.ReadonlyOptional(skillSelection),
  visibility: Type.ReadonlyOptional(skillVisibilityConfig),
  externalCatalog: Type.ReadonlyOptional(governedExternal<KilnExternalCatalogPolicy>("skill-catalog", {
    "x-kiln-activation": "reconcile",
  })),
}, {
  "x-kiln-semantic-owner": "skill-catalog",
  "x-kiln-authority-impact": "authority-bearing",
  "x-kiln-activation": "reconcile",
});

export const GLOBAL_CONFIG_SCHEMA = strictObject({
  version: Type.Readonly(Type.Literal(CANONICAL_GLOBAL_CONFIG_VERSION)),
  identity: Type.ReadonlyOptional(identity),
  activeInstructionProfiles: Type.ReadonlyOptional(Type.Array(nonEmptyString, {
    "x-kiln-semantic-owner": "instruction-profiles",
    "x-kiln-activation": "reconcile",
  })),
  workGovernance: Type.ReadonlyOptional(governedExternal<KilnWorkGovernanceConfig>("work-governance", {
    "x-kiln-activation": "next-turn",
  })),
  engines: Type.ReadonlyOptional(Type.Record(Type.String(), engine)),
  targetCatalog: Type.ReadonlyOptional(governedExternal<KilnTargetCatalogIntentConfig>("execution-routing")),
  targetRouting: Type.ReadonlyOptional(targetRouting),
  authorityProfiles: Type.ReadonlyOptional(governedExternal<readonly KilnAuthorityProfileConfig[]>("authority-profiles")),
  sessionTurnBudget: Type.ReadonlyOptional(sessionTurnBudget),
  permissions: Type.ReadonlyOptional(governedExternal<KilnYamlPermissions>("configured-permissions")),
  permissionCeiling: Type.ReadonlyOptional(permissionCeiling),
  mcp: Type.ReadonlyOptional(governedExternal<KilnYamlMcp>("mcp-configuration", { "x-kiln-sensitivity": "secret-reference" })),
  hooks: Type.ReadonlyOptional(governedExternal<KilnHooksConfig>("hook-configuration")),
  managedAgents: Type.ReadonlyOptional(governedExternal<KilnManagedAgentsConfig>("managed-agent-configuration")),
  modelTaskSuitability: Type.ReadonlyOptional(governedExternal<readonly KilnModelTaskSuitabilityOverride[]>("model-task-suitability")),
  deliberationPolicy: Type.ReadonlyOptional(governedExternal<KilnDeliberationPolicyConfig>("deliberation-policy")),
  communication: Type.ReadonlyOptional(governedExternal<CommunicationIntent>("communication-policy")),
  web: Type.ReadonlyOptional(web),
  interactiveUse: Type.ReadonlyOptional(governedExternal<KilnYamlInteractiveUseConfig>("interactive-use", {
    "x-kiln-activation": "next-session",
  })),
  verification: Type.ReadonlyOptional(verification),
  ui: Type.ReadonlyOptional(ui),
  skills: Type.ReadonlyOptional(skills),
  components: Type.ReadonlyOptional(components),
  operatorVoice: Type.ReadonlyOptional(governedExternal<VoiceConfig>("voice", { "x-kiln-sensitivity": "secret-reference" })),
  modelGateway: Type.ReadonlyOptional(governedExternal<ModelGatewayConfig>("model-gateway", { "x-kiln-activation": "restart-required", "x-kiln-sensitivity": "secret-reference" })),
}, {
  $id: GLOBAL_CONFIG_SCHEMA_ID,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Kiln global configuration",
  description: "Canonical structural schema for ~/.kiln/config.yaml.",
  "x-kiln-schema-revision": GLOBAL_CONFIG_SCHEMA_REVISION,
  "x-kiln-structural-owner": "global-configuration",
  "x-kiln-semantic-owner": "global-configuration",
  "x-kiln-scope": "global",
  "x-kiln-sensitivity": "public",
  "x-kiln-authority-impact": "none",
  "x-kiln-activation": "next-session",
  "x-kiln-default-posture": "omitted",
});

type DeepReadonly<T> = T extends readonly unknown[]
  ? ReadonlyArray<DeepReadonly<T[number]>>
  : T extends Readonly<Record<PropertyKey, unknown>>
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type KilnGlobalConfig = DeepReadonly<Static<typeof GLOBAL_CONFIG_SCHEMA>>;
export type KilnGlobalIdentity = DeepReadonly<Static<typeof identity>>;
export type KilnEngineBilling = Static<typeof engineBilling>;
export type KilnGlobalEngineConfig = DeepReadonly<Static<typeof engine>>;
export type KilnTargetRoutingConfig = DeepReadonly<Static<typeof targetRouting>>;
export type KilnSessionTurnBudgetConfig = DeepReadonly<Static<typeof sessionTurnBudget>>;
export type KilnGlobalPermissionCeilingConfig = DeepReadonly<Static<typeof permissionCeiling>>;
export type KilnGlobalWebConfig = DeepReadonly<Static<typeof web>>;
export type KilnGlobalVerificationConfig = DeepReadonly<Static<typeof verification>>;
export type KilnGlobalUiConfig = DeepReadonly<Static<typeof ui>>;
export type KilnGlobalUiTargetSelectionConfig = DeepReadonly<Static<typeof uiTargetSelection>>;
export type KilnGlobalComponentsConfig = DeepReadonly<Static<typeof components>>;

export function parseGlobalConfigStructure(value: unknown, sourcePath: string): KilnGlobalConfig {
  if (Value.Check(GLOBAL_CONFIG_SCHEMA, value)) return value;
  const error = [...Value.Errors(GLOBAL_CONFIG_SCHEMA, value)][0];
  const path = error?.path || "/";
  const detail = error?.message === "Unexpected property" ? "unknown field" : (error?.message ?? "invalid value");
  const buildHint = error?.message === "Unexpected property"
    ? ` Validated by ${describeRunningCliBuild()}; if this field exists at HEAD, the running build predates it.`
    : "";
  throw new KilnYamlError(`Invalid global config at ${path}: ${detail}.${buildHint} Source: ${sourcePath}.`);
}

export const GLOBAL_CONFIG_FIELD_DESCRIPTORS: readonly GlobalConfigFieldDescriptor[] = deriveFieldDescriptors();

export function serializeGlobalConfigEditorSchema(): string {
  return canonicalJson(GLOBAL_CONFIG_SCHEMA);
}

export function serializeGlobalConfigDescriptors(): string {
  return canonicalJson({
    descriptors: GLOBAL_CONFIG_FIELD_DESCRIPTORS,
    schemaId: GLOBAL_CONFIG_SCHEMA_ID,
    schemaRevision: GLOBAL_CONFIG_SCHEMA_REVISION,
  });
}

interface DescriptorContext {
  readonly structuralOwner: string;
  readonly semanticOwner: string;
  readonly sensitivity: GlobalConfigSensitivity;
  readonly authorityImpact: GlobalConfigAuthorityImpact;
  readonly activation: GlobalConfigActivation;
  readonly defaultPosture: "omitted" | "required";
}

function deriveFieldDescriptors(): readonly GlobalConfigFieldDescriptor[] {
  const descriptors = new Map<string, GlobalConfigFieldDescriptor>();
  walkChildren(GLOBAL_CONFIG_SCHEMA, "", {
    structuralOwner: "global-configuration",
    semanticOwner: "global-configuration",
    sensitivity: "public",
    authorityImpact: "none",
    activation: "next-session",
    defaultPosture: "omitted",
  }, descriptors);
  return [...descriptors.values()].sort((left, right) => left.identity.localeCompare(right.identity));
}

function walkSchema(schema: TSchema, identity: string, inherited: DescriptorContext, descriptors: Map<string, GlobalConfigFieldDescriptor>): void {
  const context = descriptorContext(schema, inherited);
  descriptors.set(identity, {
    identity,
    structuralOwner: context.structuralOwner,
    semanticOwner: context.semanticOwner,
    scope: "global",
    sensitivity: context.sensitivity,
    authorityImpact: context.authorityImpact,
    activation: context.activation,
    defaultPosture: context.defaultPosture,
    schemaRevision: GLOBAL_CONFIG_SCHEMA_REVISION,
    valueType: schemaValueType(schema),
  });
  walkChildren(schema, identity, context, descriptors);
}

function walkChildren(schema: TSchema, identity: string, context: DescriptorContext, descriptors: Map<string, GlobalConfigFieldDescriptor>): void {
  if (isRecord(schema.properties)) {
    const required = new Set(Array.isArray(schema.required) ? schema.required.filter(isString) : []);
    for (const [name, child] of Object.entries(schema.properties)) {
      if (!isSchema(child)) continue;
      walkSchema(child, `${identity}/${escapeJsonPointer(name)}`, required.has(name)
        ? { ...context, defaultPosture: "required" }
        : context, descriptors);
    }
  }
  if (isSchema(schema.items)) walkSchema(schema.items, `${identity}/*`, context, descriptors);
  if (isRecord(schema.patternProperties)) {
    for (const child of Object.values(schema.patternProperties)) {
      if (isSchema(child)) walkSchema(child, `${identity}/*`, context, descriptors);
    }
  }
}

function descriptorContext(schema: TSchema, inherited: DescriptorContext): DescriptorContext {
  return {
    structuralOwner: annotation(schema, "x-kiln-structural-owner") ?? inherited.structuralOwner,
    semanticOwner: annotation(schema, "x-kiln-semantic-owner") ?? inherited.semanticOwner,
    sensitivity: sensitivityAnnotation(schema) ?? inherited.sensitivity,
    authorityImpact: authorityAnnotation(schema) ?? inherited.authorityImpact,
    activation: activationAnnotation(schema) ?? inherited.activation,
    defaultPosture: defaultPostureAnnotation(schema) ?? inherited.defaultPosture,
  };
}

function annotation(schema: TSchema, key: string): string | undefined {
  return typeof schema[key] === "string" ? schema[key] : undefined;
}

function sensitivityAnnotation(schema: TSchema): GlobalConfigSensitivity | undefined {
  const value = annotation(schema, "x-kiln-sensitivity");
  return value === "public" || value === "secret-reference" ? value : undefined;
}

function authorityAnnotation(schema: TSchema): GlobalConfigAuthorityImpact | undefined {
  const value = annotation(schema, "x-kiln-authority-impact");
  return value === "none" || value === "authority-bearing" ? value : undefined;
}

function activationAnnotation(schema: TSchema): GlobalConfigActivation | undefined {
  const value = annotation(schema, "x-kiln-activation");
  return value === "hot" || value === "next-turn" || value === "next-session"
    || value === "reconcile" || value === "restart-required" ? value : undefined;
}

function defaultPostureAnnotation(schema: TSchema): "omitted" | "required" | undefined {
  const value = annotation(schema, "x-kiln-default-posture");
  return value === "omitted" || value === "required" ? value : undefined;
}

function schemaValueType(schema: TSchema): string {
  if (Object.prototype.hasOwnProperty.call(schema, "const")) return "literal";
  if (Array.isArray(schema.anyOf)) return "union";
  return typeof schema.type === "string" ? schema.type : "semantic";
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, member]) => [key, sortJson(member)]));
}

function isSchema(value: unknown): value is TSchema {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
