// Gateway: AppResolver -- resolves GatewayConfig app bindings to loaded App composites

import { join } from "node:path";
import { parseAppYaml, KilnError } from "@kilnai/core";
import type { App, RuntimeModeConfig } from "@kilnai/core";
import type { GatewayAppBinding } from "@kilnai/core";
import type { GatewayConfigurationSource } from "./gateway-configuration-source.js";
import { resolveRuntimeStoreRoot } from "../kiln-home.js";

export interface ResolvedApp {
  readonly name: string;
  readonly app: App;
  readonly binding: GatewayAppBinding;
  readonly memoryBasePath: string;
  readonly runtimeModeConfig?: RuntimeModeConfig;
}

export interface ResolveAppsOptions {
  /** Canonical operator Kiln home supplied by CLI composition. */
  readonly kilnHome?: string;
}

export function resolveApps(
  source: GatewayConfigurationSource,
  options: ResolveAppsOptions = {},
): ResolvedApp[] {
  const gatewayMemoryRoot = resolveRuntimeStoreRoot(options, "gateway");
  return source.apps.map(({ binding, bytes: content, path: configPath }) => {
    let app: App;
    try {
      app = parseAppYaml(content, configPath);
    } catch (err) {
      throw new KilnError(
        "CONFIG_INVALID",
        `Failed to parse App config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
        { context: { configPath }, cause: err },
      );
    }

    const memoryBasePath = join(gatewayMemoryRoot, binding.name);

    return {
      name: binding.name,
      app,
      binding,
      memoryBasePath,
      ...(app.runtimeModeConfig ? { runtimeModeConfig: app.runtimeModeConfig } : {}),
    };
  });
}
