import { readFileSync } from "node:fs";
import {
  defaultGlobalConfig,
  mutateGlobalConfig,
  projectDirectExecutionCatalog,
  readGlobalConfig,
  readGlobalConfigSnapshot,
} from "../config/global-config.js";
import {
  projectGuiProviderModelDiscovery,
  resolveGuiOperatorDiscoveryResults,
} from "@kilnai/runtime";
import { projectAvailableModelDiagnostic } from "../application/available-model-diagnostic.js";
import { runRouteCreateCommand } from "../application/route-create-command.js";
import { createCurrentExecutionRoute } from "../application/current-execution-route-creation.js";
import { createOperatorExecutionRouteSelectionPort } from "../application/operator-execution-route-selection.js";
import { createDefaultRegistry, getRuntimeProviderAvailability } from "../wrapper/session-registry.js";

export async function targetCommand(args: readonly string[] = []): Promise<void> {
  if (args[0] === "available") {
    await targetAvailableModelsCommand();
    return;
  }
  if (args[0] === "create") {
    await targetCreateCommand(args.slice(1));
    return;
  }
  if (args[0] === "select") {
    selectTarget(args[1]);
    return;
  }
  const config = readGlobalConfig() ?? defaultGlobalConfig();
  const targets = config.targetCatalog?.targets ?? [];
  console.log("Execution Targets:");
  if (targets.length === 0) {
    console.log("  none configured");
    return;
  }
  for (const target of targets) {
    const selected = config.targetRouting?.defaultTargetId === target.id ? " *" : "";
    console.log(`  ${target.id} [${target.kind}] ${target.providerId}/${target.providerModelId}${selected}`);
  }
}

function selectTarget(targetId: string | undefined): void {
  const id = targetId?.trim();
  if (!id) throw new Error("target select requires one target id.");
  mutateGlobalConfig((current) => {
    const target = current?.targetCatalog?.targets.find((candidate) => candidate.id === id);
    if (!current || !target) throw new Error(`Execution target '${id}' is not configured.`);
    if (target.kind !== "direct") throw new Error(`Execution target '${id}' is not a direct operator target.`);
    return {
      ...current,
      targetRouting: { defaultTargetId: id },
      ui: { ...current.ui, targetSelection: { targetId: id } },
    };
  });
  console.log(`Selected execution target: ${id}`);
}

export async function targetCreateCommand(args: readonly string[], input: {
  readonly readSource?: (path: string | undefined) => string;
  readonly create?: Parameters<typeof runRouteCreateCommand>[0]["create"];
} = {}): Promise<void> {
  const preview = args.includes("--preview");
  const path = args.find((arg) => !arg.startsWith("--"));
  const source = (input.readSource ?? ((candidate) => readFileSync(candidate ?? 0, "utf-8")))(path);
  const result = await runRouteCreateCommand({ source, preview, create: input.create ?? createTargetFromCurrentEvidence });
  console.log(JSON.stringify(result));
}

async function createTargetFromCurrentEvidence(request: import("@kilnai/gateway-contracts").ExecutionRouteCreationRequest, preview: boolean) {
  const resolve = async () => {
    const snapshot = readGlobalConfigSnapshot();
    const executionCatalog = projectDirectExecutionCatalog(snapshot.config);
    if (!executionCatalog) throw new Error("Direct target catalog is unavailable.");
    const { registry } = createDefaultRegistry();
    const discovery = projectGuiProviderModelDiscovery(await resolveGuiOperatorDiscoveryResults(getRuntimeProviderAvailability(registry)));
    const selection = createOperatorExecutionRouteSelectionPort({ readConfigSnapshot: () => snapshot, resolveAccountAvailability: async () => [] });
    const executionRouteCatalog = await selection.getCatalog();
    return { catalog: projectAvailableModelDiagnostic({ discovery, executionRouteCatalog }), executionCatalog, revision: snapshot.revision };
  };
  const initial = await resolve();
  const entry = initial.catalog.entries.find((candidate) => candidate.providerId === request.discoveryIdentity.providerId && candidate.providerRouteId === request.discoveryIdentity.providerRouteId && candidate.providerModelId === request.discoveryIdentity.providerModelId);
  if (!entry || entry.discoveryState !== "observed" || entry.eligibilityState !== "eligible" || initial.revision !== request.expectedRevision) throw new Error("Current target creation evidence is stale or unavailable.");
  if (preview) return { status: "previewed", revision: initial.revision };
  return createCurrentExecutionRoute({ request, admittedEvidence: { entry, catalogObservedAt: initial.catalog.observedAt }, resolveCurrentEvidence: resolve, mutateGlobalConfig, refreshExecutionRoutes: async () => { await resolve(); } });
}

export async function targetAvailableModelsCommand(input: {
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
