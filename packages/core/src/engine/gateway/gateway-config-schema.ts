import { fileURLToPath } from "node:url";
import { Type, type ObjectOptions, type Static, type TObject, type TProperties, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import pkg from "../../../package.json" with { type: "json" };

export const GATEWAY_CONFIG_SCHEMA_REVISION = 1;
export const GATEWAY_CONFIG_SCHEMA_ID = "https://kiln.dev/schemas/gateway-config-v1.json";

export type GatewayConfigActivation = "restart-required";
export type GatewayConfigSensitivity = "public" | "secret-reference";
export type GatewayConfigAuthorityImpact = "none" | "authority-bearing";

export interface GatewayConfigFieldDescriptor {
  readonly identity: string;
  readonly structuralOwner: string;
  readonly semanticOwner: string;
  readonly scope: "gateway";
  readonly sensitivity: GatewayConfigSensitivity;
  readonly authorityImpact: GatewayConfigAuthorityImpact;
  readonly activation: GatewayConfigActivation;
  readonly defaultPosture: "omitted" | "required";
  readonly schemaRevision: number;
  readonly description?: string;
  readonly valueType: string;
}

function strictObject<T extends TProperties>(properties: T, options: ObjectOptions = {}): TObject<T> {
  return Type.Object(properties, { ...options, additionalProperties: false });
}

const nonEmptyString = Type.String({ minLength: 1, pattern: "\\S" });
const canonicalId = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$" });
const environmentName = Type.String({ pattern: "^[A-Z_][A-Z0-9_]*$" });
const positivePort = Type.Integer({ minimum: 1, maximum: 65_535 });
const stringArray = Type.Array(Type.String());

const channelBinding = strictObject({
  type: Type.Readonly(nonEmptyString),
  path: Type.ReadonlyOptional(Type.String()),
  phoneNumber: Type.ReadonlyOptional(Type.String()),
  multiTenant: Type.ReadonlyOptional(Type.Boolean()),
  verifyTokenEnv: Type.ReadonlyOptional(environmentName),
  adminTokenEnv: Type.ReadonlyOptional(environmentName),
  accessTokenEnv: Type.ReadonlyOptional(environmentName),
  apiKeyEnv: Type.ReadonlyOptional(environmentName),
  appSecretEnv: Type.ReadonlyOptional(environmentName),
  publicMediaBaseUrlEnv: Type.ReadonlyOptional(environmentName),
  publicMediaSigningSecretEnv: Type.ReadonlyOptional(environmentName),
  allowedOrigins: Type.ReadonlyOptional(stringArray),
}, {
  description: "One App Gateway channel binding. Credential material is referenced only by environment-variable name.",
  "x-kiln-semantic-owner": "app-gateway-channel-binding",
  "x-kiln-sensitivity": "public",
  "x-kiln-authority-impact": "authority-bearing",
});

for (const key of [
  "verifyTokenEnv",
  "adminTokenEnv",
  "accessTokenEnv",
  "apiKeyEnv",
  "appSecretEnv",
  "publicMediaBaseUrlEnv",
  "publicMediaSigningSecretEnv",
] as const) {
  Object.assign(channelBinding.properties[key], { "x-kiln-sensitivity": "secret-reference" });
}

const appBinding = strictObject({
  name: Type.Readonly(nonEmptyString),
  config: Type.Readonly(nonEmptyString),
  workspace: Type.ReadonlyOptional(nonEmptyString),
  channels: Type.Readonly(Type.Array(channelBinding, { minItems: 1 })),
}, {
  description: "One deployable App bound into this gateway process.",
  "x-kiln-semantic-owner": "app-gateway-runtime",
  "x-kiln-authority-impact": "authority-bearing",
});

const observability = strictObject({
  enabled: Type.Readonly(Type.Boolean({ default: true })),
  exporter: Type.Readonly(Type.Union([
    Type.Literal("otlp"),
    Type.Literal("console"),
    Type.Literal("none"),
  ], { default: "none" })),
  endpoint: Type.ReadonlyOptional(Type.String()),
  serviceName: Type.Readonly(nonEmptyString),
  attributes: Type.ReadonlyOptional(Type.Record(nonEmptyString, Type.String())),
}, {
  "x-kiln-semantic-owner": "gateway-observability",
  "x-kiln-authority-impact": "none",
});

const authentication = strictObject({
  algorithm: Type.Readonly(Type.Union([Type.Literal("RS256"), Type.Literal("HS256")])),
  jwksUri: Type.ReadonlyOptional(nonEmptyString),
  secretEnv: Type.ReadonlyOptional(environmentName),
  issuer: Type.ReadonlyOptional(Type.String()),
  audience: Type.ReadonlyOptional(Type.String()),
  clockToleranceSeconds: Type.ReadonlyOptional(Type.Integer({ minimum: 0 })),
}, {
  "x-kiln-semantic-owner": "gateway-authentication",
  "x-kiln-authority-impact": "authority-bearing",
});
Object.assign(authentication.properties.secretEnv, { "x-kiln-sensitivity": "secret-reference" });

const mcpAuthentication = strictObject({
  type: Type.Readonly(Type.Union([Type.Literal("api-key"), Type.Literal("none")])),
  keyEnv: Type.ReadonlyOptional(environmentName),
}, {
  "x-kiln-authority-impact": "authority-bearing",
});
Object.assign(mcpAuthentication.properties.keyEnv, { "x-kiln-sensitivity": "secret-reference" });

const mcp = strictObject({
  enabled: Type.Readonly(Type.Boolean({ default: false })),
  path: Type.ReadonlyOptional(Type.String()),
  auth: Type.ReadonlyOptional(mcpAuthentication),
}, {
  "x-kiln-semantic-owner": "gateway-mcp",
  "x-kiln-authority-impact": "authority-bearing",
});

const modelGatewayHttpSurface = strictObject({
  maxBodyBytes: Type.Readonly(Type.Integer({ minimum: 1, maximum: 64 * 1024 * 1024 })),
  maxConcurrentRequests: Type.Readonly(Type.Integer({ minimum: 1, maximum: 1_024 })),
});

const modelGatewayPrincipal = strictObject({
  tokenEnv: Type.Readonly(environmentName),
  ingress: Type.Readonly(Type.Union([Type.Literal("openai-responses"), Type.Literal("anthropic-messages")])),
  tenantId: Type.Readonly(canonicalId),
  applicationId: Type.Readonly(canonicalId),
  callerId: Type.Readonly(canonicalId),
  capabilityId: Type.Readonly(canonicalId),
  scopes: Type.Readonly(Type.Array(canonicalId, { minItems: 1, uniqueItems: true })),
  budgetEvidenceId: Type.Readonly(canonicalId),
  virtualModelIds: Type.Readonly(Type.Array(canonicalId, { minItems: 1, uniqueItems: true })),
  nativeHarness: Type.ReadonlyOptional(Type.Union([
    Type.Literal("codex"),
    Type.Literal("opencode"),
    Type.Literal("claude"),
  ])),
}, {
  "x-kiln-authority-impact": "authority-bearing",
});
Object.assign(modelGatewayPrincipal.properties.tokenEnv, { "x-kiln-sensitivity": "secret-reference" });

const modelGatewayCapability = Type.Union([
  Type.Literal("text"),
  Type.Literal("input-image-url"),
  Type.Literal("input-image-base64"),
  Type.Literal("function-tools"),
  Type.Literal("custom-tools-lark"),
  Type.Literal("parallel-tool-calls"),
  Type.Literal("json-schema-response"),
  Type.Literal("reasoning-controls"),
  Type.Literal("text-verbosity"),
]);

const modelGatewayVirtualModel = strictObject({
  id: Type.Readonly(canonicalId),
  displayName: Type.ReadonlyOptional(Type.String({ minLength: 1, maxLength: 128 })),
  contextTokens: Type.ReadonlyOptional(Type.Integer({ minimum: 1 })),
  outputTokens: Type.ReadonlyOptional(Type.Integer({ minimum: 1 })),
  baseInstructions: Type.ReadonlyOptional(nonEmptyString),
  targetId: Type.Readonly(canonicalId),
  capabilities: Type.Readonly(Type.Array(modelGatewayCapability, { minItems: 1, uniqueItems: true })),
  deliberation: Type.ReadonlyOptional(strictObject({
    levels: Type.Readonly(Type.Array(canonicalId, { minItems: 1, uniqueItems: true })),
    defaultLevel: Type.ReadonlyOptional(canonicalId),
    supportsAdaptive: Type.Readonly(Type.Boolean({ default: false })),
    evidenceRevision: Type.Readonly(canonicalId),
  })),
  affinity: Type.Readonly(strictObject({
    continuity: Type.Readonly(Type.Union([
      Type.Literal("none"),
      Type.Literal("prefer"),
      Type.Literal("require"),
    ])),
    scope: Type.ReadonlyOptional(Type.Union([Type.Literal("session"), Type.Literal("turn")])),
    allowRebind: Type.ReadonlyOptional(Type.Boolean()),
  })),
}, {
  "x-kiln-authority-impact": "authority-bearing",
});

const modelGatewayReplay = strictObject({
  ttlMs: Type.Readonly(Type.Integer({ minimum: 1, maximum: 86_400_000 })),
  maxEntries: Type.Readonly(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
  hmacKeyEnv: Type.Readonly(environmentName),
});
Object.assign(modelGatewayReplay.properties.hmacKeyEnv, { "x-kiln-sensitivity": "secret-reference" });

const modelGateway = strictObject({
  port: Type.Readonly(positivePort),
  replay: Type.Readonly(modelGatewayReplay),
  principals: Type.Readonly(Type.Array(modelGatewayPrincipal, { minItems: 1 })),
  virtualModels: Type.Readonly(Type.Array(modelGatewayVirtualModel, { minItems: 1 })),
  surfaces: Type.Readonly(strictObject({
    openAIResponses: Type.ReadonlyOptional(modelGatewayHttpSurface),
    anthropicMessages: Type.ReadonlyOptional(modelGatewayHttpSurface),
  })),
  codexComposite: Type.ReadonlyOptional(strictObject({
    maxQueuedRequests: Type.Readonly(Type.Integer({ minimum: 0, maximum: 4_096 })),
    queueTimeoutMs: Type.Readonly(Type.Integer({ minimum: 1, maximum: 300_000 })),
  })),
}, {
  "x-kiln-semantic-owner": "model-gateway",
  "x-kiln-authority-impact": "authority-bearing",
});

export const GATEWAY_CONFIG_SCHEMA = strictObject({
  port: Type.Readonly(positivePort),
  apps: Type.Readonly(Type.Array(appBinding)),
  observability: Type.ReadonlyOptional(observability),
  auth: Type.ReadonlyOptional(authentication),
  mcp: Type.ReadonlyOptional(mcp),
  modelGateway: Type.ReadonlyOptional(modelGateway),
}, {
  $id: GATEWAY_CONFIG_SCHEMA_ID,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Kiln gateway configuration",
  description: "Canonical schema for gateway.yaml.",
  "x-kiln-schema-revision": GATEWAY_CONFIG_SCHEMA_REVISION,
  "x-kiln-structural-owner": "gateway-configuration",
  "x-kiln-semantic-owner": "app-gateway-runtime",
  "x-kiln-scope": "gateway",
  "x-kiln-sensitivity": "public",
  "x-kiln-authority-impact": "authority-bearing",
  "x-kiln-activation": "restart-required",
  "x-kiln-default-posture": "omitted",
});

type DeepReadonly<T> = T extends readonly unknown[]
  ? ReadonlyArray<DeepReadonly<T[number]>>
  : T extends Readonly<Record<PropertyKey, unknown>>
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type GatewayConfig = DeepReadonly<Static<typeof GATEWAY_CONFIG_SCHEMA>>;
export type GatewayAppBinding = GatewayConfig["apps"][number];
export type GatewayChannelBinding = GatewayAppBinding["channels"][number];
export type ObservabilityConfig = NonNullable<GatewayConfig["observability"]>;
export type ObservabilityExporter = ObservabilityConfig["exporter"];
export type GatewayAuthConfig = NonNullable<GatewayConfig["auth"]>;
export type JwtAlgorithm = GatewayAuthConfig["algorithm"];
export type GatewayMcpConfig = NonNullable<GatewayConfig["mcp"]>;
export type GatewayMcpAuthConfig = NonNullable<GatewayMcpConfig["auth"]>;
export type McpAuthType = GatewayMcpAuthConfig["type"];
export type ModelGatewayConfig = NonNullable<GatewayConfig["modelGateway"]>;
export type ModelGatewayPrincipalConfig = ModelGatewayConfig["principals"][number];
export type ModelGatewayVirtualModelConfig = ModelGatewayConfig["virtualModels"][number];
export type ModelGatewayCapabilityId = ModelGatewayVirtualModelConfig["capabilities"][number];
export type ModelGatewayHttpSurfaceConfig = NonNullable<ModelGatewayConfig["surfaces"]["openAIResponses"]>;
export type ModelGatewayCodexCompositeConfig = NonNullable<ModelGatewayConfig["codexComposite"]>;

export type GatewayConfigStructuralAdmission =
  | { readonly ok: true; readonly value: GatewayConfig }
  | { readonly ok: false; readonly errors: readonly GatewayConfigStructuralError[] };

export interface GatewayConfigStructuralError {
  readonly field: string;
  readonly message: string;
  readonly unknownField: boolean;
}

export function parseGatewayConfigStructure(value: unknown): GatewayConfigStructuralAdmission {
  const candidate = applyGatewayDefaults(value);
  if (Value.Check(GATEWAY_CONFIG_SCHEMA, candidate)) return { ok: true, value: candidate };
  return {
    ok: false,
    errors: [...Value.Errors(GATEWAY_CONFIG_SCHEMA, candidate)].map((error) => ({
      field: pointerToField(error.path),
      message: error.message === "Unexpected property" ? "is not supported" : error.message,
      unknownField: error.message === "Unexpected property",
    })),
  };
}

export function describeRunningGatewayConfigSchema(): string {
  let modulePath: string;
  try {
    modulePath = fileURLToPath(import.meta.url);
  } catch {
    modulePath = import.meta.url;
  }
  return `gateway-config-v${GATEWAY_CONFIG_SCHEMA_REVISION} in @kilnai/core ${pkg.version} at ${modulePath}`;
}

export const GATEWAY_CONFIG_FIELD_DESCRIPTORS: readonly GatewayConfigFieldDescriptor[] = deriveFieldDescriptors();

export function serializeGatewayConfigEditorSchema(): string {
  return canonicalJson(GATEWAY_CONFIG_SCHEMA);
}

export function serializeGatewayConfigDescriptors(): string {
  return canonicalJson({
    descriptors: GATEWAY_CONFIG_FIELD_DESCRIPTORS,
    schemaId: GATEWAY_CONFIG_SCHEMA_ID,
    schemaRevision: GATEWAY_CONFIG_SCHEMA_REVISION,
  });
}

function applyGatewayDefaults(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    port: value.port ?? 4_800,
    apps: value.apps ?? [],
    ...(isRecord(value.observability)
      ? { observability: { enabled: true, exporter: "none", ...value.observability } }
      : {}),
    ...(isRecord(value.mcp) ? { mcp: { enabled: false, ...value.mcp } } : {}),
    ...(isRecord(value.modelGateway) && Array.isArray(value.modelGateway.virtualModels)
      ? {
          modelGateway: {
            ...value.modelGateway,
            virtualModels: value.modelGateway.virtualModels.map((model) => isRecord(model) && isRecord(model.deliberation)
              ? { ...model, deliberation: { supportsAdaptive: false, ...model.deliberation } }
              : model),
          },
        }
      : {}),
  };
}

interface DescriptorContext {
  readonly structuralOwner: string;
  readonly semanticOwner: string;
  readonly scope: "gateway";
  readonly sensitivity: GatewayConfigSensitivity;
  readonly authorityImpact: GatewayConfigAuthorityImpact;
  readonly activation: GatewayConfigActivation;
  readonly defaultPosture: "omitted" | "required";
}

function deriveFieldDescriptors(): readonly GatewayConfigFieldDescriptor[] {
  const descriptors = new Map<string, GatewayConfigFieldDescriptor>();
  const context: DescriptorContext = {
    structuralOwner: "gateway-configuration",
    semanticOwner: "app-gateway-runtime",
    scope: "gateway",
    sensitivity: "public",
    authorityImpact: "authority-bearing",
    activation: "restart-required",
    defaultPosture: "omitted",
  };
  walkChildren(GATEWAY_CONFIG_SCHEMA, "", context, descriptors);
  return [...descriptors.values()].sort((left, right) => left.identity.localeCompare(right.identity));
}

function walkSchema(
  schema: TSchema,
  identity: string,
  inherited: DescriptorContext,
  descriptors: Map<string, GatewayConfigFieldDescriptor>,
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
    schemaRevision: GATEWAY_CONFIG_SCHEMA_REVISION,
    ...(description === undefined ? {} : { description }),
    valueType: schemaValueType(schema),
  });
  walkChildren(schema, identity, context, descriptors);
}

function walkChildren(
  schema: TSchema,
  identity: string,
  context: DescriptorContext,
  descriptors: Map<string, GatewayConfigFieldDescriptor>,
): void {
  if (isSchemaRecord(schema.properties)) {
    const required = new Set(Array.isArray(schema.required) ? schema.required.filter(isString) : []);
    for (const [name, child] of Object.entries(schema.properties)) {
      if (!isSchema(child)) continue;
      walkSchema(
        child,
        `${identity}/${escapeJsonPointer(name)}`,
        required.has(name) ? { ...context, defaultPosture: "required" } : { ...context, defaultPosture: "omitted" },
        descriptors,
      );
    }
  }
  if (isSchema(schema.items)) walkSchema(schema.items, `${identity}/*`, context, descriptors);
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
    scope: "gateway",
    sensitivity: sensitivityAnnotation(schema) ?? inherited.sensitivity,
    authorityImpact: authorityAnnotation(schema) ?? inherited.authorityImpact,
    activation: "restart-required",
    defaultPosture: inherited.defaultPosture,
  };
}

function annotation(schema: TSchema, key: string): string | undefined {
  const value = schema[key];
  return typeof value === "string" ? value : undefined;
}

function sensitivityAnnotation(schema: TSchema): GatewayConfigSensitivity | undefined {
  const value = annotation(schema, "x-kiln-sensitivity");
  return value === "public" || value === "secret-reference" ? value : undefined;
}

function authorityAnnotation(schema: TSchema): GatewayConfigAuthorityImpact | undefined {
  const value = annotation(schema, "x-kiln-authority-impact");
  return value === "none" || value === "authority-bearing" ? value : undefined;
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

function pointerToField(pointer: string): string {
  if (!pointer || pointer === "/") return "root";
  const segments = pointer.split("/").slice(1).map(unescapeJsonPointer);
  return segments.map((segment, index) => /^\d+$/u.test(segment)
    ? `[${segment}]`
    : `${index > 0 ? "." : ""}${segment}`).join("");
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function unescapeJsonPointer(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
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
