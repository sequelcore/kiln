import type { KilnAppConfig } from "../config.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";
import {
  collectProjectContextEvidence,
  renderProjectContextEvidenceMarkdown,
  writeProjectContextAdoption,
} from "../application/project-context.js";

export async function projectCommand(
  _appConfig: KilnAppConfig,
  subcommand: string | undefined,
  args: readonly string[],
): Promise<void> {
  const projectPath = findFlag(args, "--project") ?? findFlag(args, "--cwd");
  const root = resolveProjectRoot({ explicitPath: projectPath });

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printProjectHelp();
    return;
  }

  if (!root.hasKilnYaml && !root.hasGitRoot) {
    console.error(`Error: unable to resolve a Kiln project root from ${root.rootPath}`);
    process.exit(1);
  }

  switch (subcommand) {
    case "scout": {
      const evidence = collectProjectContextEvidence(root.rootPath);
      if (args.includes("--json")) {
        console.log(JSON.stringify(evidence, null, 2));
      } else {
        console.log(renderProjectContextEvidenceMarkdown(evidence));
      }
      break;
    }
    case "adopt": {
      const result = writeProjectContextAdoption(root.rootPath, { force: args.includes("--force") });
      if (result.errors.length > 0) {
        for (const error of result.errors) {
          console.error(`Error: ${error}`);
        }
        process.exit(1);
      }
      console.log(`${result.path}: ${result.status}`);
      break;
    }
    default:
      console.error(`Unknown project subcommand: ${subcommand}`);
      printProjectHelp();
      process.exit(1);
  }
}

function findFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1];
  }
  const prefix = `${flag}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  return inline?.slice(prefix.length);
}

function printProjectHelp(): void {
  console.log("\nUsage: kiln project <subcommand> [options]\n");
  console.log("Subcommands:");
  console.log("  scout          Print deterministic repo-context evidence");
  console.log("  adopt          Write .kiln/project-context.md from repo evidence");
  console.log("");
  console.log("Options:");
  console.log("  --project PATH Resolve project root from PATH");
  console.log("  --cwd PATH     Alias for --project");
  console.log("  --json         Print scout evidence as JSON");
  console.log("  --force        Replace existing project context after backup");
  console.log("");
}
