import { basename, join } from "node:path";
import readline from "node:readline";
import {
  acceptTrustedExecutionSemanticLimitation,
  OPENCODE_NO_FILESYSTEM_SANDBOX,
  revokeTrustedExecutionSemanticLimitation,
} from "@kilnai/core";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import { resolveKilnHomePath } from "../config/global-config/path.js";
import { readGlobalConfig } from "../config/global-config.js";

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
  if (
    (action !== "accept-limitation" && action !== "revoke-limitation") ||
    target !== "opencode" ||
    limitation !== OPENCODE_NO_FILESYSTEM_SANDBOX.id
  ) {
    console.error(
      "Usage: kiln trust <accept-limitation|revoke-limitation> --harness opencode --limitation opencode.no-filesystem-sandbox [--operator <id> --confirm <project-basename>]",
    );
    process.exitCode = 1;
    return;
  }
  let operatorId = explicitOperator;
  let confirmed = confirmation === projectName;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    if (!operatorId || !confirmed) {
      console.error(
        "Non-interactive limitation acceptance requires --operator and --confirm with the exact project directory name.",
      );
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
    if (!confirmed)
      confirmed = (await ask(`Type the project directory name (\`${projectName}\`) to confirm: `)) === projectName;
    if (!confirmed) {
      process.exitCode = 1;
      return;
    }
  }
  const now = new Date().toISOString();
  const semanticLimitationDir = join(resolveKilnHomePath(), "trust", "semantic-limitations");
  if (action === "accept-limitation") {
    const acceptance = acceptTrustedExecutionSemanticLimitation({
      projectPath,
      descriptor: OPENCODE_NO_FILESYSTEM_SANDBOX,
      acceptedBy: operatorId!,
      acceptedAt: now,
      reviewAfter: OPENCODE_NO_FILESYSTEM_SANDBOX.reviewAfter,
      baseDir: semanticLimitationDir,
    });
    console.log(`OpenCode limitation accepted by ${acceptance.acceptedBy} until ${acceptance.reviewAfter}.`);
    return;
  }
  console.log(
    revokeTrustedExecutionSemanticLimitation({
      projectPath,
      descriptor: OPENCODE_NO_FILESYSTEM_SANDBOX,
      revokedBy: operatorId!,
      revokedAt: now,
      baseDir: semanticLimitationDir,
    })
      ? "OpenCode limitation acceptance revoked."
      : "No current OpenCode limitation acceptance exists for this project.",
  );
}

export async function trustCommand(args: readonly string[]): Promise<void> {
  const action = args[0];
  if (action === "accept-limitation" || action === "revoke-limitation") return limitationCommand(args);
  console.error(
    "Usage: kiln trust <accept-limitation|revoke-limitation> --harness opencode --limitation opencode.no-filesystem-sandbox [--operator <id> --confirm <project-basename>]",
  );
  process.exitCode = 1;
}
