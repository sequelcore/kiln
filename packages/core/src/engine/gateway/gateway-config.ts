// Engine type: GatewayConfig -- multi-app gateway configuration
// Declares which Apps to host and how they bind to channels

import type { ObservabilityConfig } from "./observability-config.js";
import type { GatewayAuthConfig } from "./auth-config.js";
import type { GatewayMcpConfig } from "./mcp-config.js";
import { isDirectProviderId, type DirectProviderId } from "../../agents/provider-execution-profiles.js";
import { ModelCapabilityRegistry } from "../../agents/model-capability-registry.js";
import {
  validateManagedEconomicAmount,
  type ManagedEconomicAmount,
  type ManagedEconomicEvidenceIdentity,
} from "../../cost/managed-route-economics.js";

/** Channel binding for a specific platform adapter */
export interface GatewayChannelBinding {
  readonly type: string;
  readonly path?: string;
  readonly phoneNumber?: string;
  readonly botToken?: string;
  readonly multiTenant?: boolean;
  readonly verifyTokenEnv?: string;
  readonly adminTokenEnv?: string;
  readonly accessTokenEnv?: string;
  readonly apiKeyEnv?: string;
  readonly appSecretEnv?: string;
  readonly publicMediaBaseUrlEnv?: string;
  readonly publicMediaSigningSecretEnv?: string;
  readonly allowedOrigins?: readonly string[];
}

/** App binding: name, config path, optional workspace, and channel bindings */
export interface GatewayAppBinding {
  readonly name: string;
  readonly config: string;
  readonly workspace?: string;
  readonly channels: readonly GatewayChannelBinding[];
}

export type ModelGatewayCapabilityId =
  | "text" | "input-image-url" | "input-image-base64" | "function-tools" | "custom-tools-lark"
  | "parallel-tool-calls" | "json-schema-response" | "reasoning-controls" | "text-verbosity";

export interface ModelGatewayPrincipalConfig {
  readonly tokenEnv: string;
  readonly ingress: "openai-responses" | "anthropic-messages";
  readonly tenantId: string;
  readonly applicationId: string;
  readonly callerId: string;
  readonly capabilityId: string;
  readonly scopes: readonly string[];
  readonly budgetEvidenceId: string;
  readonly virtualModelIds: readonly string[];
  readonly nativeHarness?: "codex" | "opencode" | "claude";
}

export interface ModelGatewayVirtualModelConfig {
  readonly id: string;
  readonly displayName?: string;
  readonly contextTokens?: number;
  readonly outputTokens?: number;
  readonly baseInstructions?: string;
  readonly providerId: DirectProviderId;
  readonly providerModelId: string;
  readonly accountIds: readonly string[];
  readonly capabilities: readonly ModelGatewayCapabilityId[];
  readonly affinity: {
    readonly continuity: "none" | "prefer" | "require";
    readonly scope?: "session" | "turn";
    readonly allowRebind?: boolean;
  };
  readonly economics?: ModelGatewayRouteEconomicsConfig;
}

export interface ModelGatewayAccountConfig {
  readonly id: string;
  readonly providerId: DirectProviderId;
  readonly credentialId: string;
  readonly maxConcurrency: number;
  readonly reservedAffinitySlots: number;
  readonly economics?: ModelGatewayAccountEconomicsConfig;
}

export interface ModelGatewayAccountEconomicsConfig {
  readonly capacityIdentity: string;
  readonly subscriptionClass: "subscription" | "included" | "free" | "metered" | "unknown";
  readonly quotaClassId: string;
  readonly creditPosture: "disabled" | "committed";
  readonly overagePosture: "disabled" | "committed";
}

export interface ModelGatewayUnitPriceConfig {
  readonly usageUnit: string;
  readonly price: ManagedEconomicAmount;
}

export type ModelGatewayPriceEvidenceConfig =
  | {
      readonly kind: "subscription";
      readonly rateCardId: string;
      readonly rateCardRevision: string;
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "included";
      readonly allowanceId: string;
      readonly rateCardId: string;
      readonly rateCardRevision: string;
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "free";
      readonly rateCardId: string;
      readonly rateCardRevision: string;
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "metered";
      readonly rateCardId: string;
      readonly rateCardRevision: string;
      readonly unitPrices: readonly ModelGatewayUnitPriceConfig[];
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "unknown";
      readonly reason: string;
      readonly rateCardId: string;
      readonly rateCardRevision: string;
      readonly evidence: ManagedEconomicEvidenceIdentity;
    }
  | {
      readonly kind: "estimated";
      readonly estimationMethod: string;
      readonly rateCardId: string;
      readonly rateCardRevision: string;
      readonly unitPrices: readonly ModelGatewayUnitPriceConfig[];
      readonly evidence: ManagedEconomicEvidenceIdentity;
    };

export interface ModelGatewayRouteEconomicsConfig {
  readonly adapterCapabilityId: string;
  readonly adapterCapabilityVersion: string;
  readonly authBillingChannel: string;
  readonly executionMode: string;
  readonly serviceTier: string;
  readonly rateCardBasis: string;
  readonly envelopeSemantics: string;
  readonly fallbackPosture: "disabled" | "committed";
  readonly overagePosture: "disabled" | "committed";
  readonly contextClass: string;
  readonly cacheClass: string;
  readonly priceEvidence: ModelGatewayPriceEvidenceConfig;
  readonly auxiliaryCharges: readonly {
    readonly id: string;
    readonly amount: ManagedEconomicAmount;
  }[];
  readonly executionEnvelope: {
    readonly limits: readonly ManagedEconomicAmount[];
  };
}

export interface ModelGatewayConfig {
  readonly port: number;
  readonly accounts: readonly ModelGatewayAccountConfig[];
  readonly replay: { readonly ttlMs: number; readonly maxEntries: number; readonly hmacKeyEnv: string };
  readonly principals: readonly ModelGatewayPrincipalConfig[];
  readonly virtualModels: readonly ModelGatewayVirtualModelConfig[];
  readonly surfaces: {
    readonly openAIResponses?: ModelGatewayHttpSurfaceConfig;
    readonly anthropicMessages?: ModelGatewayHttpSurfaceConfig;
  };
}

export interface ModelGatewayHttpSurfaceConfig {
  readonly maxBodyBytes: number;
  readonly maxConcurrentRequests: number;
}

/** Top-level gateway configuration: port + multiple app bindings + optional observability + optional auth */
export interface GatewayConfig {
  readonly port: number;
  readonly apps: readonly GatewayAppBinding[];
  readonly observability?: ObservabilityConfig;
  readonly auth?: GatewayAuthConfig;
  readonly mcp?: GatewayMcpConfig;
  readonly modelGateway?: ModelGatewayConfig;
}

/** Validation error for gateway configuration */
export interface GatewayValidationError {
  readonly field: string;
  readonly message: string;
}

/** Validate a GatewayConfig. Returns array of errors; empty means valid. */
export function validateGatewayConfig(config: GatewayConfig): GatewayValidationError[] {
  const errors: GatewayValidationError[] = [];

  // Port must be a positive integer in valid TCP range
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push({ field: "port", message: "must be an integer between 1 and 65535" });
  }

  // Apps array must be non-empty
  if ((!config.apps || config.apps.length === 0) && !config.modelGateway) {
    errors.push({ field: "apps", message: "must have at least one app" });
    return errors;
  }

  const seenNames = new Set<string>();
  const seenPaths = new Set<string>();
  const seenPhoneNumbers = new Set<string>();

  for (let i = 0; i < config.apps.length; i++) {
    const app = config.apps[i]!;
    const prefix = `apps[${i}]`;

    if (!app.name || typeof app.name !== "string") {
      errors.push({ field: `${prefix}.name`, message: "must be a non-empty string" });
    } else if (seenNames.has(app.name)) {
      errors.push({ field: `${prefix}.name`, message: `duplicate app name "${app.name}"` });
    } else {
      seenNames.add(app.name);
    }

    if (!app.config || typeof app.config !== "string") {
      errors.push({ field: `${prefix}.config`, message: "must be a non-empty string" });
    }

    if (!app.channels || app.channels.length === 0) {
      errors.push({ field: `${prefix}.channels`, message: "must have at least one channel binding" });
    } else {
      for (let j = 0; j < app.channels.length; j++) {
        const channel = app.channels[j]!;
        const channelPrefix = `${prefix}.channels[${j}]`;

        if (channel.path && typeof channel.path === "string") {
          if (seenPaths.has(channel.path)) {
            errors.push({ field: `${channelPrefix}.path`, message: `duplicate API path "${channel.path}"` });
          } else {
            seenPaths.add(channel.path);
          }
        }

        if (channel.phoneNumber && typeof channel.phoneNumber === "string") {
          if (seenPhoneNumbers.has(channel.phoneNumber)) {
            errors.push({ field: `${channelPrefix}.phoneNumber`, message: `duplicate phone number "${channel.phoneNumber}"` });
          } else {
            seenPhoneNumbers.add(channel.phoneNumber);
          }
        }
      }
    }
  }

  if (config.modelGateway) validateModelGateway(config.modelGateway, config.port, errors);

  return errors;
}

const CAPABILITIES = new Set<ModelGatewayCapabilityId>(["text", "input-image-url", "input-image-base64", "function-tools", "custom-tools-lark", "parallel-tool-calls", "json-schema-response", "reasoning-controls", "text-verbosity"]);
const PROVIDER_CAPABILITIES: Readonly<Record<DirectProviderId, ReadonlySet<ModelGatewayCapabilityId>>> = {
  "codex-oauth": CAPABILITIES,
  "opencode-go": new Set(["text", "input-image-url", "input-image-base64", "function-tools"]),
  "opencode-zen": new Set(["text", "input-image-url", "input-image-base64", "function-tools"]),
  anthropic: new Set(["text", "input-image-url", "input-image-base64", "function-tools"]),
  openai: new Set(["text", "input-image-url", "input-image-base64", "function-tools"]),
  deepseek: new Set(["text", "input-image-url", "input-image-base64", "function-tools"]),
  openrouter: new Set(["text", "input-image-url", "input-image-base64", "function-tools"]),
  ollama: new Set(["text", "input-image-base64", "function-tools"]),
  lmstudio: new Set(["text", "input-image-url", "input-image-base64", "function-tools"]),
};
const MODEL_CAPABILITIES = new ModelCapabilityRegistry();
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const ENV = /^[A-Z_][A-Z0-9_]*$/;

function validateModelGateway(value: ModelGatewayConfig, gatewayPort: number, errors: GatewayValidationError[]): void {
  if (!Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535 || value.port === gatewayPort) errors.push({ field: "modelGateway.port", message: "must be a distinct integer port between 1 and 65535" });
  const accountIds = new Set<string>();
  const accountProviders = new Map<string, DirectProviderId>();
  const bindings = new Set<string>();
  const capacityIdentities = new Set<string>();
  for (const [index, account] of (value.accounts ?? []).entries()) {
    const path = `modelGateway.accounts[${index}]`;
    if (!ID.test(account.id ?? "") || accountIds.has(account.id)) errors.push({ field: `${path}.id`, message: "must be a unique canonical id" });
    else {
      accountIds.add(account.id);
      if (isDirectProviderId(account.providerId)) accountProviders.set(account.id, account.providerId);
    }
    if (!isDirectProviderId(account.providerId)) errors.push({ field: `${path}.providerId`, message: "must be a supported direct provider" });
    if (!ID.test(account.credentialId ?? "")) errors.push({ field: `${path}.credentialId`, message: "must be a canonical id" });
    const binding = `${account.providerId}:${account.credentialId}`;
    if (bindings.has(binding)) errors.push({ field: `${path}.credentialId`, message: "provider credential binding must be unique" }); else bindings.add(binding);
    if (!Number.isSafeInteger(account.maxConcurrency) || account.maxConcurrency < 1 || account.maxConcurrency > 1024) errors.push({ field: `${path}.maxConcurrency`, message: "must be an integer between 1 and 1024" });
    if (!Number.isSafeInteger(account.reservedAffinitySlots) || account.reservedAffinitySlots < 0 || account.reservedAffinitySlots > account.maxConcurrency) errors.push({ field: `${path}.reservedAffinitySlots`, message: "must be between 0 and maxConcurrency" });
    if (account.economics !== undefined) {
      validateAccountEconomics(account.economics, path, errors);
      if (capacityIdentities.has(account.economics.capacityIdentity)) {
        errors.push({ field: `${path}.economics.capacityIdentity`, message: "must be unique" });
      }
      capacityIdentities.add(account.economics.capacityIdentity);
    }
  }
  const hasOnlyAccountlessEconomicModels = Array.isArray(value.virtualModels)
    && value.virtualModels.length > 0
    && value.virtualModels.every((model) =>
      Array.isArray(model.accountIds)
      && model.accountIds.length === 0
      && model.economics !== undefined
    );
  if (
    !Array.isArray(value.accounts)
    || (value.accounts.length === 0 && !hasOnlyAccountlessEconomicModels)
  ) {
    errors.push({
      field: "modelGateway.accounts",
      message: "must be non-empty unless every virtual model is an explicit accountless economic route",
    });
  }
  const surfaces = value.surfaces;
  if (!surfaces || typeof surfaces !== "object") { errors.push({ field: "modelGateway.surfaces", message: "must be an object" }); return; }
  const responsesSurface = surfaces.openAIResponses;
  const anthropicSurface = surfaces.anthropicMessages;
  if (!responsesSurface && !anthropicSurface) errors.push({ field: "modelGateway.surfaces", message: "must configure at least one mounted surface" });
  for (const [name, surface] of [["openAIResponses", responsesSurface], ["anthropicMessages", anthropicSurface]] as const) if (surface) {
    bounded(surface.maxBodyBytes, 1, 64 * 1024 * 1024, `modelGateway.surfaces.${name}.maxBodyBytes`, errors, true);
    bounded(surface.maxConcurrentRequests, 1, 1024, `modelGateway.surfaces.${name}.maxConcurrentRequests`, errors, true);
  }
  if (!value.replay || !ENV.test(value.replay.hmacKeyEnv ?? "")) errors.push({ field: "modelGateway.replay.hmacKeyEnv", message: "must be a canonical environment variable name" });
  bounded(value.replay?.ttlMs, 1, 86_400_000, "modelGateway.replay.ttlMs", errors, true);
  bounded(value.replay?.maxEntries, 1, 1_000_000, "modelGateway.replay.maxEntries", errors, true);
  const tokens = new Set<string>();
  const principalIdentities = new Set<string>();
  const nativeHarnesses = new Set<string>();
  for (const [index, principal] of (value.principals ?? []).entries()) {
    const path = `modelGateway.principals[${index}]`;
    for (const [field, id] of Object.entries({ tenantId: principal.tenantId, applicationId: principal.applicationId, callerId: principal.callerId, capabilityId: principal.capabilityId, budgetEvidenceId: principal.budgetEvidenceId })) if (!ID.test(id ?? "")) errors.push({ field: `${path}.${field}`, message: "must be a canonical id" });
    if (!ENV.test(principal.tokenEnv ?? "")) errors.push({ field: `${path}.tokenEnv`, message: "must be a canonical environment variable name" });
    else if (tokens.has(principal.tokenEnv)) errors.push({ field: `${path}.tokenEnv`, message: "must be unique" }); else tokens.add(principal.tokenEnv);
    if (!Array.isArray(principal.scopes) || !principal.scopes.includes("model.invoke") || new Set(principal.scopes).size !== principal.scopes.length || principal.scopes.some((scope) => !ID.test(scope))) errors.push({ field: `${path}.scopes`, message: "must contain unique canonical scopes including model.invoke" });
    if (!Array.isArray(principal.virtualModelIds) || principal.virtualModelIds.length === 0 || new Set(principal.virtualModelIds).size !== principal.virtualModelIds.length || principal.virtualModelIds.some((id) => !ID.test(id))) errors.push({ field: `${path}.virtualModelIds`, message: "must contain unique canonical model ids" });
    if (principal.ingress === "openai-responses") {
      if (!responsesSurface) errors.push({ field: `${path}.ingress`, message: "requires modelGateway.surfaces.openAIResponses" });
    } else if (principal.ingress === "anthropic-messages") {
      if (!anthropicSurface) errors.push({ field: `${path}.ingress`, message: "requires modelGateway.surfaces.anthropicMessages" });
    } else errors.push({ field: `${path}.ingress`, message: "must be openai-responses or anthropic-messages" });
    if (principal.nativeHarness !== undefined) {
      if (!(["codex", "opencode", "claude"] as const).includes(principal.nativeHarness)) errors.push({ field: `${path}.nativeHarness`, message: "must be codex, opencode, or claude" });
      else if (principal.nativeHarness === "claude" && principal.ingress !== "anthropic-messages") errors.push({ field: `${path}.nativeHarness`, message: "claude requires anthropic-messages ingress" });
      else if (principal.nativeHarness !== "claude" && principal.ingress !== "openai-responses") errors.push({ field: `${path}.nativeHarness`, message: `${principal.nativeHarness} requires openai-responses ingress` });
      else if (nativeHarnesses.has(principal.nativeHarness)) errors.push({ field: `${path}.nativeHarness`, message: `native harness '${principal.nativeHarness}' must be unique` });
      else nativeHarnesses.add(principal.nativeHarness);
    }
    const identity = [principal.ingress, principal.tenantId, principal.applicationId, principal.callerId].join("\0");
    if (principalIdentities.has(identity)) errors.push({ field: path, message: "trusted principal identity must be unique" }); else principalIdentities.add(identity);
  }
  if (!Array.isArray(value.principals) || value.principals.length === 0) errors.push({ field: "modelGateway.principals", message: "must be non-empty" });
  const configuredIngresses = new Set((value.principals ?? []).map((principal) => principal.ingress));
  if (responsesSurface && !configuredIngresses.has("openai-responses")) errors.push({ field: "modelGateway.surfaces.openAIResponses", message: "requires at least one openai-responses principal" });
  if (anthropicSurface && !configuredIngresses.has("anthropic-messages")) errors.push({ field: "modelGateway.surfaces.anthropicMessages", message: "requires at least one anthropic-messages principal" });
  const models = new Set<string>();
  const nativeModelIds = new Set((value.principals ?? []).flatMap((principal) => principal.nativeHarness ? principal.virtualModelIds : []));
  const codexNativeModelIds = new Set((value.principals ?? []).flatMap((principal) => principal.nativeHarness === "codex" ? principal.virtualModelIds : []));
  const claudeNativeModelIds = new Set((value.principals ?? []).flatMap((principal) => principal.nativeHarness === "claude" ? principal.virtualModelIds : []));
  for (const [index, model] of (value.virtualModels ?? []).entries()) {
    const path = `modelGateway.virtualModels[${index}]`;
    if (!ID.test(model.id ?? "") || models.has(model.id)) errors.push({ field: `${path}.id`, message: "must be a unique canonical id" }); else models.add(model.id);
    if (claudeNativeModelIds.has(model.id) && !/^(?:claude|anthropic)[A-Za-z0-9._:-]*$/.test(model.id)) errors.push({ field: `${path}.id`, message: "Claude native model ids must start with claude or anthropic" });
    const requiresPickerMetadata = nativeModelIds.has(model.id);
    if ((requiresPickerMetadata || model.displayName !== undefined) && (typeof model.displayName !== "string" || model.displayName.trim().length === 0 || model.displayName.length > 128)) errors.push({ field: `${path}.displayName`, message: "must be a non-empty string of at most 128 characters when exposed to a native harness" });
    if ((requiresPickerMetadata || model.contextTokens !== undefined) && (!Number.isSafeInteger(model.contextTokens) || model.contextTokens! < 1)) errors.push({ field: `${path}.contextTokens`, message: "must be a positive safe integer when exposed to a native harness" });
    if ((requiresPickerMetadata || model.outputTokens !== undefined) && (!Number.isSafeInteger(model.outputTokens) || model.outputTokens! < 1 || model.contextTokens === undefined || model.outputTokens! > model.contextTokens)) errors.push({ field: `${path}.outputTokens`, message: "must be a positive safe integer no greater than contextTokens when exposed to a native harness" });
    if ((codexNativeModelIds.has(model.id) || model.baseInstructions !== undefined) && (typeof model.baseInstructions !== "string" || model.baseInstructions.trim().length === 0 || Buffer.byteLength(model.baseInstructions, "utf8") > 32_768)) errors.push({ field: `${path}.baseInstructions`, message: "must be non-empty and at most 32768 UTF-8 bytes when exposed to Codex" });
    if (!isDirectProviderId(model.providerId)) errors.push({ field: `${path}.providerId`, message: "must be a supported direct provider" });
    if (!ID.test(model.providerModelId ?? "")) errors.push({ field: `${path}.providerModelId`, message: "must be a canonical id" });
    const accountlessEconomicRoute = Array.isArray(model.accountIds)
      && model.accountIds.length === 0
      && model.economics !== undefined;
    if (
      !Array.isArray(model.accountIds)
      || (!accountlessEconomicRoute && model.accountIds.length === 0)
      || new Set(model.accountIds).size !== model.accountIds.length
      || model.accountIds.some((id) => !ID.test(id))
    ) errors.push({ field: `${path}.accountIds`, message: "must reference unique canonical account ids or be empty for an explicit economic route" });
    else for (const id of model.accountIds) {
      if (!accountIds.has(id)) errors.push({ field: `${path}.accountIds`, message: `references unknown account '${id}'` });
      else if (accountProviders.get(id) !== model.providerId) errors.push({ field: `${path}.accountIds`, message: `account '${id}' belongs to provider '${accountProviders.get(id)}', not '${model.providerId}'` });
    }
    if (!Array.isArray(model.capabilities) || model.capabilities.length === 0 || new Set(model.capabilities).size !== model.capabilities.length || model.capabilities.some((id) => !CAPABILITIES.has(id))) errors.push({ field: `${path}.capabilities`, message: "must contain unique supported capability ids" });
    else if (isDirectProviderId(model.providerId)) {
      const unsupported = model.capabilities.find((capability) => !PROVIDER_CAPABILITIES[model.providerId].has(capability));
      if (unsupported) errors.push({ field: `${path}.capabilities`, message: `provider '${model.providerId}' does not support capability '${unsupported}' through the model gateway` });
      else if (model.providerId !== "codex-oauth") {
        const modality = MODEL_CAPABILITIES.modalityCapabilities(model.providerId, model.providerModelId);
        const unsupportedByModel = model.capabilities.find((capability) =>
          (capability === "function-tools" && !MODEL_CAPABILITIES.supportsTools(model.providerId, model.providerModelId))
          || (capability === "input-image-url" && (!modality.inputModalities.includes("image") || !modality.constraints.supportsUrl))
          || (capability === "input-image-base64" && (!modality.inputModalities.includes("image") || !modality.constraints.supportsBase64)));
        if (unsupportedByModel) errors.push({ field: `${path}.capabilities`, message: `model '${model.providerModelId}' lacks capability '${unsupportedByModel}' evidence for provider '${model.providerId}'` });
      }
    }
    const affinity = model.affinity;
    if (!affinity || !["none", "prefer", "require"].includes(affinity.continuity)) errors.push({ field: `${path}.affinity.continuity`, message: "is invalid" });
    else if (affinity.continuity === "none" && (affinity.scope !== undefined || affinity.allowRebind !== undefined)) errors.push({ field: `${path}.affinity`, message: "scope and allowRebind require continuity" });
    else if (affinity.continuity !== "none" && !["session", "turn"].includes(affinity.scope ?? "")) errors.push({ field: `${path}.affinity.scope`, message: "must be session or turn" });
    if (affinity?.allowRebind === true && affinity.continuity !== "prefer" && affinity.continuity !== "require") errors.push({ field: `${path}.affinity.allowRebind`, message: "is not meaningful" });
    if (model.economics !== undefined) validateRouteEconomics(model.economics, path, errors);
  }
  if (!Array.isArray(value.virtualModels) || value.virtualModels.length === 0) errors.push({ field: "modelGateway.virtualModels", message: "must be non-empty" });
  for (const [index, principal] of (value.principals ?? []).entries()) for (const id of principal.virtualModelIds ?? []) if (!models.has(id)) errors.push({ field: `modelGateway.principals[${index}].virtualModelIds`, message: `references unknown virtual model '${id}'` });
}

const ECONOMIC_CLASS = new Set(["subscription", "included", "free", "metered", "unknown"]);
const POSTURE = new Set(["disabled", "committed"]);
const SHA_256 = /^sha256:[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function validateAccountEconomics(
  economics: ModelGatewayAccountEconomicsConfig,
  path: string,
  errors: GatewayValidationError[],
): void {
  if (!ID.test(economics.capacityIdentity ?? "")) errors.push({ field: `${path}.economics.capacityIdentity`, message: "must be a canonical id" });
  if (!ECONOMIC_CLASS.has(economics.subscriptionClass)) errors.push({ field: `${path}.economics.subscriptionClass`, message: "is invalid" });
  if (!ID.test(economics.quotaClassId ?? "")) errors.push({ field: `${path}.economics.quotaClassId`, message: "must be a canonical id" });
  if (!POSTURE.has(economics.creditPosture)) errors.push({ field: `${path}.economics.creditPosture`, message: "is invalid" });
  if (!POSTURE.has(economics.overagePosture)) errors.push({ field: `${path}.economics.overagePosture`, message: "is invalid" });
}

function validateRouteEconomics(
  economics: ModelGatewayRouteEconomicsConfig,
  path: string,
  errors: GatewayValidationError[],
): void {
  const economicPath = `${path}.economics`;
  for (const [field, value] of Object.entries({
    adapterCapabilityId: economics.adapterCapabilityId,
    adapterCapabilityVersion: economics.adapterCapabilityVersion,
    authBillingChannel: economics.authBillingChannel,
    executionMode: economics.executionMode,
    serviceTier: economics.serviceTier,
    rateCardBasis: economics.rateCardBasis,
    envelopeSemantics: economics.envelopeSemantics,
    contextClass: economics.contextClass,
    cacheClass: economics.cacheClass,
  })) {
    if (!ID.test(value ?? "")) errors.push({ field: `${economicPath}.${field}`, message: "must be a canonical id" });
  }
  if (!POSTURE.has(economics.fallbackPosture)) errors.push({ field: `${economicPath}.fallbackPosture`, message: "is invalid" });
  if (!POSTURE.has(economics.overagePosture)) errors.push({ field: `${economicPath}.overagePosture`, message: "is invalid" });
  validatePriceEvidence(economics.priceEvidence, economicPath, errors);
  validateUniqueAmounts(
    economics.executionEnvelope?.limits,
    `${economicPath}.executionEnvelope.limits`,
    errors,
    true,
  );
  const envelopeUsageUnits = new Set<string>();
  for (const [index, limit] of (economics.executionEnvelope?.limits ?? []).entries()) {
    if (limit.scheme?.kind !== "unit") {
      errors.push({ field: `${economicPath}.executionEnvelope.limits[${index}].scheme`, message: "must use the unit scheme" });
    } else {
      envelopeUsageUnits.add(limit.unit);
    }
  }
  if (economics.priceEvidence?.kind === "metered" || economics.priceEvidence?.kind === "estimated") {
    for (const [index, unitPrice] of economics.priceEvidence.unitPrices.entries()) {
      if (unitPrice.usageUnit !== unitPrice.price.unit) {
        errors.push({ field: `${economicPath}.priceEvidence.unitPrices[${index}].usageUnit`, message: "must equal price.unit" });
      }
      if (!envelopeUsageUnits.has(unitPrice.usageUnit)) {
        errors.push({ field: `${economicPath}.priceEvidence.unitPrices[${index}].usageUnit`, message: "must be covered by a unit-scheme execution envelope limit" });
      }
    }
  }
  const auxiliaryIds = new Set<string>();
  for (const [index, charge] of (economics.auxiliaryCharges ?? []).entries()) {
    if (!ID.test(charge.id ?? "") || auxiliaryIds.has(charge.id)) {
      errors.push({ field: `${economicPath}.auxiliaryCharges[${index}].id`, message: "must be a unique canonical id" });
    }
    auxiliaryIds.add(charge.id);
    validateAmount(charge.amount, `${economicPath}.auxiliaryCharges[${index}].amount`, errors);
  }
}

function validatePriceEvidence(
  price: ModelGatewayPriceEvidenceConfig,
  path: string,
  errors: GatewayValidationError[],
): void {
  const pricePath = `${path}.priceEvidence`;
  if (!price || !["subscription", "included", "free", "metered", "unknown", "estimated"].includes(price.kind)) {
    errors.push({ field: `${pricePath}.kind`, message: "is invalid" });
    return;
  }
  if (!ID.test(price.rateCardId ?? "")) errors.push({ field: `${pricePath}.rateCardId`, message: "must be a canonical id" });
  if (!ID.test(price.rateCardRevision ?? "")) errors.push({ field: `${pricePath}.rateCardRevision`, message: "must be a canonical id" });
  validateEconomicEvidence(price.evidence, `${pricePath}.evidence`, errors);
  if (price.kind === "included" && !ID.test(price.allowanceId ?? "")) errors.push({ field: `${pricePath}.allowanceId`, message: "must be a canonical id" });
  if (price.kind === "unknown" && (typeof price.reason !== "string" || price.reason.trim().length === 0)) errors.push({ field: `${pricePath}.reason`, message: "must be non-empty" });
  if (price.kind === "estimated" && !ID.test(price.estimationMethod ?? "")) errors.push({ field: `${pricePath}.estimationMethod`, message: "must be a canonical id" });
  if (price.kind === "metered" || price.kind === "estimated") {
    const usageUnits = new Set<string>();
    if (!Array.isArray(price.unitPrices) || price.unitPrices.length === 0) errors.push({ field: `${pricePath}.unitPrices`, message: "must be non-empty" });
    for (const [index, unitPrice] of (price.unitPrices ?? []).entries()) {
      if (!ID.test(unitPrice.usageUnit ?? "") || usageUnits.has(unitPrice.usageUnit)) errors.push({ field: `${pricePath}.unitPrices[${index}].usageUnit`, message: "must be a unique canonical id" });
      usageUnits.add(unitPrice.usageUnit);
      validateAmount(unitPrice.price, `${pricePath}.unitPrices[${index}].price`, errors);
    }
  }
}

function validateEconomicEvidence(
  evidence: ManagedEconomicEvidenceIdentity,
  path: string,
  errors: GatewayValidationError[],
): void {
  if (!evidence || !ID.test(evidence.sourceIdentity ?? "")) errors.push({ field: `${path}.sourceIdentity`, message: "must be a canonical id" });
  if (!evidence || !ID.test(evidence.sourceRevision ?? "")) errors.push({ field: `${path}.sourceRevision`, message: "must be a canonical id" });
  if (!evidence || !SHA_256.test(evidence.sourceDigest ?? "")) errors.push({ field: `${path}.sourceDigest`, message: "must be a canonical SHA-256 digest" });
  if (!evidence || !isCanonicalTimestamp(evidence.observedAt)) errors.push({ field: `${path}.observedAt`, message: "must be a canonical UTC timestamp" });
  if (!evidence || !isCanonicalTimestamp(evidence.validUntil)) errors.push({ field: `${path}.validUntil`, message: "must be a canonical UTC timestamp" });
  if (evidence && isCanonicalTimestamp(evidence.observedAt) && isCanonicalTimestamp(evidence.validUntil)
    && Date.parse(evidence.observedAt) >= Date.parse(evidence.validUntil)) errors.push({ field: `${path}.validUntil`, message: "must be after observedAt" });
  if (!evidence || !["high", "medium", "low"].includes(evidence.confidence)) errors.push({ field: `${path}.confidence`, message: "is invalid" });
  if (!evidence || !["provider-reported", "configured", "calculated-estimate"].includes(evidence.authority)) errors.push({ field: `${path}.authority`, message: "is invalid" });
}

function validateUniqueAmounts(
  amounts: readonly ManagedEconomicAmount[] | undefined,
  path: string,
  errors: GatewayValidationError[],
  required: boolean,
): void {
  if (!Array.isArray(amounts) || (required && amounts.length === 0)) {
    errors.push({ field: path, message: "must be non-empty" });
    return;
  }
  const units = new Set<string>();
  for (const [index, amount] of amounts.entries()) {
    validateAmount(amount, `${path}[${index}]`, errors);
    const key = `${amount.unit}\0${JSON.stringify(amount.scheme)}`;
    if (units.has(key)) errors.push({ field: `${path}[${index}]`, message: "duplicates an economic unit and scheme" });
    units.add(key);
  }
}

function validateAmount(amount: ManagedEconomicAmount, path: string, errors: GatewayValidationError[]): void {
  try {
    validateManagedEconomicAmount(amount);
  } catch (error) {
    errors.push({ field: path, message: error instanceof Error ? error.message : "is invalid" });
  }
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !UTC.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function bounded(value: number | undefined, min: number, max: number, field: string, errors: GatewayValidationError[], required = false): void {
  if (value === undefined && !required) return;
  if (!Number.isSafeInteger(value) || value! < min || value! > max) errors.push({ field, message: `must be an integer between ${min} and ${max}` });
}
