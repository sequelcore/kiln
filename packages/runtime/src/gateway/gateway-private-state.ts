import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveRuntimeKilnHome } from "../kiln-home.js";

const GATEWAY_STATE_IDENTITY_DOMAIN = "kiln:gateway-config:v1\0";

export interface GatewayPrivateStatePaths {
  readonly gatewayStateId: `kgs_${string}`;
  readonly root: string;
  readonly secretsPath: string;
  readonly modelGatewayDatabasePath: string;
}

/** Resolve mutable gateway state outside the configuration directory. */
export function resolveGatewayPrivateState(
  configPath: string,
  options: { readonly privateStateRoot?: string; readonly kilnHome?: string } = {},
): GatewayPrivateStatePaths {
  const canonicalConfigPath = realpathSync(configPath);
  if (!lstatSync(canonicalConfigPath).isFile()) {
    throw new Error(`Gateway configuration is not a file: ${configPath}`);
  }
  const gatewayStateId = `kgs_${createHash("sha256")
    .update(GATEWAY_STATE_IDENTITY_DOMAIN, "utf8")
    .update(normalizeIdentityPath(canonicalConfigPath), "utf8")
    .digest("hex")}` as const;
  const root = options.privateStateRoot === undefined
    ? join(resolve(resolveRuntimeKilnHome(options.kilnHome)), "gateway", "configurations", gatewayStateId)
    : resolve(options.privateStateRoot);
  return {
    gatewayStateId,
    root,
    secretsPath: join(root, "secrets.json"),
    modelGatewayDatabasePath: join(root, "model-gateway.sqlite"),
  };
}

function normalizeIdentityPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
