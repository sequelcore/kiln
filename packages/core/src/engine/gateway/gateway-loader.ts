// Engine loader: GatewayLoader -- parses gateway YAML into typed config
// Does NOT load individual App YAML files

import { parse } from "yaml";
import { KilnError } from "../errors.js";
import type {
  GatewayConfig,
  GatewayAppBinding,
  GatewayChannelBinding,
  GatewayValidationError,
  ModelGatewayConfig,
  ModelGatewayAccountEconomicsConfig,
  ModelGatewayPriceEvidenceConfig,
  ModelGatewayRouteEconomicsConfig,
} from "./gateway-config.js";
import { validateGatewayConfig } from "./gateway-config.js";
import type { ObservabilityConfig } from "./observability-config.js";
import { validateObservabilityConfig } from "./observability-config.js";
import type { GatewayAuthConfig } from "./auth-config.js";
import { validateGatewayAuthConfig } from "./auth-config.js";
import type { GatewayMcpConfig } from "./mcp-config.js";
import { validateGatewayMcpConfig } from "./mcp-config.js";
import type { DirectProviderId } from "../../agents/provider-execution-profiles.js";
import type { ManagedEconomicAmount, ManagedEconomicEvidenceIdentity, ManagedEconomicScheme } from "../../cost/managed-route-economics.js";

/** Error class for gateway YAML loader failures, aggregating all validation errors */
export class GatewayLoaderError extends KilnError {
  readonly errors: readonly GatewayValidationError[];

  constructor(errors: readonly GatewayValidationError[]) {
    const msg = errors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
    super("GATEWAY_YAML_INVALID", `Invalid gateway YAML:\n${msg}`, {
      context: { errors },
      retryable: false,
    });
    this.name = "GatewayLoaderError";
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// Internal YAML shape types (unvalidated raw structure from parse())
// ---------------------------------------------------------------------------

interface RawChannelBinding {
  type?: unknown;
  path?: unknown;
  phoneNumber?: unknown;
  botToken?: unknown;
  [key: string]: unknown;
}

interface RawAppBinding {
  name?: unknown;
  config?: unknown;
  workspace?: unknown;
  channels?: unknown;
}

interface RawGateway {
  port?: unknown;
  apps?: unknown;
  observability?: unknown;
  auth?: unknown;
  mcp?: unknown;
  modelGateway?: unknown;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapChannelBinding(raw: RawChannelBinding): GatewayChannelBinding {
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
  const strArr = (v: unknown): readonly string[] | undefined =>
    Array.isArray(v) && v.every((s) => typeof s === "string") ? v : undefined;

  return {
    type: str(raw.type) ?? "",
    path: str(raw.path),
    phoneNumber: str(raw.phoneNumber),
    botToken: str(raw.botToken),
    multiTenant: bool(raw.multiTenant),
    verifyTokenEnv: str(raw.verifyTokenEnv),
    adminTokenEnv: str(raw.adminTokenEnv),
    accessTokenEnv: str(raw.accessTokenEnv),
    apiKeyEnv: str(raw.apiKeyEnv),
    appSecretEnv: str(raw.appSecretEnv),
    publicMediaBaseUrlEnv: str(raw.publicMediaBaseUrlEnv),
    publicMediaSigningSecretEnv: str(raw.publicMediaSigningSecretEnv),
    allowedOrigins: strArr(raw.allowedOrigins),
  };
}

function mapAppBinding(raw: RawAppBinding, path: string): { binding: GatewayAppBinding; errors: GatewayValidationError[] } {
  const errors: GatewayValidationError[] = [];

  if (!raw.name || typeof raw.name !== "string") {
    errors.push({ field: `${path}.name`, message: "must be a non-empty string" });
  }

  if (!raw.config || typeof raw.config !== "string") {
    errors.push({ field: `${path}.config`, message: "must be a non-empty string" });
  }

  const channels: GatewayChannelBinding[] = [];
  if (!raw.channels || !Array.isArray(raw.channels)) {
    errors.push({ field: `${path}.channels`, message: "must be a non-empty array" });
  } else {
    for (const ch of raw.channels) {
      if (ch && typeof ch === "object" && !Array.isArray(ch)) {
        channels.push(mapChannelBinding(ch as RawChannelBinding));
      }
    }
  }

  const binding: GatewayAppBinding = {
    name: typeof raw.name === "string" ? raw.name : "",
    config: typeof raw.config === "string" ? raw.config : "",
    ...(typeof raw.workspace === "string" ? { workspace: raw.workspace } : {}),
    channels,
  };

  return { binding, errors };
}

function resolveEnvValue(value: string): string {
  if (!value.startsWith("$")) return value;
  return process.env[value.slice(1)] ?? "";
}

function mapModelGateway(rawValue: unknown, errors: GatewayValidationError[]): ModelGatewayConfig | undefined {
  if (!isRecord(rawValue)) { errors.push({ field: "modelGateway", message: "must be an object" }); return undefined; }
  rejectUnknown(rawValue, ["port", "accounts", "replay", "principals", "virtualModels", "surfaces"], "modelGateway", errors);
  const replay = isRecord(rawValue.replay) ? rawValue.replay : {};
  rejectUnknown(replay, ["ttlMs", "maxEntries", "hmacKeyEnv"], "modelGateway.replay", errors);
  const rawSurfaces = isRecord(rawValue.surfaces) ? rawValue.surfaces : {};
  if (!isRecord(rawValue.surfaces)) errors.push({ field: "modelGateway.surfaces", message: "must be an object" });
  rejectUnknown(rawSurfaces, ["openAIResponses", "anthropicMessages"], "modelGateway.surfaces", errors);
  const rawResponses = rawSurfaces.openAIResponses;
  let openAIResponses: ModelGatewayConfig["surfaces"]["openAIResponses"];
  if (rawResponses !== undefined) {
    if (!isRecord(rawResponses)) errors.push({ field: "modelGateway.surfaces.openAIResponses", message: "must be an object" });
    else {
      rejectUnknown(rawResponses, ["maxBodyBytes", "maxConcurrentRequests"], "modelGateway.surfaces.openAIResponses", errors);
      openAIResponses = { maxBodyBytes: num(rawResponses.maxBodyBytes), maxConcurrentRequests: num(rawResponses.maxConcurrentRequests) };
    }
  }
  const rawAnthropic = rawSurfaces.anthropicMessages;
  let anthropicMessages: ModelGatewayConfig["surfaces"]["anthropicMessages"];
  if (rawAnthropic !== undefined) {
    if (!isRecord(rawAnthropic)) errors.push({ field: "modelGateway.surfaces.anthropicMessages", message: "must be an object" });
    else {
      rejectUnknown(rawAnthropic, ["maxBodyBytes", "maxConcurrentRequests"], "modelGateway.surfaces.anthropicMessages", errors);
      anthropicMessages = { maxBodyBytes: num(rawAnthropic.maxBodyBytes), maxConcurrentRequests: num(rawAnthropic.maxConcurrentRequests) };
    }
  }
  const principals = Array.isArray(rawValue.principals) ? rawValue.principals.map((entry, index) => {
    const raw = isRecord(entry) ? entry : {};
    rejectUnknown(raw, ["tokenEnv", "ingress", "tenantId", "applicationId", "callerId", "capabilityId", "scopes", "budgetEvidenceId", "virtualModelIds", "nativeHarness"], `modelGateway.principals[${index}]`, errors);
    if (raw.nativeHarness !== undefined && typeof raw.nativeHarness !== "string") errors.push({ field: `modelGateway.principals[${index}].nativeHarness`, message: "must be a string" });
    return { tokenEnv: str(raw.tokenEnv), ingress: str(raw.ingress) as ModelGatewayConfig["principals"][number]["ingress"], tenantId: str(raw.tenantId), applicationId: str(raw.applicationId), callerId: str(raw.callerId), capabilityId: str(raw.capabilityId), scopes: strings(raw.scopes), budgetEvidenceId: str(raw.budgetEvidenceId), virtualModelIds: strings(raw.virtualModelIds), ...(typeof raw.nativeHarness === "string" ? { nativeHarness: raw.nativeHarness as ModelGatewayConfig["principals"][number]["nativeHarness"] } : {}) };
  }) : [];
  const virtualModels = Array.isArray(rawValue.virtualModels) ? rawValue.virtualModels.map((entry, index) => {
    const raw = isRecord(entry) ? entry : {};
    rejectUnknown(raw, ["id", "displayName", "contextTokens", "outputTokens", "baseInstructions", "providerId", "providerModelId", "accountIds", "capabilities", "affinity", "economics"], `modelGateway.virtualModels[${index}]`, errors);
    const affinity = isRecord(raw.affinity) ? raw.affinity : {};
    rejectUnknown(affinity, ["continuity", "scope", "allowRebind"], `modelGateway.virtualModels[${index}].affinity`, errors);
    if (affinity.scope !== undefined && typeof affinity.scope !== "string") errors.push({ field: `modelGateway.virtualModels[${index}].affinity.scope`, message: "must be a string" });
    if (affinity.allowRebind !== undefined && typeof affinity.allowRebind !== "boolean") errors.push({ field: `modelGateway.virtualModels[${index}].affinity.allowRebind`, message: "must be a boolean" });
    return { id: str(raw.id), ...(raw.displayName === undefined ? {} : { displayName: str(raw.displayName) }), ...(raw.contextTokens === undefined ? {} : { contextTokens: num(raw.contextTokens) }), ...(raw.outputTokens === undefined ? {} : { outputTokens: num(raw.outputTokens) }), ...(raw.baseInstructions === undefined ? {} : { baseInstructions: str(raw.baseInstructions) }), providerId: str(raw.providerId) as DirectProviderId, providerModelId: str(raw.providerModelId), accountIds: strings(raw.accountIds), capabilities: strings(raw.capabilities) as ModelGatewayConfig["virtualModels"][number]["capabilities"], affinity: { continuity: str(affinity.continuity) as "none", ...(typeof affinity.scope === "string" ? { scope: affinity.scope as "session" } : {}), ...(typeof affinity.allowRebind === "boolean" ? { allowRebind: affinity.allowRebind } : {}) }, ...(raw.economics === undefined ? {} : { economics: mapRouteEconomics(raw.economics, `modelGateway.virtualModels[${index}].economics`, errors) }) };
  }) : [];
  const accounts = Array.isArray(rawValue.accounts) ? rawValue.accounts.map((entry, index) => {
    const raw = isRecord(entry) ? entry : {};
    rejectUnknown(raw, ["id", "providerId", "credentialId", "maxConcurrency", "reservedAffinitySlots", "economics"], `modelGateway.accounts[${index}]`, errors);
    return { id: str(raw.id), providerId: str(raw.providerId) as DirectProviderId, credentialId: str(raw.credentialId), maxConcurrency: num(raw.maxConcurrency), reservedAffinitySlots: num(raw.reservedAffinitySlots), ...(raw.economics === undefined ? {} : { economics: mapAccountEconomics(raw.economics, `modelGateway.accounts[${index}].economics`, errors) }) };
  }) : [];
  return { port: num(rawValue.port), accounts, replay: { ttlMs: num(replay.ttlMs), maxEntries: num(replay.maxEntries), hmacKeyEnv: str(replay.hmacKeyEnv) }, principals, virtualModels, surfaces: { ...(openAIResponses ? { openAIResponses } : {}), ...(anthropicMessages ? { anthropicMessages } : {}) } };
}

function mapAccountEconomics(
  value: unknown,
  path: string,
  errors: GatewayValidationError[],
): ModelGatewayAccountEconomicsConfig {
  const raw = isRecord(value) ? value : {};
  if (!isRecord(value)) errors.push({ field: path, message: "must be an object" });
  rejectUnknown(raw, ["capacityIdentity", "subscriptionClass", "quotaClassId", "creditPosture", "overagePosture"], path, errors);
  return {
    capacityIdentity: str(raw.capacityIdentity),
    subscriptionClass: str(raw.subscriptionClass) as ModelGatewayAccountEconomicsConfig["subscriptionClass"],
    quotaClassId: str(raw.quotaClassId),
    creditPosture: str(raw.creditPosture) as ModelGatewayAccountEconomicsConfig["creditPosture"],
    overagePosture: str(raw.overagePosture) as ModelGatewayAccountEconomicsConfig["overagePosture"],
  };
}

function mapRouteEconomics(
  value: unknown,
  path: string,
  errors: GatewayValidationError[],
): ModelGatewayRouteEconomicsConfig {
  const raw = isRecord(value) ? value : {};
  if (!isRecord(value)) errors.push({ field: path, message: "must be an object" });
  rejectUnknown(raw, [
    "adapterCapabilityId",
    "adapterCapabilityVersion",
    "authBillingChannel",
    "executionMode",
    "serviceTier",
    "rateCardBasis",
    "envelopeSemantics",
    "fallbackPosture",
    "overagePosture",
    "contextClass",
    "cacheClass",
    "priceEvidence",
    "auxiliaryCharges",
    "executionEnvelope",
  ], path, errors);
  const envelope = isRecord(raw.executionEnvelope) ? raw.executionEnvelope : {};
  if (!isRecord(raw.executionEnvelope)) errors.push({ field: `${path}.executionEnvelope`, message: "must be an object" });
  rejectUnknown(envelope, ["limits"], `${path}.executionEnvelope`, errors);
  const auxiliaryCharges = Array.isArray(raw.auxiliaryCharges)
    ? raw.auxiliaryCharges.map((entry, index) => {
        const chargePath = `${path}.auxiliaryCharges[${index}]`;
        const charge = isRecord(entry) ? entry : {};
        if (!isRecord(entry)) errors.push({ field: chargePath, message: "must be an object" });
        rejectUnknown(charge, ["id", "amount"], chargePath, errors);
        return { id: str(charge.id), amount: mapEconomicAmount(charge.amount, `${chargePath}.amount`, errors) };
      })
    : [];
  if (!Array.isArray(raw.auxiliaryCharges)) errors.push({ field: `${path}.auxiliaryCharges`, message: "must be an array" });
  return {
    adapterCapabilityId: str(raw.adapterCapabilityId),
    adapterCapabilityVersion: str(raw.adapterCapabilityVersion),
    authBillingChannel: str(raw.authBillingChannel),
    executionMode: str(raw.executionMode),
    serviceTier: str(raw.serviceTier),
    rateCardBasis: str(raw.rateCardBasis),
    envelopeSemantics: str(raw.envelopeSemantics),
    fallbackPosture: str(raw.fallbackPosture) as ModelGatewayRouteEconomicsConfig["fallbackPosture"],
    overagePosture: str(raw.overagePosture) as ModelGatewayRouteEconomicsConfig["overagePosture"],
    contextClass: str(raw.contextClass),
    cacheClass: str(raw.cacheClass),
    priceEvidence: mapPriceEvidence(raw.priceEvidence, `${path}.priceEvidence`, errors),
    auxiliaryCharges,
    executionEnvelope: {
      limits: Array.isArray(envelope.limits)
        ? envelope.limits.map((entry, index) => mapEconomicAmount(entry, `${path}.executionEnvelope.limits[${index}]`, errors))
        : [],
    },
  };
}

function mapPriceEvidence(
  value: unknown,
  path: string,
  errors: GatewayValidationError[],
): ModelGatewayPriceEvidenceConfig {
  const raw = isRecord(value) ? value : {};
  if (!isRecord(value)) errors.push({ field: path, message: "must be an object" });
  const kind = str(raw.kind);
  const common = ["kind", "rateCardId", "rateCardRevision", "evidence"];
  const allowed = kind === "included"
    ? [...common, "allowanceId"]
    : kind === "metered"
      ? [...common, "unitPrices"]
      : kind === "unknown"
        ? [...common, "reason"]
        : kind === "estimated"
          ? [...common, "estimationMethod", "unitPrices"]
          : common;
  rejectUnknown(raw, allowed, path, errors);
  const base = {
    rateCardId: str(raw.rateCardId),
    rateCardRevision: str(raw.rateCardRevision),
    evidence: mapEconomicEvidence(raw.evidence, `${path}.evidence`, errors),
  };
  if (kind === "included") return { kind, ...base, allowanceId: str(raw.allowanceId) };
  if (kind === "metered") return { kind, ...base, unitPrices: mapUnitPrices(raw.unitPrices, path, errors) };
  if (kind === "unknown") return { kind, ...base, reason: str(raw.reason) };
  if (kind === "estimated") return { kind, ...base, estimationMethod: str(raw.estimationMethod), unitPrices: mapUnitPrices(raw.unitPrices, path, errors) };
  return { kind: kind as "subscription", ...base };
}

function mapUnitPrices(value: unknown, path: string, errors: GatewayValidationError[]) {
  if (!Array.isArray(value)) {
    errors.push({ field: `${path}.unitPrices`, message: "must be an array" });
    return [];
  }
  return value.map((entry, index) => {
    const unitPath = `${path}.unitPrices[${index}]`;
    const raw = isRecord(entry) ? entry : {};
    if (!isRecord(entry)) errors.push({ field: unitPath, message: "must be an object" });
    rejectUnknown(raw, ["usageUnit", "price"], unitPath, errors);
    return { usageUnit: str(raw.usageUnit), price: mapEconomicAmount(raw.price, `${unitPath}.price`, errors) };
  });
}

function mapEconomicEvidence(
  value: unknown,
  path: string,
  errors: GatewayValidationError[],
): ManagedEconomicEvidenceIdentity {
  const raw = isRecord(value) ? value : {};
  if (!isRecord(value)) errors.push({ field: path, message: "must be an object" });
  rejectUnknown(raw, ["sourceIdentity", "sourceRevision", "sourceDigest", "observedAt", "validUntil", "confidence", "authority"], path, errors);
  return {
    sourceIdentity: str(raw.sourceIdentity),
    sourceRevision: str(raw.sourceRevision),
    sourceDigest: str(raw.sourceDigest),
    observedAt: str(raw.observedAt),
    validUntil: str(raw.validUntil),
    confidence: str(raw.confidence) as ManagedEconomicEvidenceIdentity["confidence"],
    authority: str(raw.authority) as ManagedEconomicEvidenceIdentity["authority"],
  };
}

function mapEconomicAmount(
  value: unknown,
  path: string,
  errors: GatewayValidationError[],
): ManagedEconomicAmount {
  const raw = isRecord(value) ? value : {};
  if (!isRecord(value)) errors.push({ field: path, message: "must be an object" });
  rejectUnknown(raw, ["atoms", "scale", "unit", "scheme"], path, errors);
  return {
    atoms: str(raw.atoms),
    scale: num(raw.scale),
    unit: str(raw.unit),
    scheme: mapEconomicScheme(raw.scheme, `${path}.scheme`, errors),
  };
}

function mapEconomicScheme(
  value: unknown,
  path: string,
  errors: GatewayValidationError[],
): ManagedEconomicScheme {
  const raw = isRecord(value) ? value : {};
  if (!isRecord(value)) errors.push({ field: path, message: "must be an object" });
  const kind = str(raw.kind);
  rejectUnknown(raw, kind === "currency" ? ["kind", "currency"] : kind === "credit" ? ["kind", "creditSchemeId"] : ["kind"], path, errors);
  if (kind === "currency") return { kind, currency: str(raw.currency) };
  if (kind === "credit") return { kind, creditSchemeId: str(raw.creditSchemeId) };
  return { kind: kind as "unit" };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function str(value: unknown): string { return typeof value === "string" ? value : ""; }
function num(value: unknown): number { return typeof value === "number" ? value : Number.NaN; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map((entry) => typeof entry === "string" ? entry : "") : []; }
function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: GatewayValidationError[]): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push({ field: `${path}.${key}`, message: "is not supported" }); }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Parse a YAML string into a typed GatewayConfig. Throws GatewayLoaderError if invalid. */
export function parseGatewayYaml(content: string): GatewayConfig {
  let data: unknown;
  try {
    data = parse(content);
  } catch (err) {
    throw new GatewayLoaderError([{ field: "yaml", message: String(err) }]);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new GatewayLoaderError([{ field: "root", message: "must be a YAML object" }]);
  }

  const raw = data as RawGateway;
  const errors: GatewayValidationError[] = [];
  rejectUnknown(raw as unknown as Record<string, unknown>, ["port", "apps", "observability", "auth", "mcp", "modelGateway"], "root", errors);

  // port defaults to 4800
  let port = 4800;
  if (raw.port !== undefined) {
    if (typeof raw.port !== "number") {
      errors.push({ field: "port", message: "must be a number" });
    } else {
      port = raw.port;
    }
  }

  // apps
  const apps: GatewayAppBinding[] = [];
  if (raw.apps !== undefined && !Array.isArray(raw.apps)) {
    errors.push({ field: "apps", message: "must be an array" });
  } else if (raw.apps === undefined && raw.modelGateway === undefined) {
    errors.push({ field: "apps", message: "must be a non-empty array" });
  } else if (Array.isArray(raw.apps)) {
    for (let i = 0; i < raw.apps.length; i++) {
      const rawApp = raw.apps[i];
      if (!rawApp || typeof rawApp !== "object" || Array.isArray(rawApp)) {
        errors.push({ field: `apps[${i}]`, message: "must be an object" });
        continue;
      }
      const { binding, errors: appErrors } = mapAppBinding(rawApp as RawAppBinding, `apps[${i}]`);
      apps.push(binding);
      errors.push(...appErrors);
    }
  }

  if (errors.length > 0) throw new GatewayLoaderError(errors);

  // Parse optional observability block
  let observability: ObservabilityConfig | undefined;
  if (raw.observability !== undefined) {
    if (typeof raw.observability !== "object" || Array.isArray(raw.observability) || raw.observability === null) {
      errors.push({ field: "observability", message: "must be an object" });
    } else {
      const rawObs = raw.observability as Record<string, unknown>;
      const parsed: ObservabilityConfig = {
        enabled: typeof rawObs["enabled"] === "boolean" ? rawObs["enabled"] : true,
        exporter: (rawObs["exporter"] as ObservabilityConfig["exporter"]) ?? "none",
        ...(typeof rawObs["endpoint"] === "string" ? { endpoint: rawObs["endpoint"] } : {}),
        serviceName: typeof rawObs["serviceName"] === "string" ? rawObs["serviceName"] : "",
        ...(rawObs["attributes"] && typeof rawObs["attributes"] === "object" && !Array.isArray(rawObs["attributes"])
          ? { attributes: rawObs["attributes"] as Record<string, string> }
          : {}),
      };
      const obsErrors = validateObservabilityConfig(parsed);
      if (obsErrors.length > 0) {
        errors.push(...obsErrors);
      } else {
        observability = parsed;
      }
    }
  }

  // Parse optional auth block
  let auth: GatewayAuthConfig | undefined;
  if (raw.auth !== undefined) {
    if (typeof raw.auth !== "object" || Array.isArray(raw.auth) || raw.auth === null) {
      errors.push({ field: "auth", message: "must be an object" });
    } else {
      const rawAuth = raw.auth as Record<string, unknown>;
      const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
      const int = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
      const jwksUri = str(rawAuth["jwksUri"]);
      const parsed: GatewayAuthConfig = {
        algorithm: (str(rawAuth["algorithm"]) ?? "") as GatewayAuthConfig["algorithm"],
        ...(jwksUri ? { jwksUri: resolveEnvValue(jwksUri) } : {}),
        ...(str(rawAuth["secretEnv"]) ? { secretEnv: str(rawAuth["secretEnv"]) } : {}),
        ...(str(rawAuth["issuer"]) ? { issuer: str(rawAuth["issuer"]) } : {}),
        ...(str(rawAuth["audience"]) ? { audience: str(rawAuth["audience"]) } : {}),
        ...(int(rawAuth["clockToleranceSeconds"]) !== undefined
          ? { clockToleranceSeconds: int(rawAuth["clockToleranceSeconds"]) }
          : {}),
      };
      const authErrors = validateGatewayAuthConfig(parsed);
      if (authErrors.length > 0) {
        errors.push(...authErrors);
      } else {
        auth = parsed;
      }
    }
  }

  // Parse optional mcp block
  let mcp: GatewayMcpConfig | undefined;
  if (raw.mcp !== undefined) {
    if (typeof raw.mcp !== "object" || Array.isArray(raw.mcp) || raw.mcp === null) {
      errors.push({ field: "mcp", message: "must be an object" });
    } else {
      const rawMcp = raw.mcp as Record<string, unknown>;
      const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
      let mcpAuth: GatewayMcpConfig["auth"] | undefined;
      if (rawMcp["auth"] && typeof rawMcp["auth"] === "object" && !Array.isArray(rawMcp["auth"])) {
        const rawMcpAuth = rawMcp["auth"] as Record<string, unknown>;
        mcpAuth = {
          type: (str(rawMcpAuth["type"]) ?? "") as "api-key" | "none",
          ...(str(rawMcpAuth["keyEnv"]) ? { keyEnv: str(rawMcpAuth["keyEnv"]) } : {}),
        };
      }
      const rawMcpEval =
        rawMcp["eval"] && typeof rawMcp["eval"] === "object" && !Array.isArray(rawMcp["eval"])
          ? (rawMcp["eval"] as Record<string, unknown>)
          : undefined;
      const parsed: GatewayMcpConfig = {
        enabled: typeof rawMcp["enabled"] === "boolean" ? rawMcp["enabled"] : false,
        ...(typeof rawMcp["path"] === "string" ? { path: rawMcp["path"] } : {}),
        ...(mcpAuth ? { auth: mcpAuth } : {}),
        ...(rawMcpEval
          ? {
              eval: {
                provider: str(rawMcpEval["provider"]) ?? "",
                ...(str(rawMcpEval["model"]) ? { model: str(rawMcpEval["model"]) } : {}),
                ...(str(rawMcpEval["apiKeyEnv"]) ? { apiKeyEnv: str(rawMcpEval["apiKeyEnv"]) } : {}),
              },
            }
          : {}),
      };
      const mcpErrors = validateGatewayMcpConfig(parsed);
      if (mcpErrors.length > 0) {
        errors.push(...mcpErrors);
      } else {
        mcp = parsed;
      }
    }
  }

  const modelGateway = raw.modelGateway === undefined ? undefined : mapModelGateway(raw.modelGateway, errors);

  if (errors.length > 0) throw new GatewayLoaderError(errors);

  const config: GatewayConfig = { port, apps, ...(observability ? { observability } : {}), ...(auth ? { auth } : {}), ...(mcp ? { mcp } : {}), ...(modelGateway ? { modelGateway } : {}) };

  const validationErrors = validateGatewayConfig(config);
  if (validationErrors.length > 0) throw new GatewayLoaderError(validationErrors);

  return config;
}
