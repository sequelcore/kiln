// Gateway: AppResolver -- resolves GatewayConfig app bindings to loaded App composites

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseAppYaml, parseRuntimeModeConfig, KilnError } from "@kilnai/core";
import type { App, RuntimeModeConfig } from "@kilnai/core";
import type { GatewayConfig, GatewayAppBinding } from "@kilnai/core";

export interface ResolvedApp {
  readonly name: string;
  readonly app: App;
  readonly binding: GatewayAppBinding;
  readonly memoryBasePath: string;
  readonly runtimeModeConfig?: RuntimeModeConfig;
}

export function resolveApps(config: GatewayConfig, gatewayYamlDir: string): ResolvedApp[] {
  return config.apps.map((binding) => {
    const configPath = join(gatewayYamlDir, binding.config);

    let content: string;
    try {
      content = readFileSync(configPath, "utf-8");
    } catch {
      throw new KilnError("CONFIG_INVALID", `Failed to load App config at ${binding.config}: file not found`, {
        context: { configPath: binding.config },
      });
    }

    let app: App;
    try {
      app = parseAppYaml(content);
    } catch (err) {
      throw new KilnError(
        "CONFIG_INVALID",
        `Failed to parse App config at ${binding.config}: ${err instanceof Error ? err.message : String(err)}`,
        { context: { configPath: binding.config }, cause: err },
      );
    }

    const memoryBasePath = join(homedir(), ".kiln", "gateway", binding.name);

    let runtimeModeConfig: RuntimeModeConfig | undefined;
    try {
      runtimeModeConfig = parseRuntimeModeConfig(content) ?? undefined;
    } catch {
      // Runtime-mode parse failure is non-fatal: app may be using the subprocess runtime
    }

    return { name: binding.name, app, binding, memoryBasePath, runtimeModeConfig };
  });
}
