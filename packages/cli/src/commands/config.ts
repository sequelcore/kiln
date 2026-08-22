import type { KilnAppConfig } from "../config.js";
import {
  isConfigReadView,
  readConfigStatusSnapshot,
  readConfigStatusView,
} from "../application/config-status.js";
import { effectiveConfigField } from "../application/effective-config-projection.js";
import { executeConfigSetupAction } from "../application/config-setup-actions.js";
import {
  applyConfigMutation,
  approveConfigMutation,
  proposeConfigMutation,
} from "../application/config-mutation-authority.js";
import { ConfigMutationStore } from "../application/config-mutation-store.js";
import { configSettingKeys } from "../application/config-setting-descriptors.js";
import type { KilnConfigMutationOperation } from "@kilnai/gateway-contracts";
import {
  KILN_CONFIG_SETUP_ACTIONS,
  type KilnConfigSetupAction,
  type KilnConfigSetupActionResult,
  type KilnConfigSetupSnapshot,
} from "@kilnai/gateway-contracts";

export async function configCommand(
  _appConfig: KilnAppConfig,
  subcommand: string,
  args: string[],
  projectPath?: string,
): Promise<void> {
  const root = projectPath ?? readProjectFlag(args) ?? process.cwd();

  if (!subcommand) {
    printConfigHelp();
    return;
  }

  switch (subcommand) {
    case "show": {
      const snapshot = await readConfigStatusSnapshot({ projectPath: root, view: "effective" });
      if (!snapshot.effectiveConfig) {
        console.log(`Not initialized. Run 'kiln init' first.`);
        return;
      }
      console.log(JSON.stringify(snapshot.effectiveConfig, null, 2));
      break;
    }

    case "read": {
      const viewArg = readPositionalArgs(args)[0] ?? "effective";
      if (!isConfigReadView(viewArg)) {
        console.log(`Unknown config read view: ${viewArg}`);
        console.log("Valid views: effective, providers, routes, agents, skills, permissions, memory, projections, setup, health, settings");
        return;
      }
      const snapshot = await readConfigStatusSnapshot({ projectPath: root, view: viewArg });
      const result = await readConfigStatusView(snapshot, viewArg);
      console.log(JSON.stringify(result.value, null, 2));
      break;
    }

    case "settings": {
      const query = readPositionalArgs(args)[0];
      const snapshot = await readConfigStatusSnapshot({ projectPath: root, view: "settings" });
      const result = await readConfigStatusView(snapshot, "settings", {
        ...(query === undefined ? {} : { query }),
        ...(args.includes("--modified") ? { modified: true } : {}),
      });
      console.log(JSON.stringify(result.value, null, 2));
      break;
    }

    case "explain": {
      const requestedIdentity = readPositionalArgs(args)[0];
      if (!requestedIdentity) {
        console.log("Usage: kiln config explain <identity>");
        return;
      }
      const identity = requestedIdentity.startsWith("/") ? requestedIdentity : `/${requestedIdentity}`;
      const snapshot = await readConfigStatusSnapshot({ projectPath: root, view: "effective" });
      const field = effectiveConfigField(snapshot.effectiveConfig, identity);
      if (!field) {
        console.log(`Unknown effective config identity: ${identity}`);
        return;
      }
      console.log(JSON.stringify(field, null, 2));
      break;
    }

    case "setup": {
      const setup = await runConfigSetupCommand(root, args);
      console.log(JSON.stringify(setup, null, 2));
      break;
    }

    case "approve": {
      const proposalId = readPositionalArgs(args)[0];
      if (!proposalId) {
        console.log("Usage: kiln config approve <proposalId>");
        return;
      }
      try {
        const approval = approveConfigMutation({
          projectPath: root,
          proposalId,
          approvedBy: process.env.USERNAME ?? process.env.USER ?? "operator",
          surface: "cli",
        });
        console.log(JSON.stringify(approval, null, 2));
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
      break;
    }

    case "set": {
      const positionals = readPositionalArgs(args);
      const key = positionals[0];
      const value = positionals[1];

      if (!key || value === undefined) {
        console.log(`Usage: kiln config set [--global] [--approve] <key> <value>`);
        return;
      }

      await runGovernedConfigMutation({
        projectPath: root,
        operation: "setting.set",
        payload: { scope: hasGlobalFlag(args) ? "global" : "project", key, value },
        approve: hasApproveFlag(args),
        describe: `Set ${key}`,
      });
      break;
    }

    case "reset": {
      const key = readPositionalArgs(args)[0];
      if (!key) {
        console.log(`Usage: kiln config reset [--global] <key>`);
        return;
      }
      await runGovernedConfigMutation({
        projectPath: root,
        operation: "setting.reset",
        payload: { scope: hasGlobalFlag(args) ? "global" : "project", key },
        approve: hasApproveFlag(args),
        describe: `Reset ${key}`,
      });
      break;
    }

    default:
      console.log(`Unknown config subcommand: ${subcommand}`);
      printConfigHelp();
  }
}

function printConfigHelp(): void {
  console.log(`\nUsage: kiln config <subcommand>\n`);
  console.log("Subcommands:");
  console.log("  show              Print current config");
  console.log("  read [view]       Print canonical config/status view as JSON");
  console.log("  settings [query]  Print searchable settings (optionally --modified)");
  console.log("  explain <identity> Explain one effective field and its provenance");
  console.log("  setup [--apply|--action <id>] Inspect or execute setup recommendations");
  console.log("  approve <id>      Approve a stored config proposal for kiln_config.apply_change");
  console.log("  set [--global] <key> <value> Update a project or global config value");
  console.log("  reset [--global] <key> Reset one setting to inherited/default state");
  console.log("\nRead views: effective, providers, routes, agents, skills, permissions, memory, projections, setup, health, settings");
  console.log(`\nValid keys: ${configSettingKeys().join(", ")}`);
  console.log("");
}

async function runConfigSetupCommand(
  projectPath: string,
  args: readonly string[],
): Promise<KilnConfigSetupSnapshot | readonly KilnConfigSetupActionResult[]> {
  const action = readActionFlag(args);
  if (action) {
    return [await executeConfigSetupAction({ projectPath, action })];
  }
  if (!args.includes("--apply")) {
    const snapshot = await readConfigStatusSnapshot({ projectPath });
    return { ...snapshot.setup, ...(snapshot.effectiveConfig ? { effectiveConfig: snapshot.effectiveConfig } : {}) };
  }

  const results: KilnConfigSetupActionResult[] = [];
  for (let index = 0; index < KILN_CONFIG_SETUP_ACTIONS.length; index += 1) {
    const snapshot = await readConfigStatusSnapshot({ projectPath });
    const next = snapshot.setup.recommendedActions.find((candidate) => candidate !== "none");
    if (!next) {
      break;
    }
    const result = await executeConfigSetupAction({ projectPath, action: next });
    results.push(result);
    if (result.status === "blocked" || result.status === "failed") {
      break;
    }
  }
  return results;
}

function readActionFlag(args: readonly string[]): KilnConfigSetupAction | undefined {
  const index = args.findIndex((arg) => arg === "--action");
  const value = index >= 0 ? args[index + 1] : args.find((arg) => arg.startsWith("--action="))?.slice("--action=".length);
  if (!value) {
    return undefined;
  }
  if (!KILN_CONFIG_SETUP_ACTIONS.includes(value as KilnConfigSetupAction)) {
    console.error(`Invalid setup action: ${value}. Must be one of ${KILN_CONFIG_SETUP_ACTIONS.join(", ")}.`);
    process.exit(1);
  }
  return value as KilnConfigSetupAction;
}

/**
 * Runs one configuration change through the mutation authority.
 *
 * The command never writes canonical configuration itself. A change that can
 * affect authority is previewed and refused until the operator approves it in
 * the same explicit invocation with `--approve`.
 */
async function runGovernedConfigMutation(input: {
  readonly projectPath: string;
  readonly operation: KilnConfigMutationOperation;
  readonly payload: Record<string, unknown>;
  readonly approve: boolean;
  readonly describe: string;
}): Promise<void> {
  const record = proposeConfigMutation({
    projectPath: input.projectPath,
    operation: input.operation,
    payload: input.payload,
  });
  const proposal = record.proposal;

  if (proposal.status === "invalid") {
    for (const diagnostic of proposal.diagnostics) {
      console.error(`${diagnostic.severity}: ${diagnostic.field}: ${diagnostic.message}`);
    }
    process.exitCode = 1;
    return;
  }

  new ConfigMutationStore(input.projectPath).saveProposal(record);

  let approvalId: string | undefined;
  if (proposal.approvalRequired) {
    if (!input.approve) {
      console.log(`${input.describe} affects authority (${proposal.authorityImpact}) and needs approval.`);
      console.log(`Scope: ${proposal.scope}    Activation: ${proposal.activation}`);
      console.log(`Owners: ${proposal.affectedOwners.join(", ") || "none"}`);
      console.log(proposal.previewDiff);
      console.log(`Re-run with --approve, or approve it explicitly: kiln config approve ${proposal.proposalId}`);
      process.exitCode = 1;
      return;
    }
    approvalId = approveConfigMutation({
      projectPath: input.projectPath,
      proposalId: proposal.proposalId,
      approvedBy: process.env.USERNAME ?? process.env.USER ?? "operator",
      surface: "cli",
    }).approvalId;
  }

  const result = await applyConfigMutation({
    projectPath: input.projectPath,
    proposalId: proposal.proposalId,
    requester: "operator",
    ...(approvalId ? { approvalId } : {}),
  });

  const settlement = result.settlement;
  if (settlement.outcome === "rejected") {
    for (const diagnostic of settlement.diagnostics) {
      console.error(`${diagnostic.severity}: ${diagnostic.field}: ${diagnostic.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`${input.describe}: ${settlement.outcome} (activation: ${settlement.activation}, ${settlement.activationObservation.state})`);
  console.log(`  activation: ${settlement.activationObservation.summary}`);
  for (const warning of settlement.diagnostics.filter((entry) => entry.severity === "warning")) {
    console.log(warning.message);
  }
  if (settlement.outcome === "committed-reconciliation-failed") {
    for (const effect of settlement.reconciliationEffects.filter((entry) => entry.status === "failed")) {
      console.error(`reconciliation failed: ${effect.target}: ${effect.errors.join("; ")}`);
    }
    console.error("The change is committed. Re-run projection sync to converge it.");
    process.exitCode = 1;
  }
}

function hasApproveFlag(args: readonly string[]): boolean {
  return args.includes("--approve");
}

function hasGlobalFlag(args: readonly string[]): boolean {
  return args.includes("--global");
}

function readProjectFlag(args: readonly string[]): string | undefined {
  const index = args.findIndex((arg) => arg === "--project" || arg === "--cwd");
  if (index >= 0) {
    return args[index + 1];
  }
  const inline = args.find((arg) => arg.startsWith("--project=") || arg.startsWith("--cwd="));
  return inline?.slice(inline.indexOf("=") + 1);
}

function readPositionalArgs(args: readonly string[]): readonly string[] {
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--project" || arg === "--cwd") {
      index += 1;
      continue;
    }
    if (arg === "--global") {
      continue;
    }
    if (arg === "--action") {
      index += 1;
      continue;
    }
    if (arg === "--apply" || arg === "--modified" || arg.startsWith("--action=")) {
      continue;
    }
    if (arg.startsWith("--project=") || arg.startsWith("--cwd=")) {
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
    }
  }
  return positionals;
}
