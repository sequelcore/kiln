import {
  defaultGlobalConfig,
  readGlobalConfig,
} from "../config/global-config.js";
import {
  resolveEngineRoute,
  type EngineRouteContext,
} from "../engines/engine-registry.js";

export function routeCommand(context: EngineRouteContext = {}): void {
  const config = readGlobalConfig() ?? defaultGlobalConfig();
  const route = resolveEngineRoute(config, context);

  console.log(`Resolved worker: ${route.worker ?? "—"}`);
  console.log(`Reason:          ${route.reason}`);
  if (route.defaultWorker) {
    console.log(`Default worker:  ${route.defaultWorker}`);
  }
  if (route.fallback) {
    console.log(`Fallback:        ${route.fallback}`);
  }
  if (route.budget) {
    console.log(`Budget used:     ${route.budget.tokensUsed}`);
    console.log(`Budget ceiling:  ${route.budget.ceiling ?? "unbounded"}`);
  }
}
