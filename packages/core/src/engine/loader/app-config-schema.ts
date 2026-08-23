import { fileURLToPath } from "node:url";
import { Type, type ObjectOptions, type Static, type TObject, type TProperties, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import pkg from "../../../package.json" with { type: "json" };

export const APP_CONFIG_SCHEMA_REVISION = 1;
export const APP_CONFIG_SCHEMA_ID = "https://kiln.dev/schemas/app-config-v1.json";

export interface AppConfigFieldDescriptor {
  readonly identity: string;
  readonly structuralOwner: string;
  readonly semanticOwner: string;
  readonly scope: "app";
  readonly sensitivity: "public" | "secret-reference";
  readonly authorityImpact: "none" | "authority-bearing";
  readonly activation: "restart-required";
  readonly defaultPosture: "omitted" | "required";
  readonly schemaRevision: number;
  readonly valueType: string;
}

function strictObject<T extends TProperties>(properties: T, options: ObjectOptions = {}): TObject<T> {
  return Type.Object(properties, { ...options, additionalProperties: false });
}

const unknown = () => Type.Unknown();
const optionalUnknown = () => Type.ReadonlyOptional(unknown());

const actionEffectEnvelope = strictObject({
  operation: optionalUnknown(),
  boundaries: optionalUnknown(),
  reversibility: optionalUnknown(),
  dataEgress: optionalUnknown(),
  identityUse: optionalUnknown(),
  consequences: optionalUnknown(),
  idempotency: optionalUnknown(),
}, { "x-kiln-semantic-owner": "action-effect" });

const retry = strictObject({
  onValidationError: optionalUnknown(),
  onTransientError: optionalUnknown(),
  maxAttempts: optionalUnknown(),
  timeout: optionalUnknown(),
  fallback: optionalUnknown(),
});

const agent = strictObject({
  name: optionalUnknown(),
  tier: optionalUnknown(),
  tools: optionalUnknown(),
  role: optionalUnknown(),
  goal: optionalUnknown(),
  backstory: optionalUnknown(),
  instructions: optionalUnknown(),
  voiceProfile: optionalUnknown(),
}, { "x-kiln-semantic-owner": "agent" });

const capability = strictObject({
  name: optionalUnknown(),
  description: optionalUnknown(),
  schema: optionalUnknown(),
  tags: optionalUnknown(),
  type: optionalUnknown(),
  targetApp: optionalUnknown(),
  task: optionalUnknown(),
  timeout: optionalUnknown(),
  guardrail: optionalUnknown(),
  guardrailRetries: optionalUnknown(),
  outputSchema: optionalUnknown(),
  effectEnvelope: Type.ReadonlyOptional(actionEffectEnvelope),
  retry: Type.ReadonlyOptional(retry),
}, { "x-kiln-semantic-owner": "capability" });

const team = strictObject({
  agents: Type.ReadonlyOptional(Type.Record(Type.String(), agent)),
  capabilities: Type.ReadonlyOptional(Type.Array(capability)),
  mode: optionalUnknown(),
  manager: optionalUnknown(),
}, { "x-kiln-semantic-owner": "team" });

const router = strictObject({
  fallback: optionalUnknown(),
}, { "x-kiln-semantic-owner": "router" });

const trigger = strictObject({
  name: optionalUnknown(),
  type: optionalUnknown(),
  team: optionalUnknown(),
  task: optionalUnknown(),
  enabled: optionalUnknown(),
  path: optionalUnknown(),
  method: optionalUnknown(),
  secretEnv: optionalUnknown(),
  event: optionalUnknown(),
  filter: optionalUnknown(),
  cron: optionalUnknown(),
  timezone: optionalUnknown(),
}, { "x-kiln-semantic-owner": "trigger" });
Object.assign(trigger.properties.secretEnv, { "x-kiln-sensitivity": "secret-reference" });

const mcp = strictObject({ servers: optionalUnknown() }, { "x-kiln-semantic-owner": "app-mcp" });

const speechProviderFields = {
  provider: optionalUnknown(),
  model: optionalUnknown(),
  apiKeyEnv: optionalUnknown(),
  command: optionalUnknown(),
  commandEnv: optionalUnknown(),
  args: optionalUnknown(),
  modelPath: optionalUnknown(),
  modelPathEnv: optionalUnknown(),
  device: optionalUnknown(),
  timeoutMs: optionalUnknown(),
};
const stt = strictObject({ ...speechProviderFields, language: optionalUnknown() });
const tts = strictObject({ ...speechProviderFields, voice: optionalUnknown(), format: optionalUnknown() });
for (const schema of [stt, tts]) {
  for (const field of ["apiKeyEnv", "commandEnv", "modelPathEnv"] as const) {
    Object.assign(schema.properties[field], { "x-kiln-sensitivity": "secret-reference" });
  }
}
const ttsIntent = strictObject({
  delivery: optionalUnknown(),
  appliesWhen: optionalUnknown(),
  voice: optionalUnknown(),
  language: optionalUnknown(),
  speed: optionalUnknown(),
  format: optionalUnknown(),
});
const ttsProfile = strictObject({
  style: optionalUnknown(),
  voice: optionalUnknown(),
  language: optionalUnknown(),
  speed: optionalUnknown(),
  speedRange: optionalUnknown(),
  format: optionalUnknown(),
  intents: Type.ReadonlyOptional(Type.Record(Type.String(), ttsIntent)),
});
const voiceInput = strictObject({ modes: optionalUnknown(), failureMode: optionalUnknown() });
const voiceOutput = strictObject({ modes: optionalUnknown(), failureMode: optionalUnknown() });
const voiceSurface = strictObject({
  enabled: optionalUnknown(),
  input: Type.ReadonlyOptional(voiceInput),
  output: Type.ReadonlyOptional(voiceOutput),
});
const voicePolicy = strictObject({
  defaultInputFailureMode: optionalUnknown(),
  defaultOutputFailureMode: optionalUnknown(),
  artifacts: Type.ReadonlyOptional(strictObject({
    storeSourceAudio: optionalUnknown(),
    storeTranscripts: optionalUnknown(),
    storeSynthesizedAudio: optionalUnknown(),
    retentionMaxArtifacts: optionalUnknown(),
  })),
  surfaces: Type.ReadonlyOptional(Type.Record(Type.String(), voiceSurface)),
});
const voiceDefaults = strictObject({ ttsProfile: optionalUnknown() });
const voice = strictObject({
  stt: Type.ReadonlyOptional(stt),
  tts: Type.ReadonlyOptional(tts),
  defaults: Type.ReadonlyOptional(voiceDefaults),
  ttsProfiles: Type.ReadonlyOptional(Type.Record(Type.String(), ttsProfile)),
  policy: Type.ReadonlyOptional(voicePolicy),
}, { "x-kiln-semantic-owner": "voice" });

const pii = strictObject({ detect: optionalUnknown(), action: optionalUnknown(), allowlist: optionalUnknown() });
const contentCategory = strictObject({ threshold: optionalUnknown(), action: optionalUnknown() });
const content = strictObject({
  enabled: optionalUnknown(),
  categories: Type.ReadonlyOptional(Type.Record(Type.String(), contentCategory)),
});
const rail = strictObject({
  type: optionalUnknown(),
  block: optionalUnknown(),
  escalate: optionalUnknown(),
  competitors: optionalUnknown(),
  response: optionalUnknown(),
  triggers: optionalUnknown(),
  required: optionalUnknown(),
  forbid: optionalUnknown(),
});
const safety = strictObject({
  pii: Type.ReadonlyOptional(pii),
  content: Type.ReadonlyOptional(content),
  rails: Type.ReadonlyOptional(Type.Array(rail)),
}, { "x-kiln-semantic-owner": "safety" });

const provider = strictObject({
  name: optionalUnknown(),
  model: optionalUnknown(),
  apiKeyEnv: optionalUnknown(),
}, { "x-kiln-semantic-owner": "provider-adapter-runtime", "x-kiln-authority-impact": "authority-bearing" });
Object.assign(provider.properties.apiKeyEnv, { "x-kiln-sensitivity": "secret-reference" });
const billingTier = strictObject({ agents: optionalUnknown() });
const billing = strictObject({
  budgetEndpoint: optionalUnknown(),
  overBudgetMessage: optionalUnknown(),
  headers: Type.ReadonlyOptional(Type.Record(Type.String(), Type.String({ pattern: "^\\$[A-Z_][A-Z0-9_]*$" }))),
  tiers: Type.ReadonlyOptional(Type.Record(Type.String(), billingTier)),
}, { "x-kiln-semantic-owner": "provider-adapter-runtime", "x-kiln-authority-impact": "authority-bearing" });
Object.assign(billing.properties.headers, { "x-kiln-sensitivity": "secret-reference" });

export const APP_CONFIG_SCHEMA = strictObject({
  name: unknown(),
  router,
  teams: Type.Record(Type.String(), team),
  triggers: Type.ReadonlyOptional(Type.Array(trigger)),
  mcp: Type.ReadonlyOptional(mcp),
  voice: Type.ReadonlyOptional(voice),
  safety: Type.ReadonlyOptional(safety),
  runtime: optionalUnknown(),
  provider: Type.ReadonlyOptional(provider),
  billing: Type.ReadonlyOptional(billing),
}, {
  $id: APP_CONFIG_SCHEMA_ID,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Kiln app configuration",
  description: "Canonical structural schema for app.yaml.",
  "x-kiln-schema-revision": APP_CONFIG_SCHEMA_REVISION,
  "x-kiln-structural-owner": "app-configuration",
  "x-kiln-semantic-owner": "app-domain",
  "x-kiln-scope": "app",
  "x-kiln-sensitivity": "public",
  "x-kiln-authority-impact": "authority-bearing",
  "x-kiln-activation": "restart-required",
  "x-kiln-default-posture": "omitted",
});

export type AppConfigDocument = Static<typeof APP_CONFIG_SCHEMA>;
export type RawAgent = Static<typeof agent>;
export type RawCapability = Static<typeof capability>;
export type RawTeam = Static<typeof team>;
export type RawRouter = Static<typeof router>;
export type RawTrigger = Static<typeof trigger>;
export type RawMcp = Static<typeof mcp>;
export type RawVoice = Static<typeof voice>;
export type RawSttProvider = Static<typeof stt>;
export type RawTtsProvider = Static<typeof tts>;
export type RawVoiceDefaults = Static<typeof voiceDefaults>;
export type RawTtsProfile = Static<typeof ttsProfile>;
export type RawTtsIntent = Static<typeof ttsIntent>;
export type RawVoicePolicy = Static<typeof voicePolicy>;
export type RawVoiceArtifacts = NonNullable<RawVoicePolicy["artifacts"]>;
export type RawVoiceSurfacePolicy = Static<typeof voiceSurface>;
export type RawVoiceInputPolicy = Static<typeof voiceInput>;
export type RawVoiceOutputPolicy = Static<typeof voiceOutput>;
export type RawPiiConfig = Static<typeof pii>;
export type RawContentCategoryConfig = Static<typeof contentCategory>;
export type RawContentConfig = Static<typeof content>;
export type RawRailConfig = Static<typeof rail>;
export type RawSafetyConfig = Static<typeof safety>;

export type AppConfigStructuralAdmission =
  | { readonly ok: true; readonly value: AppConfigDocument }
  | { readonly ok: false; readonly errors: readonly AppConfigStructuralError[] };

export interface AppConfigStructuralError {
  readonly field: string;
  readonly message: string;
  readonly unknownField: boolean;
}

export function parseAppConfigStructure(value: unknown): AppConfigStructuralAdmission {
  if (Value.Check(APP_CONFIG_SCHEMA, value)) return { ok: true, value };
  return {
    ok: false,
    errors: [...Value.Errors(APP_CONFIG_SCHEMA, value)].map((error) => ({
      field: pointerToField(error.path),
      message: error.message === "Unexpected property" ? "is not supported" : error.message,
      unknownField: error.message === "Unexpected property",
    })),
  };
}

export function describeRunningAppConfigSchema(): string {
  let modulePath: string;
  try {
    modulePath = fileURLToPath(import.meta.url);
  } catch {
    modulePath = import.meta.url;
  }
  return `app-config-v${APP_CONFIG_SCHEMA_REVISION} in @kilnai/core ${pkg.version} at ${modulePath}`;
}

interface DescriptorContext {
  readonly structuralOwner: string;
  readonly semanticOwner: string;
  readonly sensitivity: "public" | "secret-reference";
  readonly authorityImpact: "none" | "authority-bearing";
  readonly defaultPosture: "omitted" | "required";
}

export const APP_CONFIG_FIELD_DESCRIPTORS: readonly AppConfigFieldDescriptor[] = deriveFieldDescriptors();

export function serializeAppConfigEditorSchema(): string {
  return canonicalJson(APP_CONFIG_SCHEMA);
}

export function serializeAppConfigDescriptors(): string {
  return canonicalJson({
    descriptors: APP_CONFIG_FIELD_DESCRIPTORS,
    schemaId: APP_CONFIG_SCHEMA_ID,
    schemaRevision: APP_CONFIG_SCHEMA_REVISION,
  });
}

function deriveFieldDescriptors(): readonly AppConfigFieldDescriptor[] {
  const descriptors = new Map<string, AppConfigFieldDescriptor>();
  walkChildren(APP_CONFIG_SCHEMA, "", {
    structuralOwner: "app-configuration",
    semanticOwner: "app-domain",
    sensitivity: "public",
    authorityImpact: "authority-bearing",
    defaultPosture: "omitted",
  }, descriptors);
  return [...descriptors.values()].sort((left, right) => left.identity.localeCompare(right.identity));
}

function walkSchema(schema: TSchema, identity: string, inherited: DescriptorContext, descriptors: Map<string, AppConfigFieldDescriptor>): void {
  const context = descriptorContext(schema, inherited);
  descriptors.set(identity, {
    identity,
    structuralOwner: context.structuralOwner,
    semanticOwner: context.semanticOwner,
    scope: "app",
    sensitivity: context.sensitivity,
    authorityImpact: context.authorityImpact,
    activation: "restart-required",
    defaultPosture: context.defaultPosture,
    schemaRevision: APP_CONFIG_SCHEMA_REVISION,
    valueType: schemaValueType(schema),
  });
  walkChildren(schema, identity, context, descriptors);
}

function walkChildren(schema: TSchema, identity: string, context: DescriptorContext, descriptors: Map<string, AppConfigFieldDescriptor>): void {
  if (isRecord(schema.properties)) {
    const required = new Set(Array.isArray(schema.required) ? schema.required.filter(isString) : []);
    for (const [name, child] of Object.entries(schema.properties)) {
      if (!isSchema(child)) continue;
      walkSchema(child, `${identity}/${escapeJsonPointer(name)}`, required.has(name)
        ? { ...context, defaultPosture: "required" }
        : { ...context, defaultPosture: "omitted" }, descriptors);
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
    sensitivity: annotation(schema, "x-kiln-sensitivity") === "secret-reference" ? "secret-reference" : inherited.sensitivity,
    authorityImpact: annotation(schema, "x-kiln-authority-impact") === "none" ? "none" : inherited.authorityImpact,
    defaultPosture: inherited.defaultPosture,
  };
}

function annotation(schema: TSchema, key: string): string | undefined {
  return typeof schema[key] === "string" ? schema[key] : undefined;
}

function schemaValueType(schema: TSchema): string {
  return typeof schema.type === "string" ? schema.type : "unknown";
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, member]) => [key, sortJson(member)]));
}

function pointerToField(pointer: string): string {
  if (!pointer || pointer === "/") return "root";
  const segments = pointer.split("/").slice(1).map((value) => value.replaceAll("~1", "/").replaceAll("~0", "~"));
  return segments.map((segment, index) => /^\d+$/u.test(segment) ? `[${segment}]` : `${index > 0 ? "." : ""}${segment}`).join("");
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
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
