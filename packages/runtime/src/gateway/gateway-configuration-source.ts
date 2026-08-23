import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  KilnError,
  parseGatewayYaml,
  type GatewayAppBinding,
  type GatewayConfig,
} from "@kilnai/core";

export type GatewayConfigurationRevision = `sha256:${string}`;

export interface GatewayConfigurationTextSource {
  readonly path: string;
  readonly bytes: string;
}

export interface GatewayAppConfigurationSource extends GatewayConfigurationTextSource {
  readonly name: string;
  readonly binding: GatewayAppBinding;
}

export interface GatewayConfigurationSource {
  readonly config: GatewayConfig;
  readonly gateway: GatewayConfigurationTextSource;
  readonly apps: readonly GatewayAppConfigurationSource[];
  readonly configurationRevision: GatewayConfigurationRevision;
}

/** Reads and admits one exact gateway-plus-app source snapshot. */
export function readGatewayConfigurationSource(configPath: string): GatewayConfigurationSource {
  const resolvedConfigPath = resolve(configPath);
  const gatewayBytes = readConfigurationFile(resolvedConfigPath, "Gateway");
  const config = parseGatewayYaml(gatewayBytes, resolvedConfigPath);
  const sourceDirectory = dirname(resolvedConfigPath);
  const apps = config.apps.map((binding): GatewayAppConfigurationSource => {
    const path = resolve(sourceDirectory, binding.config);
    return {
      name: binding.name,
      binding,
      path,
      bytes: readConfigurationFile(path, `App '${binding.name}'`),
    };
  });

  return {
    config,
    gateway: { path: resolvedConfigPath, bytes: gatewayBytes },
    apps,
    configurationRevision: calculateGatewayConfigurationRevision(gatewayBytes, apps),
  };
}

function readConfigurationFile(path: string, owner: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new KilnError("CONFIG_INVALID", `${owner} configuration file not found: ${path}`, {
      context: { path },
      cause: error,
      retryable: false,
    });
  }
}

function calculateGatewayConfigurationRevision(
  gatewayBytes: string,
  apps: readonly GatewayAppConfigurationSource[],
): GatewayConfigurationRevision {
  const hash = createHash("sha256");
  updateRevisionPart(hash, "gateway", gatewayBytes);
  for (const app of apps) updateRevisionPart(hash, `app:${app.name}`, app.bytes);
  return `sha256:${hash.digest("hex")}`;
}

function updateRevisionPart(
  hash: ReturnType<typeof createHash>,
  logicalOwner: string,
  bytes: string,
): void {
  const ownerBytes = Buffer.from(logicalOwner, "utf8");
  const contentBytes = Buffer.from(bytes, "utf8");
  hash.update(uint64(ownerBytes.byteLength));
  hash.update(ownerBytes);
  hash.update(uint64(contentBytes.byteLength));
  hash.update(contentBytes);
}

function uint64(value: number): Buffer {
  const encoded = Buffer.allocUnsafe(8);
  encoded.writeBigUInt64BE(BigInt(value));
  return encoded;
}
