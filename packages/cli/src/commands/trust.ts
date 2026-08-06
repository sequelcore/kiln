import readline from "node:readline";
import {
  finalizeTrustedExecutionGrant,
  planTrustedExecutionGrant,
  revokeTrustedExecutionGrant,
  type TrustedExecutionHarness,
} from "@kilnai/core";
import { readGlobalConfig } from "../config/global-config.js";

const HARNESSES = ["codex", "claude-code", "opencode"] as const;
function harness(value: string | undefined): TrustedExecutionHarness | undefined {
  return HARNESSES.includes(value as TrustedExecutionHarness) ? (value as TrustedExecutionHarness) : undefined;
}
async function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const result = await new Promise<string>((resolve) => {
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
  return result;
}

export async function trustCommand(args: readonly string[]): Promise<void> {
  const action = args[0];
  const target = harness(args[1]);
  if ((action !== "grant" && action !== "revoke") || !target) {
    console.error("Usage: kiln trust <grant|revoke> <codex|claude-code|opencode> [--full-access]");
    process.exitCode = 1;
    return;
  }
  const requestedProfile = args.includes("--full-access") ? "trusted-full-access" : "workspace-write";
  const operatorId = readGlobalConfig()?.identity?.name;
  if (!operatorId) {
    console.error("Set your operator identity first: kiln config set --global identity.name <name>");
    process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`Run manually in an interactive terminal: kiln trust ${action} ${target}`);
    process.exitCode = 1;
    return;
  }
  const projectPath = process.cwd();
  if (action === "revoke") {
    const result = revokeTrustedExecutionGrant(target, projectPath, {
      operatorId,
      authorizedAt: new Date().toISOString(),
    });
    if (!result.hadExistingGrant) console.log(`No trusted-execution grant exists for \`${target}\` in this project.`);
    else console.log(`Trusted-execution grant revoked for ${target}.`);
    return;
  }
  const plan = planTrustedExecutionGrant({ harness: target, projectPath, requestedProfile });
  console.log(
    `Project: ${projectPath}\nHarness: ${target}\nApproval control: ${plan.enforcement.approvalControl}\nFilesystem sandbox: ${plan.enforcement.filesystemSandbox}\nNetwork boundary: ${plan.enforcement.networkBoundary}\nStrength: ${plan.enforcement.strength}\nRevoke: kiln trust revoke ${target}`,
  );
  let approved: boolean;
  if (plan.confirmationKind === "binary")
    approved = (await ask("Authorize trusted execution? [y/N]: ")).trim().toLowerCase() === "y";
  else {
    approved = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if ((await ask(`Type the project directory name (\`${plan.basename}\`) to confirm: `)) === plan.basename) {
        approved = true;
        break;
      }
    }
  }
  if (!approved) {
    process.exitCode = 1;
    return;
  }
  const result = finalizeTrustedExecutionGrant(plan, {
    approved: true,
    operatorId,
    authorizedAt: new Date().toISOString(),
  });
  if (result.status === "rejected") {
    console.error(result.reason ?? "Trusted execution grant was rejected.");
    process.exitCode = 1;
    return;
  }
  console.log(`Trusted-execution grant recorded for ${result.authorizedBy} at ${result.authorizedAt}.`);
}
