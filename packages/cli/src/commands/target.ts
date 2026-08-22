import readline from "node:readline";
import {
  defaultGlobalConfig,
  readGlobalConfig,
  readGlobalConfigSnapshot,
  readGlobalExecutionTargetAuthority,
} from "../config/global-config.js";
import {
  executionTargetWizardDiscoveryEvidence,
  projectGuiProviderModelDiscovery,
  resolveGuiOperatorDiscoveryResults,
} from "@kilnai/runtime";
import type {
  AvailableModelCatalog,
  AvailableModelCatalogEntry,
  ExecutionTargetWizardProposal,
  ExecutionTargetWizardRequest,
  ExecutionTargetWizardResult,
  GuiProviderModelDiscoveryProjection,
} from "@kilnai/gateway-contracts";
import type {
  ExecutionTargetCatalogIntent,
  ExecutionTargetEvidenceSnapshot,
} from "../config/execution-target-evidence-store.js";
import { projectAvailableModelDiagnostic } from "../application/available-model-diagnostic.js";
import { runExecutionTargetWizardCommand } from "../application/execution-target-wizard-command.js";
import { createCurrentExecutionRoute } from "../application/current-execution-route-creation.js";
import { createOperatorExecutionRouteSelectionPort } from "../application/operator-execution-route-selection.js";
import { createDefaultRegistry, getRuntimeProviderAvailability } from "../wrapper/session-registry.js";
import { applyConfigMutation, approveConfigMutation, proposeConfigMutation } from "../application/config-mutation-authority.js";
import { ConfigMutationStore } from "../application/config-mutation-store.js";

type TargetClassification = "public" | "internal" | "confidential" | "restricted";

interface TargetWizardReadContext {
  readonly catalog: AvailableModelCatalog;
  readonly revision: string;
  readonly discovery: GuiProviderModelDiscoveryProjection;
  readonly executionCatalog: NonNullable<ReturnType<typeof readGlobalExecutionTargetAuthority>>["executionCatalog"];
  readonly targetIntent: ExecutionTargetCatalogIntent;
  readonly targetEvidence: ExecutionTargetEvidenceSnapshot;
}

interface TargetCreateCommandInput {
  readonly readCurrent?: () => Promise<Pick<TargetWizardReadContext, "catalog" | "revision">>;
  readonly create?: (request: ExecutionTargetWizardRequest) => Promise<ExecutionTargetWizardResult>;
  readonly requestId?: () => string;
  /** Test/runtime injection; production uses an interactive terminal and fails closed otherwise. */
  readonly confirm?: (proposal: ExecutionTargetWizardProposal) => Promise<boolean> | boolean;
}

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
    await selectTarget(args[1], args.includes("--approve"));
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

async function selectTarget(targetId: string | undefined, operatorApproved: boolean): Promise<void> {
  const id = targetId?.trim();
  if (!id) throw new Error("target select requires one target id.");
  const projectPath = process.cwd();
  const record = proposeConfigMutation({
    projectPath,
    operation: "target.select",
    payload: { targetId: id },
  });
  if (record.proposal.status !== "valid") {
    throw new Error(record.proposal.diagnostics.map((entry) => entry.message).join("; "));
  }
  if (record.proposal.approvalRequired && !operatorApproved) {
    throw new Error("Target selection changes execution authority. Review the proposal and repeat with --approve.");
  }
  new ConfigMutationStore(projectPath).saveProposal(record);
  const approval = record.proposal.approvalRequired
    ? approveConfigMutation({ projectPath, proposalId: record.proposal.proposalId, surface: "cli" })
    : undefined;
  const result = await applyConfigMutation({
    projectPath,
    proposalId: record.proposal.proposalId,
    ...(approval ? { approvalId: approval.approvalId } : {}),
    requester: "operator",
  });
  if (result.settlement.outcome === "rejected") {
    throw new Error(result.settlement.diagnostics.map((entry) => entry.message).join("; "));
  }
  console.log(`Selected execution target: ${id}`);
}

export async function targetCreateCommand(args: readonly string[], input: TargetCreateCommandInput = {}): Promise<void> {
  const options = parseTargetCreateArguments(args);
  const current = await (input.readCurrent ?? readCurrentTargetWizardContext)();
  const selected = selectCurrentAvailableModel(current.catalog, options.selector);
  const requestBase = {
    requestId: input.requestId?.() ?? `target-wizard-${Date.now()}`,
    expectedRevision: current.revision,
    discoveryIdentity: {
      providerId: selected.providerId,
      providerRouteId: selected.providerRouteId,
      providerModelId: selected.providerModelId,
    },
    ...(options.label ? { label: options.label } : {}),
    dataClassification: options.classification,
    dataPolicyConfirmed: true as const,
  };
  const create = input.create ?? ((request: ExecutionTargetWizardRequest) => createTargetFromCurrentEvidence(request));
  const previewRequest: ExecutionTargetWizardRequest = { ...requestBase, action: "preview" };
  let result = await runExecutionTargetWizardCommand({ request: previewRequest, create });
  if (options.approve && result.status === "previewed") {
    console.log(formatTargetWizardResult(result, { awaitingConfirmation: true }));
    const confirmed = await (input.confirm ?? confirmTargetWizardProposal)(result.proposal);
    if (!confirmed) {
      console.log("Execution target creation was not applied: interactive confirmation was declined or unavailable.");
      return;
    }
    result = await runExecutionTargetWizardCommand({
      request: {
        ...requestBase,
        action: "apply",
        proposalId: result.proposal.proposalId,
        operatorApproved: true,
      },
      create,
    });
  }
  console.log(formatTargetWizardResult(result));
}

function formatTargetWizardResult(result: ExecutionTargetWizardResult, options: { readonly awaitingConfirmation?: boolean } = {}): string {
  const lines: string[] = [`Execution target ${result.status}:`];
  const proposal = "proposal" in result ? result.proposal : undefined;
  if (proposal) lines.push(...formatTargetProposal(proposal));
  lines.push(`  message: ${result.message}`);
  if (result.status === "rejected") {
    lines.push(`  next: ${targetWizardActionMessage(result.action)}`);
  } else if (result.status === "previewed") {
    lines.push(options.awaitingConfirmation
      ? "  next: confirm the exact proposal above to apply it."
      : "  next: repeat with --approve to apply this reviewed proposal.");
  } else if (result.status === "committed-refresh-failed") {
    lines.push("  next: refresh current evidence before taking any further create action; do not retry blindly.");
  } else {
    lines.push("  next: use the target in the next session after the reported activation point.");
  }
  return lines.join("\n");
}

async function confirmTargetWizardProposal(_proposal: ExecutionTargetWizardProposal): Promise<boolean> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) return false;
  process.stdout.write("Apply this exact target proposal? [y/N]: ");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    let settled = false;
    rl.once("line", (line) => {
      settled = true;
      resolve(line);
    });
    rl.once("close", () => {
      if (!settled) resolve("");
    });
  });
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

function formatTargetProposal(proposal: ExecutionTargetWizardProposal): readonly string[] {
  const target = proposal.target;
  return [
    `  model: ${target.providerId}/${target.providerModelId}`,
    `  label: ${target.label}`,
    `  classification: ${target.dataClassification}`,
    `  account selection: ${target.accountSelectionMode}`,
    `  billing: ${target.billingClass}`,
    `  capability: ${target.capabilityPosture}`,
    `  authority: ${proposal.authorityImpact}; activation: ${proposal.activation}; approval: ${proposal.approvalStatus}`,
    `  evidence expires: ${target.evidenceExpiresAt}`,
  ];
}

function targetWizardActionMessage(action: Extract<ExecutionTargetWizardResult, { readonly status: "rejected" }>["action"]): string {
  switch (action) {
    case "select-current-model":
      return "run kiln target available and choose one current observed, eligible model.";
    case "configure-account":
      return "configure exactly one same-provider account or automatic account policy, then retry.";
    case "review-data-policy":
      return "review and explicitly confirm the governed data policy, then retry.";
    case "review-economics":
      return "review provider capability and account economics, then retry.";
    case "refresh-catalog":
      return "refresh current model and route evidence before retrying.";
    case "refresh-and-retry":
      return "refresh current model/configuration evidence and retry.";
    default:
      return "review the rejection and retry only after the reported condition is resolved.";
  }
}

function parseTargetCreateArguments(args: readonly string[]): {
  readonly selector: string;
  readonly classification: TargetClassification;
  readonly label?: string;
  readonly approve: boolean;
} {
  let selector: string | undefined;
  let classification: TargetClassification | undefined;
  let label: string | undefined;
  let confirmDataPolicy = false;
  let approve = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("--")) {
      if (selector !== undefined) throw new Error("target create accepts exactly one provider/model selector.");
      selector = argument;
      continue;
    }
    if (argument === "--approve") {
      if (approve) throw new Error("target create received --approve more than once.");
      approve = true;
      continue;
    }
    if (argument === "--confirm-data-policy") {
      if (confirmDataPolicy) throw new Error("target create received --confirm-data-policy more than once.");
      confirmDataPolicy = true;
      continue;
    }
    if (argument === "--classification" || argument === "--label") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--label") {
        if (label !== undefined) throw new Error("target create received --label more than once.");
        label = value.trim();
        if (!label) throw new Error("--label requires non-empty text.");
      } else {
        if (classification !== undefined) throw new Error("target create received --classification more than once.");
        if (!["public", "internal", "confidential", "restricted"].includes(value)) {
          throw new Error("--classification must be public, internal, confidential, or restricted.");
        }
        classification = value as TargetClassification;
      }
      continue;
    }
    throw new Error(`Unknown target create flag '${argument}'.`);
  }
  if (!selector) throw new Error("target create requires a provider/model selector.");
  if (!classification) throw new Error("target create requires --classification.");
  if (!confirmDataPolicy) {
    throw new Error("target create requires --confirm-data-policy (service operation; training may be permitted; retention up to 3650 days).");
  }
  return { selector, classification, ...(label ? { label } : {}), approve };
}

function selectCurrentAvailableModel(catalog: AvailableModelCatalog, selector: string): AvailableModelCatalogEntry {
  const slash = selector.indexOf("/");
  if (slash <= 0 || slash === selector.length - 1) {
    throw new Error("target create selector must be provider/model; model names may contain additional '/'.");
  }
  const providerId = selector.slice(0, slash);
  const providerModelId = selector.slice(slash + 1);
  const matches = catalog.entries.filter((entry) => entry.providerId === providerId && entry.providerModelId === providerModelId);
  const eligible = matches.filter((entry) => entry.discoveryState === "observed" && entry.eligibilityState === "eligible");
  if (eligible.length > 1) throw new Error(`Available Models selector '${selector}' is ambiguous; refresh and choose one current route.`);
  if (eligible.length === 0) throw new Error(`No current observed and eligible Available Models entry matches '${selector}'; run 'kiln target available' and refresh.`);
  return eligible[0]!;
}

async function resolveTargetWizardDiscoveryEvidence(
  request: ExecutionTargetWizardRequest,
): Promise<ReturnType<typeof executionTargetWizardDiscoveryEvidence>> {
  const initial = await readCurrentTargetWizardContext();
  const entry = selectExactCurrentAvailableModel(initial.catalog, request.discoveryIdentity);
  return executionTargetWizardDiscoveryEvidence(initial.discovery, entry);
}

async function createTargetFromCurrentEvidence(
  request: ExecutionTargetWizardRequest,
  invocationEvidence?: ReturnType<typeof executionTargetWizardDiscoveryEvidence>,
): Promise<ExecutionTargetWizardResult> {
  try {
    const admittedEvidence = invocationEvidence ?? await resolveTargetWizardDiscoveryEvidence(request);
    return await createCurrentExecutionRoute({
      request,
      admittedEvidence,
      projectPath: process.cwd(),
      approvalSurface: "cli",
      resolveCurrentEvidence: async () => {
        const current = await readCurrentTargetWizardContext();
        return {
          catalog: current.catalog,
          executionCatalog: current.executionCatalog,
          targetIntent: current.targetIntent,
          targetEvidence: current.targetEvidence,
          revision: current.revision,
          discoveryEvidence: executionTargetWizardDiscoveryEvidence(
            current.discovery,
            selectExactCurrentAvailableModel(current.catalog, request.discoveryIdentity),
          ),
        };
      },
    });
  } catch {
    return {
      type: "execution_target_wizard_result",
      requestId: request.requestId,
      status: "rejected",
      code: "TARGET_CREATE_REJECTED",
      action: "refresh-and-retry",
      message: "Execution target creation was rejected; refresh current evidence and retry.",
    };
  }
}

function selectExactCurrentAvailableModel(
  catalog: AvailableModelCatalog,
  identity: ExecutionTargetWizardRequest["discoveryIdentity"],
): AvailableModelCatalogEntry {
  const entry = catalog.entries.find((candidate) => candidate.providerId === identity.providerId
    && candidate.providerRouteId === identity.providerRouteId
    && candidate.providerModelId === identity.providerModelId);
  if (!entry) throw new Error("The selected Available Models identity is no longer current.");
  return entry;
}

async function readCurrentTargetWizardContext(): Promise<TargetWizardReadContext> {
  const snapshot = readGlobalConfigSnapshot();
  const authority = readGlobalExecutionTargetAuthority(snapshot.config);
  const targetIntent = snapshot.config?.targetCatalog;
  if (!authority || !targetIntent) throw new Error("Direct target catalog is unavailable; configure an account before creating a target.");
  const { registry } = createDefaultRegistry();
  const discovery = projectGuiProviderModelDiscovery(await resolveGuiOperatorDiscoveryResults(getRuntimeProviderAvailability(registry)));
  const selection = createOperatorExecutionRouteSelectionPort({
    readConfigSnapshot: () => snapshot,
    resolveAccountAvailability: async () => [],
  });
  const executionRouteCatalog = await selection.getCatalog();
  return {
    catalog: projectAvailableModelDiagnostic({ discovery, executionRouteCatalog }),
    revision: snapshot.revision,
    discovery,
    executionCatalog: authority.executionCatalog,
    targetIntent: targetIntent as ExecutionTargetCatalogIntent,
    targetEvidence: authority.evidence,
  };
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
