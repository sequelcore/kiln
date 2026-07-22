// Engine type: GatewayConfig -- multi-app gateway configuration
// Declares which Apps to host and how they bind to channels

import type { ObservabilityConfig } from "./observability-config.js";
import type { GatewayAuthConfig } from "./auth-config.js";
import type { GatewayMcpConfig } from "./mcp-config.js";

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
  readonly tenantId: string;
  readonly applicationId: string;
  readonly callerId: string;
  readonly capabilityId: string;
  readonly scopes: readonly string[];
  readonly budgetEvidenceId: string;
  readonly virtualModelIds: readonly string[];
}

export interface ModelGatewayVirtualModelConfig {
  readonly id: string;
  readonly providerId: "codex-oauth";
  readonly providerModelId: string;
  readonly accountIds: readonly string[];
  readonly capabilities: readonly ModelGatewayCapabilityId[];
  readonly affinity: {
    readonly continuity: "none" | "prefer" | "require";
    readonly scope?: "session" | "turn";
    readonly allowRebind?: boolean;
  };
}

export interface ModelGatewayAccountConfig {
  readonly id: string;
  readonly providerId: "codex-oauth";
  readonly credentialId: string;
  readonly maxConcurrency: number;
  readonly reservedAffinitySlots: number;
}

export interface ModelGatewayConfig {
  readonly port: number;
  readonly accounts: readonly ModelGatewayAccountConfig[];
  readonly openAIResponses: {
    readonly enabled: boolean;
    readonly maxBodyBytes: number;
    readonly maxConcurrentRequests: number;
    readonly replay: { readonly ttlMs: number; readonly maxEntries: number; readonly hmacKeyEnv: string };
    readonly principals: readonly ModelGatewayPrincipalConfig[];
    readonly virtualModels: readonly ModelGatewayVirtualModelConfig[];
  };
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
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const ENV = /^[A-Z_][A-Z0-9_]*$/;

function validateModelGateway(value: ModelGatewayConfig, gatewayPort: number, errors: GatewayValidationError[]): void {
  if (!Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535 || value.port === gatewayPort) errors.push({ field: "modelGateway.port", message: "must be a distinct integer port between 1 and 65535" });
  const accountIds = new Set<string>();
  const bindings = new Set<string>();
  for (const [index, account] of (value.accounts ?? []).entries()) {
    const path = `modelGateway.accounts[${index}]`;
    if (!ID.test(account.id ?? "") || accountIds.has(account.id)) errors.push({ field: `${path}.id`, message: "must be a unique canonical id" }); else accountIds.add(account.id);
    if (account.providerId !== "codex-oauth") errors.push({ field: `${path}.providerId`, message: "must be codex-oauth" });
    if (!ID.test(account.credentialId ?? "")) errors.push({ field: `${path}.credentialId`, message: "must be a canonical id" });
    const binding = `${account.providerId}:${account.credentialId}`;
    if (bindings.has(binding)) errors.push({ field: `${path}.credentialId`, message: "provider credential binding must be unique" }); else bindings.add(binding);
    if (!Number.isSafeInteger(account.maxConcurrency) || account.maxConcurrency < 1 || account.maxConcurrency > 1024) errors.push({ field: `${path}.maxConcurrency`, message: "must be an integer between 1 and 1024" });
    if (!Number.isSafeInteger(account.reservedAffinitySlots) || account.reservedAffinitySlots < 0 || account.reservedAffinitySlots > account.maxConcurrency) errors.push({ field: `${path}.reservedAffinitySlots`, message: "must be between 0 and maxConcurrency" });
  }
  if (!Array.isArray(value.accounts) || value.accounts.length === 0) errors.push({ field: "modelGateway.accounts", message: "must be non-empty" });
  const surface = value.openAIResponses;
  if (!surface || typeof surface !== "object") { errors.push({ field: "modelGateway.openAIResponses", message: "must be an object" }); return; }
  if (surface.enabled !== true) errors.push({ field: "modelGateway.openAIResponses.enabled", message: "must be true when configured" });
  bounded(surface.maxBodyBytes, 1, 64 * 1024 * 1024, "maxBodyBytes", errors, true);
  bounded(surface.maxConcurrentRequests, 1, 1024, "maxConcurrentRequests", errors, true);
  if (!surface.replay || !ENV.test(surface.replay.hmacKeyEnv ?? "")) errors.push({ field: "modelGateway.openAIResponses.replay.hmacKeyEnv", message: "must be a canonical environment variable name" });
  bounded(surface.replay?.ttlMs, 1, 86_400_000, "replay.ttlMs", errors, true);
  bounded(surface.replay?.maxEntries, 1, 1_000_000, "replay.maxEntries", errors, true);
  const tokens = new Set<string>();
  const principalIdentities = new Set<string>();
  for (const [index, principal] of (surface.principals ?? []).entries()) {
    const path = `modelGateway.openAIResponses.principals[${index}]`;
    for (const [field, id] of Object.entries({ tenantId: principal.tenantId, applicationId: principal.applicationId, callerId: principal.callerId, capabilityId: principal.capabilityId, budgetEvidenceId: principal.budgetEvidenceId })) if (!ID.test(id ?? "")) errors.push({ field: `${path}.${field}`, message: "must be a canonical id" });
    if (!ENV.test(principal.tokenEnv ?? "")) errors.push({ field: `${path}.tokenEnv`, message: "must be a canonical environment variable name" });
    else if (tokens.has(principal.tokenEnv)) errors.push({ field: `${path}.tokenEnv`, message: "must be unique" }); else tokens.add(principal.tokenEnv);
    if (!Array.isArray(principal.scopes) || !principal.scopes.includes("model.invoke") || new Set(principal.scopes).size !== principal.scopes.length || principal.scopes.some((scope) => !ID.test(scope))) errors.push({ field: `${path}.scopes`, message: "must contain unique canonical scopes including model.invoke" });
    if (!Array.isArray(principal.virtualModelIds) || principal.virtualModelIds.length === 0 || new Set(principal.virtualModelIds).size !== principal.virtualModelIds.length || principal.virtualModelIds.some((id) => !ID.test(id))) errors.push({ field: `${path}.virtualModelIds`, message: "must contain unique canonical model ids" });
    const identity = [principal.tenantId, principal.applicationId, principal.callerId].join("\0");
    if (principalIdentities.has(identity)) errors.push({ field: path, message: "trusted principal identity must be unique" }); else principalIdentities.add(identity);
  }
  if (!Array.isArray(surface.principals) || surface.principals.length === 0) errors.push({ field: "modelGateway.openAIResponses.principals", message: "must be non-empty" });
  const models = new Set<string>();
  for (const [index, model] of (surface.virtualModels ?? []).entries()) {
    const path = `modelGateway.openAIResponses.virtualModels[${index}]`;
    if (!ID.test(model.id ?? "") || models.has(model.id)) errors.push({ field: `${path}.id`, message: "must be a unique canonical id" }); else models.add(model.id);
    if (model.providerId !== "codex-oauth") errors.push({ field: `${path}.providerId`, message: "must be codex-oauth" });
    if (!ID.test(model.providerModelId ?? "")) errors.push({ field: `${path}.providerModelId`, message: "must be a canonical id" });
    if (!Array.isArray(model.accountIds) || model.accountIds.length !== 1 || new Set(model.accountIds).size !== model.accountIds.length || model.accountIds.some((id) => !ID.test(id))) errors.push({ field: `${path}.accountIds`, message: "codex-oauth virtual models must reference exactly one canonical account id" });
    else for (const id of model.accountIds) if (!accountIds.has(id)) errors.push({ field: `${path}.accountIds`, message: `references unknown account '${id}'` });
    if (!Array.isArray(model.capabilities) || model.capabilities.length === 0 || new Set(model.capabilities).size !== model.capabilities.length || model.capabilities.some((id) => !CAPABILITIES.has(id))) errors.push({ field: `${path}.capabilities`, message: "must contain unique supported capability ids" });
    const affinity = model.affinity;
    if (!affinity || !["none", "prefer", "require"].includes(affinity.continuity)) errors.push({ field: `${path}.affinity.continuity`, message: "is invalid" });
    else if (affinity.continuity === "none" && (affinity.scope !== undefined || affinity.allowRebind !== undefined)) errors.push({ field: `${path}.affinity`, message: "scope and allowRebind require continuity" });
    else if (affinity.continuity !== "none" && !["session", "turn"].includes(affinity.scope ?? "")) errors.push({ field: `${path}.affinity.scope`, message: "must be session or turn" });
    if (affinity?.allowRebind === true && affinity.continuity !== "prefer" && affinity.continuity !== "require") errors.push({ field: `${path}.affinity.allowRebind`, message: "is not meaningful" });
  }
  if (!Array.isArray(surface.virtualModels) || surface.virtualModels.length === 0) errors.push({ field: "modelGateway.openAIResponses.virtualModels", message: "must be non-empty" });
  for (const [index, principal] of (surface.principals ?? []).entries()) for (const id of principal.virtualModelIds ?? []) if (!models.has(id)) errors.push({ field: `modelGateway.openAIResponses.principals[${index}].virtualModelIds`, message: `references unknown virtual model '${id}'` });
}

function bounded(value: number | undefined, min: number, max: number, field: string, errors: GatewayValidationError[], required = false): void {
  if (value === undefined && !required) return;
  if (!Number.isSafeInteger(value) || value! < min || value! > max) errors.push({ field: `modelGateway.openAIResponses.${field}`, message: `must be an integer between ${min} and ${max}` });
}
