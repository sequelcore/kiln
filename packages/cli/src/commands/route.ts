import {
  defaultGlobalConfig,
  mutateGlobalConfig,
  readGlobalConfig,
  readGlobalConfigSnapshot,
} from "../config/global-config.js";
import { readFileSync } from "node:fs";
import {
  projectGuiProviderModelDiscovery,
  resolveGuiOperatorDiscoveryResults,
} from "@kilnai/runtime";
import { projectAvailableModelDiagnostic } from "../application/available-model-diagnostic.js";
import { runRouteCreateCommand } from "../application/route-create-command.js";
import { createCurrentExecutionRoute } from "../application/current-execution-route-creation.js";
import { createOperatorExecutionRouteSelectionPort } from "../application/operator-execution-route-selection.js";
import { createDefaultRegistry, getRuntimeProviderAvailability } from "../wrapper/session-registry.js";
import {
  resolveEngineRoute,
  type EngineRouteContext,
} from "../engines/engine-registry.js";

export async function routeCommand(
  context: EngineRouteContext = {},
  args: readonly string[] = [],
): Promise<void> {
  if (args[0] === "available") {
    await routeAvailableModelsCommand();
    return;
  }
  if (args[0] === "create") {
    await routeCreateCommand(args.slice(1));
    return;
  }
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
}

export async function routeCreateCommand(args: readonly string[], input: {
  readonly readSource?: (path: string | undefined) => string;
  readonly create?: Parameters<typeof runRouteCreateCommand>[0]["create"];
} = {}): Promise<void> {
  const preview = args.includes("--preview");
  const path = args.find((arg) => !arg.startsWith("--"));
  const source = (input.readSource ?? ((candidate) => readFileSync(candidate ?? 0, "utf-8")))(path);
  const result = await runRouteCreateCommand({ source, preview, create: input.create ?? createRouteFromCurrentEvidence });
  console.log(JSON.stringify(result));
}

async function createRouteFromCurrentEvidence(request: import("@kilnai/gateway-contracts").ExecutionRouteCreationRequest, preview: boolean) {
  const resolve = async () => {
    const snapshot = readGlobalConfigSnapshot();
    if (!snapshot.config?.executionCatalog) throw new Error("Execution catalog is unavailable.");
    const { registry } = createDefaultRegistry();
    const discovery = projectGuiProviderModelDiscovery(await resolveGuiOperatorDiscoveryResults(getRuntimeProviderAvailability(registry)));
    const selection = createOperatorExecutionRouteSelectionPort({ readConfigSnapshot: () => snapshot, resolveAccountAvailability: async () => [] });
    const executionRouteCatalog = await selection.getCatalog();
    return { catalog: projectAvailableModelDiagnostic({ discovery, executionRouteCatalog }), executionCatalog: snapshot.config.executionCatalog, revision: snapshot.revision };
  };
  const initial = await resolve();
  const entry = initial.catalog.entries.find((candidate) => candidate.providerId === request.discoveryIdentity.providerId && candidate.providerRouteId === request.discoveryIdentity.providerRouteId && candidate.providerModelId === request.discoveryIdentity.providerModelId);
  if (!entry || entry.discoveryState !== "observed" || entry.eligibilityState !== "eligible" || initial.revision !== request.expectedRevision) throw new Error("Current route creation evidence is stale or unavailable.");
  if (preview) return { status: "previewed", revision: initial.revision };
  return createCurrentExecutionRoute({ request, admittedEvidence: { entry, catalogObservedAt: initial.catalog.observedAt }, resolveCurrentEvidence: resolve, mutateGlobalConfig, refreshExecutionRoutes: async () => { await resolve(); } });
}

export async function routeAvailableModelsCommand(input: {
  readonly readCatalog?: () => Promise<ReturnType<typeof projectAvailableModelDiagnostic>>;
} = {}): Promise<void> {
  try {
    const availableModels = await (input.readCatalog ?? readCurrentAvailableModels)();
    console.log("Available Models:");
    if (availableModels.entries.length === 0) {
      console.log("  none observed");
      return;
    }
    for (const entry of availableModels.entries) {
      console.log(`  ${entry.providerId}/${entry.providerModelId} [discovery=${entry.discoveryState}, eligibility=${entry.eligibilityState}, availability=${entry.availabilityState}, configured=${entry.configuredState}] ${entry.reasonCodes.join(",")}`);
    }
  } catch {
    console.log("Available Models: unavailable (current provider discovery failed)");
  }
}

async function readCurrentAvailableModels() {
  const config = readGlobalConfig() ?? defaultGlobalConfig();
  const executionRouteSelection = createOperatorExecutionRouteSelectionPort({
    readConfigSnapshot: () => ({ config, revision: `sha256:${"0".repeat(64)}` }),
    resolveAccountAvailability: async () => [],
  });
  const { registry } = createDefaultRegistry();
  const discovery = await resolveGuiOperatorDiscoveryResults(getRuntimeProviderAvailability(registry));
  return projectAvailableModelDiagnostic({
    discovery: projectGuiProviderModelDiscovery(discovery),
    executionRouteCatalog: await executionRouteSelection.getCatalog(),
  });
}
