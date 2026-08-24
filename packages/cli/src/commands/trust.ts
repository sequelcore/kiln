import { basename, join } from "node:path";
import readline from "node:readline";
import {
  OPENCODE_NO_FILESYSTEM_SANDBOX,
  acceptTrustedExecutionSemanticLimitation,
  finalizeTrustedExecutionGrant,
  planTrustedExecutionGrant,
  revokeTrustedExecutionSemanticLimitation,
  revokeTrustedExecutionGrant,
  type TrustedExecutionHarness,
} from "@kilnai/core";
import { readGlobalConfig } from "../config/global-config.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import { resolveKilnHomePath } from "../config/global-config/path.js";

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

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function limitationCommand(args: readonly string[]): Promise<void> {
  const action = args[0];
  const target = option(args, "--harness");
  const limitation = option(args, "--limitation");
  const explicitOperator = option(args, "--operator");
  const confirmation = option(args, "--confirm");
  const projectPath = resolveProjectRoot().rootPath;
  const projectName = basename(projectPath);
  if ((action !== "accept-limitation" && action !== "revoke-limitation") || target !== "opencode"
    || limitation !== OPENCODE_NO_FILESYSTEM_SANDBOX.id) {
    console.error("Usage: kiln trust <accept-limitation|revoke-limitation> --harness opencode --limitation opencode.no-filesystem-sandbox [--operator <id> --confirm <project-basename>]");
    process.exitCode = 1;
    return;
  }
  let operatorId = explicitOperator;
  let confirmed = confirmation === projectName;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    if (!operatorId || !confirmed) {
      console.error("Non-interactive limitation acceptance requires --operator and --confirm with the exact project directory name.");
      process.exitCode = 1;
      return;
    }
  } else {
    operatorId ??= readGlobalConfig()?.identity?.name;
    if (!operatorId) {
      console.error("Set your operator identity first: kiln config set --global identity.name <name>");
      process.exitCode = 1;
      return;
    }
    if (!confirmed) confirmed = (await ask(`Type the project directory name (\`${projectName}\`) to confirm: `)) === projectName;
    if (!confirmed) { process.exitCode = 1; return; }
  }
  const now = new Date().toISOString();
  const semanticLimitationDir = join(resolveKilnHomePath(), "trust", "semantic-limitations");
  if (action === "accept-limitation") {
    const acceptance = acceptTrustedExecutionSemanticLimitation({
      projectPath, descriptor: OPENCODE_NO_FILESYSTEM_SANDBOX, acceptedBy: operatorId!, acceptedAt: now,
      reviewAfter: OPENCODE_NO_FILESYSTEM_SANDBOX.reviewAfter,
      baseDir: semanticLimitationDir,
    });
    console.log(`OpenCode limitation accepted by ${acceptance.acceptedBy} until ${acceptance.reviewAfter}.`);
    return;
  }
  console.log(revokeTrustedExecutionSemanticLimitation({ projectPath, descriptor: OPENCODE_NO_FILESYSTEM_SANDBOX, revokedBy: operatorId!, revokedAt: now, baseDir: semanticLimitationDir })
    ? "OpenCode limitation acceptance revoked."
    : "No current OpenCode limitation acceptance exists for this project.");
}

export async function trustCommand(args: readonly string[]): Promise<void> {
  const action = args[0];
  if (action === "accept-limitation" || action === "revoke-limitation") return limitationCommand(args);
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
  const projectPath = resolveProjectRoot().rootPath;
  const trustDir = join(resolveKilnHomePath(), "trust");
  if (action === "revoke") {
    const result = revokeTrustedExecutionGrant(target, projectPath, {
      operatorId,
      authorizedAt: new Date().toISOString(),
    }, trustDir);
    if (!result.hadExistingGrant) console.log(`No trusted-execution grant exists for \`${target}\` in this project.`);
    else console.log(`Trusted-execution grant revoked for ${target}.`);
    return;
  }
  const plan = planTrustedExecutionGrant({ harness: target, projectPath, requestedProfile, baseDir: trustDir });
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
  }, trustDir);
  if (result.status === "rejected") {
    console.error(result.reason ?? "Trusted execution grant was rejected.");
    process.exitCode = 1;
    return;
  }
  console.log(`Trusted-execution grant recorded for ${result.authorizedBy} at ${result.authorizedAt}.`);
}
