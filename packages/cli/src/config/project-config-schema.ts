import { Type, type ObjectOptions, type Static, type TObject, type TProperties, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describeRunningCliBuild } from "../build-identity.js";
import { KilnYamlError } from "../kiln-yaml-types.js";

export const PROJECT_CONFIG_SCHEMA_REVISION = 1;
export const PROJECT_CONFIG_SCHEMA_ID = "https://kiln.dev/schemas/project-config-v1.json";
export const PROJECT_CONFIG_COMPARATORS = [
  "global-instruction-profile-subset",
  "global-work-governance-narrowing",
  "global-limit-bound",
  "global-mcp-admission-narrowing",
  "global-permission-narrowing",
  "global-web-capability-narrowing",
  "global-skill-selection-narrowing",
] as const satisfies readonly ProjectConfigComparator[];

export type ProjectConfigActivation = "hot" | "next-turn" | "next-session" | "reconcile" | "restart-required";
export type ProjectConfigSensitivity = "public" | "secret-reference";
export type ProjectConfigAuthorityImpact = "none" | "authority-bearing";
export type ProjectConfigAdmission = "project-owned" | "attenuation-only" | "forbidden";
/** Named semantic comparator required for every project attenuation field. */
export type ProjectConfigComparator = string;

export interface ProjectConfigFieldDescriptor {
  readonly identity: string;
  readonly structuralOwner: string;
  readonly semanticOwner: string;
  readonly scope: "project";
  readonly sensitivity: ProjectConfigSensitivity;
  readonly authorityImpact: ProjectConfigAuthorityImpact;
  readonly projectAdmission: ProjectConfigAdmission;
  readonly comparator?: ProjectConfigComparator;
  readonly activation: ProjectConfigActivation;
  readonly defaultPosture: "omitted" | "required";
  readonly schemaRevision: number;
  readonly description?: string;
  readonly valueType: string;
}

function strictObject<T extends TProperties>(properties: T, options: ObjectOptions = {}): TObject<T> {
  return Type.Object(properties, { ...options, additionalProperties: false });
}

const stringArray = Type.Array(Type.String());
const nonEmptyString = Type.String({ minLength: 1 });

const workGovernanceTrigger = Type.Union([
  Type.Literal("architecture"),
  Type.Literal("security"),
  Type.Literal("ui"),
  Type.Literal("runtime"),
  Type.Literal("provider-routing"),
  Type.Literal("managed-agents"),
  Type.Literal("config"),
  Type.Literal("cross-surface"),
  Type.Literal("long-running"),
  Type.Literal("verification-heavy"),
  Type.Literal("formal-proof-candidate"),
]);

const workGovernanceEvidence = Type.Union([
  Type.Literal("surface-map"),
  Type.Literal("risk-hypothesis"),
  Type.Literal("spec"),
  Type.Literal("plan"),
  Type.Literal("tests"),
  Type.Literal("typecheck"),
  Type.Literal("visual-reference-research"),
  Type.Literal("browser-qa"),
  Type.Literal("managed-agent-review"),
  Type.Literal("managed-orchestration:result-handoff"),
  Type.Literal("managed-orchestration:completion-signal"),
  Type.Literal("managed-orchestration:comparison-summary"),
  Type.Literal("managed-orchestration:route-outcome"),
  Type.Literal("managed-orchestration:adoption-gate"),
  Type.Literal("managed-orchestration:diff"),
  Type.Literal("managed-orchestration:verification"),
  Type.Literal("managed-orchestration:review"),
  Type.Literal("managed-orchestration:merge:compare-and-select"),
  Type.Literal("managed-orchestration:merge:collect-all"),
  Type.Literal("managed-orchestration:merge:first-success"),
  Type.Literal("managed-orchestration:merge:manual-review-required"),
  Type.Literal("managed-orchestration:merge:none"),
  Type.Literal("formal-proof"),
  Type.Literal("residual-risk"),
]);

const boundedWorkCeiling = strictObject({
  allowedEffects: Type.ReadonlyOptional(Type.Array(Type.Union([
    Type.Literal("inspect"),
    Type.Literal("modify_source"),
    Type.Literal("modify_tests"),
    Type.Literal("modify_documentation"),
    Type.Literal("modify_configuration"),
    Type.Literal("run_verification"),
    Type.Literal("invoke_managed_agent"),
    Type.Literal("external_write"),
  ]))),
  allowedRoots: Type.ReadonlyOptional(stringArray),
  deniedRoots: Type.ReadonlyOptional(stringArray),
  maximumLimits: Type.ReadonlyOptional(strictObject({
    maxExecutionAttempts: Type.ReadonlyOptional(Type.Number()),
    maxManagedInvocations: Type.ReadonlyOptional(Type.Number()),
    maxConcurrentManagedInvocations: Type.ReadonlyOptional(Type.Number()),
    maxChildDepth: Type.ReadonlyOptional(Type.Number()),
    maxReviewRounds: Type.ReadonlyOptional(Type.Number()),
    maxRemediationRounds: Type.ReadonlyOptional(Type.Number()),
  })),
  minimumHarnessCapability: Type.ReadonlyOptional(Type.Union([
    Type.Literal("authoritative"),
    Type.Literal("partially_enforced"),
    Type.Literal("advisory_only"),
  ])),
}, {
  description: "Global bounded-work ceiling; project semantic admission forbids it.",
  "x-kiln-project-admission": "forbidden",
  "x-kiln-semantic-owner": "bounded-work",
  "x-kiln-authority-impact": "authority-bearing",
});

const workGovernance = strictObject({
  defaultPosture: Type.ReadonlyOptional(Type.Union([Type.Literal("orchestrate"), Type.Literal("direct")])),
  requireDelegationFor: Type.ReadonlyOptional(Type.Array(workGovernanceTrigger)),
  requiredEvidence: Type.ReadonlyOptional(Type.Array(workGovernanceEvidence)),
  boundedWorkCeiling: Type.ReadonlyOptional(boundedWorkCeiling),
}, {
  description: "Project work-governance intent and evidence requirements.",
  "x-kiln-project-admission": "attenuation-only",
  "x-kiln-project-comparator": "global-work-governance-narrowing",
  "x-kiln-semantic-owner": "work-governance",
  "x-kiln-authority-impact": "authority-bearing",
  "x-kiln-activation": "next-turn",
});

const mcpCapabilityAdmission = strictObject({
  allow: Type.ReadonlyOptional(stringArray),
  deny: Type.ReadonlyOptional(stringArray),
});

const mcpServer = strictObject({
  // A project can disable an already globally-defined server, but cannot
  // define or enable a connection. Connection identity, transport, command,
  // URL, credentials, and lifecycle belong to global authority.
  enabled: Type.ReadonlyOptional(Type.Boolean()),
  maxCapabilities: Type.ReadonlyOptional(Type.Number({ minimum: 0 })),
  admission: Type.ReadonlyOptional(strictObject({
    state: Type.Readonly(Type.Union([Type.Literal("admitted"), Type.Literal("denied")])),
    tools: Type.ReadonlyOptional(mcpCapabilityAdmission),
    resources: Type.ReadonlyOptional(mcpCapabilityAdmission),
    prompts: Type.ReadonlyOptional(mcpCapabilityAdmission),
  })),
}, {
  "x-kiln-project-admission": "attenuation-only",
  "x-kiln-project-comparator": "global-mcp-admission-narrowing",
});

const mcp = strictObject({
  servers: Type.Readonly(Type.Record(nonEmptyString, mcpServer)),
}, {
  description: "Project MCP server connection and capability admission intent.",
  "x-kiln-project-admission": "attenuation-only",
  "x-kiln-project-comparator": "global-mcp-admission-narrowing",
  "x-kiln-semantic-owner": "mcp-configuration",
  "x-kiln-sensitivity": "secret-reference",
  "x-kiln-authority-impact": "authority-bearing",
});

const permissions = strictObject({
  approval: Type.ReadonlyOptional(Type.Union([
    Type.Literal("never"),
    Type.Literal("on-request"),
    Type.Literal("on-failure"),
    Type.Literal("untrusted"),
  ])),
  sandbox: Type.ReadonlyOptional(Type.Union([
    Type.Literal("read-only"),
    Type.Literal("workspace-write"),
    Type.Literal("danger-full-access"),
  ])),
  // Other execution-policy fields are deliberately global-only until a
  // comparator can prove that their project form is a true subset.
}, {
  description: "Project restrictions applied beneath global execution authority.",
  "x-kiln-project-admission": "attenuation-only",
  "x-kiln-project-comparator": "global-permission-narrowing",
  "x-kiln-semantic-owner": "model-facing-execution-authority",
  "x-kiln-authority-impact": "authority-bearing",
});

const contractReference = strictObject({
  id: Type.Readonly(Type.String({ pattern: "^[a-z0-9][a-z0-9._:-]{0,127}$" })),
  revision: Type.Readonly(Type.String({ pattern: "^[a-z0-9][a-z0-9._:-]{0,127}$" })),
});

const communication = strictObject({
  responseDetail: Type.ReadonlyOptional(Type.Union([
    Type.Literal("provider-default"),
    Type.Literal("concise"),
    Type.Literal("standard"),
    Type.Literal("detailed"),
  ])),
  interactionProfile: Type.ReadonlyOptional(strictObject({
    id: Type.Readonly(Type.String({ pattern: "^[a-z0-9][a-z0-9._:-]{0,127}$" })),
    revision: Type.Readonly(Type.String({ pattern: "^[a-z0-9][a-z0-9._:-]{0,127}$" })),
    behaviors: Type.Readonly(Type.Array(Type.Union([
      Type.Literal("audience-calibrated"),
      Type.Literal("findings-first"),
      Type.Literal("next-action-explicit"),
      Type.Literal("outcome-first"),
      Type.Literal("plain-language"),
      Type.Literal("state-visible"),
    ]), { minItems: 1, uniqueItems: true })),
  })),
  locale: Type.ReadonlyOptional(Type.String({ pattern: "^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$" })),
  requiredContent: Type.ReadonlyOptional(Type.Array(Type.Union([
    Type.Literal("approval-requirement"),
    Type.Literal("citation"),
    Type.Literal("decision"),
    Type.Literal("failure"),
    Type.Literal("finding"),
    Type.Literal("next-action"),
    Type.Literal("residual-risk"),
    Type.Literal("verification"),
    Type.Literal("warning"),
  ]))),
  artifactContract: Type.ReadonlyOptional(contractReference),
  responseSkills: Type.ReadonlyOptional(Type.Array(contractReference)),
  onUnsupported: Type.ReadonlyOptional(Type.Union([Type.Literal("deny"), Type.Literal("omit")])),
}, {
  description: "Provider-neutral operator communication intent.",
  "x-kiln-project-admission": "project-owned",
  "x-kiln-semantic-owner": "communication-policy",
});

const web = strictObject({
  enabled: Type.ReadonlyOptional(Type.Boolean()),
  netPolicy: Type.ReadonlyOptional(Type.Union([
    Type.Literal("none"),
    Type.Literal("documentation"),
    Type.Literal("package-managers"),
    Type.Literal("full"),
  ])),
  allowedDomains: Type.ReadonlyOptional(stringArray),
}, {
  description: "Project web capability configuration.",
  "x-kiln-project-admission": "attenuation-only",
  "x-kiln-project-comparator": "global-web-capability-narrowing",
  "x-kiln-semantic-owner": "web-tools-configuration",
  "x-kiln-sensitivity": "secret-reference",
  "x-kiln-authority-impact": "authority-bearing",
});

const skills = strictObject({
  builtin: Type.ReadonlyOptional(strictObject({
    enabled: Type.ReadonlyOptional(Type.Boolean()),
    include: Type.ReadonlyOptional(stringArray),
    exclude: Type.ReadonlyOptional(stringArray),
  })),
  selection: Type.ReadonlyOptional(strictObject({
    mode: Type.ReadonlyOptional(Type.Union([Type.Literal("advisory"), Type.Literal("auto")])),
  })),
}, {
  description: "Project builtin-skill and selection intent.",
  "x-kiln-project-admission": "attenuation-only",
  "x-kiln-project-comparator": "global-skill-selection-narrowing",
  "x-kiln-semantic-owner": "skills-configuration",
  "x-kiln-authority-impact": "authority-bearing",
});

const contextGovernance = strictObject({
  turnBudget: Type.ReadonlyOptional(Type.Number()),
  allocationMode: Type.ReadonlyOptional(Type.Union([
    Type.Literal("whole-block"),
    Type.Literal("segmented"),
    Type.Literal("retrieval-on-demand"),
  ])),
  previewBeforeApply: Type.ReadonlyOptional(Type.Boolean()),
  preferredSources: Type.ReadonlyOptional(Type.Array(Type.Union([
    Type.Literal("ledger"),
    Type.Literal("artifact"),
    Type.Literal("summary"),
    Type.Literal("memory"),
  ]))),
  summaryAggressiveness: Type.ReadonlyOptional(Type.Union([
    Type.Literal("low"),
    Type.Literal("medium"),
    Type.Literal("high"),
  ])),
  cachePolicy: Type.ReadonlyOptional(Type.Union([Type.Literal("off"), Type.Literal("prefer")])),
  // The selected policy is project intent. Candidate/evaluation evidence is
  // runtime-owned mutable state and deliberately has no project schema path.
  adaptation: Type.ReadonlyOptional(strictObject({
    version: Type.Readonly(Type.Literal("policy-adaptation-selection-v1")),
    revision: Type.Readonly(Type.Number()),
    activePolicyId: Type.Readonly(nonEmptyString),
    activeConfigurationHash: Type.Readonly(nonEmptyString),
    frozen: Type.Readonly(Type.Boolean()),
    freezeReason: Type.ReadonlyOptional(Type.String()),
    rollback: Type.ReadonlyOptional(strictObject({
      policyId: Type.Readonly(nonEmptyString),
      configurationHash: Type.Readonly(nonEmptyString),
      allocationMode: Type.Readonly(Type.Union([
        Type.Literal("whole-block"),
        Type.Literal("segmented"),
        Type.Literal("retrieval-on-demand"),
      ])),
    })),
  })),
}, {
  description: "Project context allocation and adaptation intent.",
  "x-kiln-project-admission": "project-owned",
  "x-kiln-semantic-owner": "context-governance",
});

export const PROJECT_CONFIG_SCHEMA = strictObject({
  version: Type.Readonly(Type.Literal("1", { description: "Breaking project configuration generation." })),
  activeInstructionProfiles: Type.ReadonlyOptional(Type.Array(nonEmptyString, {
    "x-kiln-project-admission": "attenuation-only",
    "x-kiln-project-comparator": "global-instruction-profile-subset",
  })),
  workGovernance: Type.ReadonlyOptional(workGovernance),
  domain: Type.ReadonlyOptional(Type.String({ minLength: 1 })),
  channels: Type.ReadonlyOptional(stringArray),
  maxDepth: Type.ReadonlyOptional(Type.Number({
    minimum: 0,
    "x-kiln-project-admission": "attenuation-only",
    "x-kiln-project-comparator": "global-limit-bound",
    "x-kiln-authority-impact": "authority-bearing",
  })),
  parallelWorkers: Type.ReadonlyOptional(Type.Number({
    minimum: 0,
    "x-kiln-project-admission": "attenuation-only",
    "x-kiln-project-comparator": "global-limit-bound",
    "x-kiln-authority-impact": "authority-bearing",
  })),
  mcp: Type.ReadonlyOptional(mcp),
  permissions: Type.ReadonlyOptional(permissions),
  communication: Type.ReadonlyOptional(communication),
  web: Type.ReadonlyOptional(web),
  skills: Type.ReadonlyOptional(skills),
  contextGovernance: Type.ReadonlyOptional(contextGovernance),
}, {
  $id: PROJECT_CONFIG_SCHEMA_ID,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Kiln project configuration",
  description: "Canonical schema for private project config.yaml.",
  "x-kiln-schema-revision": PROJECT_CONFIG_SCHEMA_REVISION,
  "x-kiln-structural-owner": "project-configuration",
  "x-kiln-semantic-owner": "project-configuration",
  "x-kiln-scope": "project",
  "x-kiln-project-admission": "project-owned",
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

export type KilnProjectConfig = DeepReadonly<Static<typeof PROJECT_CONFIG_SCHEMA>>;
export type KilnYamlQualityGate = never;

export function parseProjectConfigStructure(value: unknown, sourcePath: string): KilnProjectConfig {
  if (Value.Check(PROJECT_CONFIG_SCHEMA, value)) {
    return value;
  }
  const error = [...Value.Errors(PROJECT_CONFIG_SCHEMA, value)][0];
  const path = error?.path || "/";
  const isUnknownField = error?.message === "Unexpected property";
  const rootUnknownField = isUnknownField ? rootFieldFromPointer(path) : undefined;
  const detail = isUnknownField ? "unknown field" : (error?.message ?? "invalid value");
  const buildHint = isUnknownField
    ? ` Validated by ${describeRunningCliBuild()}; if this field exists at HEAD, the running build predates it.`
    : "";
  if (rootUnknownField !== undefined) {
    throw new KilnYamlError(
      `${rootUnknownField} is global-only or is not a supported project configuration field.`
      + ` Invalid project config at ${path}.${buildHint} Source: ${sourcePath}.`,
    );
  }
  throw new KilnYamlError(`Invalid project config at ${path}: ${detail}.${buildHint} Source: ${sourcePath}.`);
}

export const PROJECT_CONFIG_FIELD_DESCRIPTORS: readonly ProjectConfigFieldDescriptor[] = deriveFieldDescriptors();

export function serializeProjectConfigEditorSchema(): string {
  return canonicalJson(PROJECT_CONFIG_SCHEMA);
}

export function serializeProjectConfigDescriptors(): string {
  return canonicalJson({
    descriptors: PROJECT_CONFIG_FIELD_DESCRIPTORS,
    schemaId: PROJECT_CONFIG_SCHEMA_ID,
    schemaRevision: PROJECT_CONFIG_SCHEMA_REVISION,
  });
}

function deriveFieldDescriptors(): readonly ProjectConfigFieldDescriptor[] {
  const descriptors = new Map<string, ProjectConfigFieldDescriptor>();
  const rootContext = descriptorContext(PROJECT_CONFIG_SCHEMA, {
    structuralOwner: "project-configuration",
    semanticOwner: "project-configuration",
    scope: "project",
    sensitivity: "public",
    authorityImpact: "none",
    projectAdmission: "project-owned",
    activation: "next-session",
    defaultPosture: "omitted",
  });
  walkChildren(PROJECT_CONFIG_SCHEMA, "", rootContext, descriptors);
  const result = [...descriptors.values()].sort((left, right) => left.identity.localeCompare(right.identity));
  assertProjectConfigDescriptorInvariants(result);
  return result;
}

/** Fails closed if the schema and its generated admission ledger drift apart. */
export function assertProjectConfigDescriptorInvariants(
  descriptors: readonly ProjectConfigFieldDescriptor[] = PROJECT_CONFIG_FIELD_DESCRIPTORS,
): void {
  const comparators = new Set<string>(PROJECT_CONFIG_COMPARATORS);
  for (const descriptor of descriptors) {
    if (descriptor.projectAdmission === undefined) {
      throw new Error(`Project config descriptor ${descriptor.identity} has no admission posture.`);
    }
    if (descriptor.authorityImpact === "authority-bearing" && descriptor.projectAdmission === "project-owned") {
      throw new Error(`Authority-bearing project config descriptor ${descriptor.identity} cannot be project-owned.`);
    }
    if (descriptor.projectAdmission === "attenuation-only") {
      if (descriptor.comparator === undefined || descriptor.comparator.trim().length === 0) {
        throw new Error(`Project attenuation descriptor ${descriptor.identity} has no comparator.`);
      }
      if (!comparators.has(descriptor.comparator)) {
        throw new Error(`Project attenuation comparator '${descriptor.comparator}' is not registered.`);
      }
    } else if (descriptor.comparator !== undefined) {
      throw new Error(`Project descriptor ${descriptor.identity} names a comparator without attenuation admission.`);
    }
  }
}

interface DescriptorContext {
  readonly structuralOwner: string;
  readonly semanticOwner: string;
  readonly scope: "project";
  readonly sensitivity: ProjectConfigSensitivity;
  readonly authorityImpact: ProjectConfigAuthorityImpact;
  readonly projectAdmission: ProjectConfigAdmission;
  readonly comparator?: ProjectConfigComparator;
  readonly activation: ProjectConfigActivation;
  readonly defaultPosture: "omitted" | "required";
}

function walkSchema(
  schema: TSchema,
  identity: string,
  inherited: DescriptorContext,
  descriptors: Map<string, ProjectConfigFieldDescriptor>,
): void {
  const context = descriptorContext(schema, inherited);
  const description = typeof schema.description === "string" ? schema.description : undefined;
  descriptors.set(identity, {
    identity,
    structuralOwner: context.structuralOwner,
    semanticOwner: context.semanticOwner,
    scope: context.scope,
    sensitivity: context.sensitivity,
    authorityImpact: context.authorityImpact,
    projectAdmission: context.projectAdmission,
    ...(context.comparator === undefined ? {} : { comparator: context.comparator }),
    activation: context.activation,
    defaultPosture: context.defaultPosture,
    schemaRevision: PROJECT_CONFIG_SCHEMA_REVISION,
    ...(description === undefined ? {} : { description }),
    valueType: schemaValueType(schema),
  });
  walkChildren(schema, identity, context, descriptors);
}

function walkChildren(
  schema: TSchema,
  identity: string,
  context: DescriptorContext,
  descriptors: Map<string, ProjectConfigFieldDescriptor>,
): void {
  if (isSchemaRecord(schema.properties)) {
    const required = new Set(Array.isArray(schema.required) ? schema.required.filter(isString) : []);
    for (const [name, child] of Object.entries(schema.properties)) {
      if (!isSchema(child)) continue;
      const childContext = required.has(name) ? { ...context, defaultPosture: "required" as const } : context;
      walkSchema(child, `${identity}/${escapeJsonPointer(name)}`, childContext, descriptors);
    }
  }
  if (isSchema(schema.items)) {
    walkSchema(schema.items, `${identity}/*`, context, descriptors);
  }
  if (isSchemaRecord(schema.patternProperties)) {
    for (const child of Object.values(schema.patternProperties)) {
      if (isSchema(child)) walkSchema(child, `${identity}/*`, context, descriptors);
    }
  }
  if (Array.isArray(schema.anyOf)) {
    for (const child of schema.anyOf) {
      if (isSchema(child)) walkChildren(child, identity, descriptorContext(child, context), descriptors);
    }
  }
}

function descriptorContext(schema: TSchema, inherited: DescriptorContext): DescriptorContext {
  const admission = projectAdmissionAnnotation(schema);
  const comparator = comparatorAnnotation(schema);
  return {
    structuralOwner: annotation(schema, "x-kiln-structural-owner") ?? inherited.structuralOwner,
    semanticOwner: annotation(schema, "x-kiln-semantic-owner") ?? inherited.semanticOwner,
    scope: "project",
    sensitivity: sensitivityAnnotation(schema) ?? inherited.sensitivity,
    authorityImpact: authorityAnnotation(schema) ?? inherited.authorityImpact,
    projectAdmission: admission ?? inherited.projectAdmission,
    comparator: comparator ?? (admission === undefined || admission === "attenuation-only" ? inherited.comparator : undefined),
    activation: activationAnnotation(schema) ?? inherited.activation,
    defaultPosture: defaultPostureAnnotation(schema) ?? inherited.defaultPosture,
  };
}

function annotation(schema: TSchema, key: string): string | undefined {
  const value = schema[key];
  return typeof value === "string" ? value : undefined;
}

function sensitivityAnnotation(schema: TSchema): ProjectConfigSensitivity | undefined {
  const value = annotation(schema, "x-kiln-sensitivity");
  return value === "public" || value === "secret-reference" ? value : undefined;
}

function authorityAnnotation(schema: TSchema): ProjectConfigAuthorityImpact | undefined {
  const value = annotation(schema, "x-kiln-authority-impact");
  return value === "none" || value === "authority-bearing" ? value : undefined;
}

function projectAdmissionAnnotation(schema: TSchema): ProjectConfigAdmission | undefined {
  const value = annotation(schema, "x-kiln-project-admission");
  return value === "project-owned" || value === "attenuation-only" || value === "forbidden" ? value : undefined;
}

function comparatorAnnotation(schema: TSchema): ProjectConfigComparator | undefined {
  const value = annotation(schema, "x-kiln-project-comparator");
  return value === undefined ? undefined : value;
}

function activationAnnotation(schema: TSchema): ProjectConfigActivation | undefined {
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
  return typeof schema.type === "string" ? schema.type : "unknown";
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, member]) => [key, sortJson(member)]),
  );
}

function isSchema(value: unknown): value is TSchema {
  return isRecord(value);
}

function isSchemaRecord(value: unknown): value is Readonly<Record<string, unknown>> {
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

function rootFieldFromPointer(path: string): string | undefined {
  const match = /^\/([^/]+)$/u.exec(path);
  return match?.[1]?.replaceAll("~1", "/").replaceAll("~0", "~");
}
