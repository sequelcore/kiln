import { stringify } from "yaml";
import { parseGatewayYaml, type ModelGatewayConfig } from "@kilnai/core";
import { KilnYamlError } from "../../../kiln-yaml.js";
import {
  type KilnEngineBilling,
  type KilnGlobalConfig,
} from "../../global-config-schema.js";
import { resolveGlobalConfigPath } from "../path.js";
import { isRecord } from "./shared.js";

export function resolveGlobalModelGatewayConfig(config: KilnGlobalConfig | null | undefined): ModelGatewayConfig {
  if (!config?.modelGateway) throw new KilnYamlError("Global config does not declare modelGateway.");
  return config.modelGateway;
}

export function validateGlobalModelGateway(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("modelGateway must be an object");
  const port = value.port === 4800 ? 4801 : 4800;
  try {
    parseGatewayYaml(
      stringify({ port, apps: [], modelGateway: value }),
      `${resolveGlobalConfigPath()}#modelGateway`,
    );
  } catch (error) {
    throw new KilnYamlError(`Invalid global modelGateway: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function validateEngines(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("engines must be an object");
  }
  for (const [engineId, engine] of Object.entries(value)) {
    if (!isRecord(engine)) {
      throw new KilnYamlError(`engines.${engineId} must be an object`);
    }
    if (engine.enabled !== undefined && typeof engine.enabled !== "boolean") {
      throw new KilnYamlError(`engines.${engineId}.enabled must be a boolean`);
    }
    if (engine.billing !== undefined && !isEngineBilling(engine.billing)) {
      throw new KilnYamlError(`engines.${engineId}.billing has an unknown billing mode`);
    }
  }
}

function isEngineBilling(value: unknown): value is KilnEngineBilling {
  return value === "subscription"
    || value === "plus-quota"
    || value === "free"
    || value === "api-key"
    || value === "local";
}
