import { Type, type ObjectOptions, type Static, type TObject, type TProperties, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describeRunningCliBuild } from "../build-identity.js";
import { KilnYamlError } from "../kiln-yaml-types.js";

export const PROJECT_CONFIG_SCHEMA_REVISION = 1;
export const PROJECT_CONFIG_SCHEMA_ID = "https://kiln.dev/schemas/project-config-v1.json";

export type ProjectConfigActivation = "hot" | "next-turn" | "next-session" | "reconcile" | "restart-required";
export type ProjectConfigSensitivity = "public" | "secret-reference";
export type ProjectConfigAuthorityImpact = "none" | "authority-bearing";

export interface ProjectConfigFieldDescriptor {
  readonly identity: string;
  readonly structuralOwner: string;
  readonly semanticOwner: string;
  readonly scope: "project";
  readonly sensitivity: ProjectConfigSensitivity;
  readonly authorityImpact: ProjectConfigAuthorityImpact;
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
    maxToolCalls: Type.ReadonlyOptional(Type.Number()),
    maxActiveDurationMs: Type.ReadonlyOptional(Type.Number()),
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
  "x-kiln-semantic-owner": "work-governance",
  "x-kiln-authority-impact": "authority-bearing",
  "x-kiln-activation": "next-turn",
});

const actionEffectEnvelope = strictObject({
  operation: Type.Readonly(Type.Union([Type.Literal("observe"), Type.Literal("mutate")])),
  boundaries: Type.Readonly(Type.Array(Type.Union([
    Type.Literal("process"),
    Type.Literal("workspace"),
    Type.Literal("machine"),
    Type.Literal("network"),
    Type.Literal("external-system"),
  ]))),
  reversibility: Type.Readonly(Type.Union([
    Type.Literal("reversible"),
    Type.Literal("compensatable"),
    Type.Literal("irreversible"),
    Type.Literal("unknown"),
  ])),
  dataEgress: Type.Readonly(Type.Union([
    Type.Literal("none"),
    Type.Literal("metadata"),
    Type.Literal("project-data"),
    Type.Literal("sensitive-data"),
    Type.Literal("unknown"),
  ])),
  identityUse: Type.Readonly(Type.Union([
    Type.Literal("none"),
    Type.Literal("authenticated"),
    Type.Literal("privileged"),
    Type.Literal("unknown"),
  ])),
  consequences: Type.Readonly(Type.Array(Type.Union([
    Type.Literal("local-state"),
    Type.Literal("external-state"),
    Type.Literal("financial"),
    Type.Literal("legal"),
    Type.Literal("security"),
    Type.Literal("unknown"),
  ]))),
  idempotency: Type.Readonly(Type.Union([
    Type.Literal("idempotent"),
    Type.Literal("conditionally-idempotent"),
    Type.Literal("non-idempotent"),
    Type.Literal("unknown"),
  ])),
});

const mcpValueReference = Type.Union([
  strictObject({ value: Type.Readonly(nonEmptyString) }),
  strictObject({ fromEnv: Type.Readonly(nonEmptyString) }),
  strictObject({ fromCredential: Type.Readonly(nonEmptyString) }),
]);

const mcpCapabilityAdmission = strictObject({
  allow: Type.ReadonlyOptional(stringArray),
  deny: Type.ReadonlyOptional(stringArray),
});

const mcpServer = strictObject({
  enabled: Type.ReadonlyOptional(Type.Boolean()),
  transport: Type.ReadonlyOptional(Type.Union([Type.Literal("stdio"), Type.Literal("streamable-http")])),
  command: Type.ReadonlyOptional(Type.String()),
  args: Type.ReadonlyOptional(stringArray),
  cwd: Type.ReadonlyOptional(Type.String()),
  env: Type.ReadonlyOptional(Type.Record(nonEmptyString, mcpValueReference)),
  url: Type.ReadonlyOptional(Type.String()),
  headers: Type.ReadonlyOptional(Type.Record(nonEmptyString, mcpValueReference)),
  startupTimeoutMs: Type.ReadonlyOptional(Type.Number()),
  requestTimeoutMs: Type.ReadonlyOptional(Type.Number()),
  maxCapabilities: Type.ReadonlyOptional(Type.Number()),
  reconnect: Type.ReadonlyOptional(strictObject({
    maxAttempts: Type.Readonly(Type.Number()),
    initialDelayMs: Type.ReadonlyOptional(Type.Number()),
    maxDelayMs: Type.ReadonlyOptional(Type.Number()),
  })),
  admission: Type.ReadonlyOptional(strictObject({
    state: Type.Readonly(Type.Union([Type.Literal("admitted"), Type.Literal("denied")])),
    tools: Type.ReadonlyOptional(mcpCapabilityAdmission),
    resources: Type.ReadonlyOptional(mcpCapabilityAdmission),
    prompts: Type.ReadonlyOptional(mcpCapabilityAdmission),
    effects: Type.ReadonlyOptional(Type.Record(nonEmptyString, actionEffectEnvelope)),
  })),
  trust: Type.ReadonlyOptional(Type.Union([
    Type.Literal("untrusted"),
    Type.Literal("local"),
    Type.Literal("verified"),
  ])),
});

const mcp = strictObject({
  servers: Type.Readonly(Type.Record(nonEmptyString, mcpServer)),
}, {
  description: "Project MCP server connection and capability admission intent.",
  "x-kiln-semantic-owner": "mcp-configuration",
  "x-kiln-sensitivity": "secret-reference",
  "x-kiln-authority-impact": "authority-bearing",
});

const toolRule = strictObject({
  tool: Type.Readonly(nonEmptyString),
  action: Type.Readonly(Type.Union([Type.Literal("allow"), Type.Literal("ask"), Type.Literal("deny")])),
  reason: Type.ReadonlyOptional(Type.String()),
});

const commandRule = strictObject({
  pattern: Type.Readonly(nonEmptyString),
  action: Type.Readonly(Type.Union([Type.Literal("allow"), Type.Literal("ask"), Type.Literal("deny")])),
  shell: Type.ReadonlyOptional(Type.Union([
    Type.Literal("bash"),
    Type.Literal("sh"),
    Type.Literal("zsh"),
    Type.Literal("any"),
  ])),
  reason: Type.ReadonlyOptional(Type.String()),
});

const fileGovernance = strictObject({
  excludeFromContext: Type.ReadonlyOptional(Type.Boolean()),
  denyGlobs: Type.ReadonlyOptional(stringArray),
  askGlobs: Type.ReadonlyOptional(stringArray),
  allowGlobs: Type.ReadonlyOptional(stringArray),
});

const memoryAuthorityRule = strictObject({
  operations: Type.Readonly(Type.Array(Type.Union([
    Type.Literal("save"),
    Type.Literal("read"),
    Type.Literal("revise"),
    Type.Literal("relate"),
    Type.Literal("delete"),
    Type.Literal("forget"),
    Type.Literal("compact"),
    Type.Literal("promote"),
  ]))),
  scopeKinds: Type.ReadonlyOptional(Type.Array(Type.Union([
    Type.Literal("user"),
    Type.Literal("agent"),
    Type.Literal("team"),
    Type.Literal("project"),
    Type.Literal("org"),
    Type.Literal("app"),
    Type.Literal("tenant"),
    Type.Literal("session"),
  ]))),
  scopeIds: Type.ReadonlyOptional(stringArray),
  layers: Type.ReadonlyOptional(Type.Array(Type.Union([
    Type.Literal("working"),
    Type.Literal("episodic"),
    Type.Literal("semantic"),
    Type.Literal("procedural"),
    Type.Literal("coordination"),
    Type.Literal("audit"),
  ]))),
  allowAuditWrite: Type.ReadonlyOptional(Type.Boolean()),
});

const memoryPermissions = strictObject({
  read: Type.ReadonlyOptional(Type.Array(memoryAuthorityRule)),
  write: Type.ReadonlyOptional(Type.Array(memoryAuthorityRule)),
});

const agentScope = strictObject({
  agent: Type.Readonly(nonEmptyString),
  inherit: Type.ReadonlyOptional(Type.Boolean()),
  tools: Type.ReadonlyOptional(Type.Array(toolRule)),
  commands: Type.ReadonlyOptional(Type.Array(commandRule)),
  fileGovernance: Type.ReadonlyOptional(fileGovernance),
  memory: Type.ReadonlyOptional(memoryPermissions),
  mcpTools: Type.ReadonlyOptional(stringArray),
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
  safeDefaults: Type.ReadonlyOptional(Type.Boolean()),
  auditLog: Type.ReadonlyOptional(Type.Boolean()),
  tools: Type.ReadonlyOptional(Type.Array(toolRule)),
  commands: Type.ReadonlyOptional(Type.Array(commandRule)),
  fileGovernance: Type.ReadonlyOptional(fileGovernance),
  memory: Type.ReadonlyOptional(memoryPermissions),
  dataFirewall: Type.ReadonlyOptional(Type.Array(strictObject({
    destination: Type.Readonly(nonEmptyString),
    action: Type.Readonly(Type.Union([Type.Literal("allow"), Type.Literal("redact"), Type.Literal("deny")])),
    classifications: Type.ReadonlyOptional(stringArray),
    reason: Type.ReadonlyOptional(Type.String()),
  }))),
  agentScopes: Type.ReadonlyOptional(Type.Array(agentScope)),
}, {
  description: "Project restrictions applied beneath global execution authority.",
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
  "x-kiln-semantic-owner": "communication-policy",
});

const httpProvider = strictObject({
  type: Type.Readonly(Type.Literal("http")),
  url: Type.Readonly(nonEmptyString),
  headers: Type.ReadonlyOptional(Type.Record(nonEmptyString, Type.String())),
});
const providerWithApiKey = <T extends "brave" | "tavily" | "exa" | "firecrawl">(type: T) => strictObject({
  type: Type.Readonly(Type.Literal(type)),
  apiKeyEnv: Type.Readonly(nonEmptyString),
  url: Type.ReadonlyOptional(Type.String()),
});
const searchProvider = Type.Union([
  strictObject({ type: Type.ReadonlyOptional(Type.Literal("none")) }),
  httpProvider,
  strictObject({
    type: Type.Readonly(Type.Literal("searxng")),
    url: Type.Readonly(nonEmptyString),
    headers: Type.ReadonlyOptional(Type.Record(nonEmptyString, Type.String())),
  }),
  providerWithApiKey("brave"),
  providerWithApiKey("tavily"),
  providerWithApiKey("exa"),
]);
const extractProvider = Type.Union([
  strictObject({ type: Type.ReadonlyOptional(Type.Literal("none")) }),
  httpProvider,
  providerWithApiKey("tavily"),
  providerWithApiKey("firecrawl"),
]);

const web = strictObject({
  enabled: Type.ReadonlyOptional(Type.Boolean()),
  netPolicy: Type.ReadonlyOptional(Type.Union([
    Type.Literal("none"),
    Type.Literal("documentation"),
    Type.Literal("package-managers"),
    Type.Literal("full"),
  ])),
  allowedDomains: Type.ReadonlyOptional(stringArray),
  searchProvider: Type.ReadonlyOptional(searchProvider),
  searchFallbackProviders: Type.ReadonlyOptional(Type.Array(searchProvider)),
  extractProvider: Type.ReadonlyOptional(extractProvider),
}, {
  description: "Project web capability configuration.",
  "x-kiln-semantic-owner": "web-tools-configuration",
  "x-kiln-sensitivity": "secret-reference",
  "x-kiln-authority-impact": "authority-bearing",
});

const interactiveUse = strictObject({
  enabled: Type.ReadonlyOptional(Type.Boolean()),
  allowedDomains: Type.ReadonlyOptional(stringArray),
  allowedApplications: Type.ReadonlyOptional(stringArray),
  applicationAliases: Type.ReadonlyOptional(Type.Record(nonEmptyString, stringArray)),
  allowExternalBrowser: Type.ReadonlyOptional(Type.Boolean()),
  allowComputer: Type.ReadonlyOptional(Type.Boolean()),
  browserProvider: Type.ReadonlyOptional(Type.Union([Type.Literal("none"), Type.Literal("playwright")])),
  computerProvider: Type.ReadonlyOptional(Type.Union([
    Type.Literal("none"),
    Type.Literal("windows"),
    Type.Literal("windows-uia"),
  ])),
  browserEnvironment: Type.ReadonlyOptional(Type.Union([
    Type.Literal("isolated-headless"),
    Type.Literal("isolated-headed"),
  ])),
  computerEnvironment: Type.ReadonlyOptional(Type.Literal("local-active-desktop")),
}, {
  description: "Project browser and computer-use intent.",
  "x-kiln-semantic-owner": "interactive-use",
  "x-kiln-authority-impact": "authority-bearing",
});

const externalCatalogDecision = strictObject({
  sourceId: Type.Readonly(nonEmptyString),
  packageDigest: Type.Readonly(nonEmptyString),
});
const externalHarnessPolicy = strictObject({
  expectedFingerprint: Type.Readonly(nonEmptyString),
  keepImplicit: Type.Readonly(Type.Array(externalCatalogDecision)),
});
const externalCatalog = strictObject({
  version: Type.Readonly(Type.Literal(1)),
  harnesses: Type.Readonly(strictObject({
    codex: Type.ReadonlyOptional(externalHarnessPolicy),
    claude: Type.ReadonlyOptional(externalHarnessPolicy),
    opencode: Type.ReadonlyOptional(externalHarnessPolicy),
  })),
}, {
  description: "Global external-skill exposure policy; project semantic admission forbids it.",
  "x-kiln-project-admission": "forbidden",
  "x-kiln-semantic-owner": "skill-catalog",
  "x-kiln-authority-impact": "authority-bearing",
});

const skillVisibility = strictObject({
  default: Type.ReadonlyOptional(Type.Union([
    Type.Literal("implicit"),
    Type.Literal("explicit-only"),
    Type.Literal("disabled"),
  ])),
  overrides: Type.ReadonlyOptional(Type.Record(nonEmptyString, Type.Union([
    Type.Literal("implicit"),
    Type.Literal("explicit-only"),
    Type.Literal("disabled"),
  ]))),
}, {
  description: "Global native skill visibility; project semantic admission forbids it.",
  "x-kiln-project-admission": "forbidden",
  "x-kiln-semantic-owner": "skill-visibility",
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
  visibility: Type.ReadonlyOptional(skillVisibility),
  externalCatalog: Type.ReadonlyOptional(externalCatalog),
}, {
  description: "Project builtin-skill and selection intent.",
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
    Type.Literal("knowledge"),
  ]))),
  summaryAggressiveness: Type.ReadonlyOptional(Type.Union([
    Type.Literal("low"),
    Type.Literal("medium"),
    Type.Literal("high"),
  ])),
  cachePolicy: Type.ReadonlyOptional(Type.Union([Type.Literal("off"), Type.Literal("prefer")])),
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
    candidateRecordHash: Type.ReadonlyOptional(Type.String()),
    evaluationEvidenceHash: Type.ReadonlyOptional(Type.String()),
  })),
}, {
  description: "Project context allocation and adaptation intent.",
  "x-kiln-semantic-owner": "context-governance",
});

const qualityGate = strictObject({
  name: Type.Readonly(Type.String({ minLength: 1, pattern: "\\S" })),
  command: Type.Readonly(Type.String({ minLength: 1, pattern: "\\S" })),
  required: Type.ReadonlyOptional(Type.Boolean()),
});

export const PROJECT_CONFIG_SCHEMA = strictObject({
  version: Type.Readonly(Type.Literal("1", { description: "Breaking project configuration generation." })),
  activeInstructionProfiles: Type.ReadonlyOptional(Type.Array(nonEmptyString)),
  workGovernance: Type.ReadonlyOptional(workGovernance),
  domain: Type.ReadonlyOptional(Type.String({ minLength: 1 })),
  channels: Type.ReadonlyOptional(stringArray),
  teamMode: Type.ReadonlyOptional(Type.String()),
  requireApproval: Type.ReadonlyOptional(Type.Boolean()),
  maxDepth: Type.ReadonlyOptional(Type.Number()),
  parallelWorkers: Type.ReadonlyOptional(Type.Number()),
  mcp: Type.ReadonlyOptional(mcp),
  permissions: Type.ReadonlyOptional(permissions),
  communication: Type.ReadonlyOptional(communication),
  web: Type.ReadonlyOptional(web),
  interactiveUse: Type.ReadonlyOptional(interactiveUse),
  skills: Type.ReadonlyOptional(skills),
  qualityGates: Type.ReadonlyOptional(Type.Array(qualityGate)),
  contextGovernance: Type.ReadonlyOptional(contextGovernance),
}, {
  $id: PROJECT_CONFIG_SCHEMA_ID,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Kiln project configuration",
  description: "Canonical schema for .kiln/kiln.yaml.",
  "x-kiln-schema-revision": PROJECT_CONFIG_SCHEMA_REVISION,
  "x-kiln-structural-owner": "project-configuration",
  "x-kiln-semantic-owner": "project-configuration",
  "x-kiln-scope": "project",
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
export type KilnYamlQualityGate = DeepReadonly<Static<typeof qualityGate>>;

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
    activation: "next-session",
    defaultPosture: "omitted",
  });
  walkChildren(PROJECT_CONFIG_SCHEMA, "", rootContext, descriptors);
  return [...descriptors.values()].sort((left, right) => left.identity.localeCompare(right.identity));
}

interface DescriptorContext {
  readonly structuralOwner: string;
  readonly semanticOwner: string;
  readonly scope: "project";
  readonly sensitivity: ProjectConfigSensitivity;
  readonly authorityImpact: ProjectConfigAuthorityImpact;
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
  return {
    structuralOwner: annotation(schema, "x-kiln-structural-owner") ?? inherited.structuralOwner,
    semanticOwner: annotation(schema, "x-kiln-semantic-owner") ?? inherited.semanticOwner,
    scope: "project",
    sensitivity: sensitivityAnnotation(schema) ?? inherited.sensitivity,
    authorityImpact: authorityAnnotation(schema) ?? inherited.authorityImpact,
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
