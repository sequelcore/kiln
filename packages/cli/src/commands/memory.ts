import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { KilnAppConfig } from "../config.js";

export function memoryCommand(
  appConfig: KilnAppConfig,
  subcommand: string,
  args: string[],
  projectPath?: string,
): void {
  const root = projectPath ?? process.cwd();

  if (!subcommand) {
    printMemoryHelp(appConfig);
    return;
  }

  switch (subcommand) {
    case "search": {
      const query = args.join(" ");
      if (!query) {
        console.log(`Usage: ${appConfig.appName} memory search <query>`);
        return;
      }
      console.log("Memory search requires a running session.");
      break;
    }

    case "show": {
      const layer = args[0] ?? "all";
      console.log(`Memory layer: ${layer}`);
      console.log("Memory show requires a running session.");
      break;
    }

    case "stats": {
      printMemoryStats(appConfig, root);
      break;
    }

    default:
      console.log(`Unknown memory subcommand: ${subcommand}`);
      printMemoryHelp(appConfig);
  }
}

function printMemoryHelp(appConfig: KilnAppConfig): void {
  console.log(`\nUsage: ${appConfig.appName} memory <subcommand>\n`);
  console.log("Subcommands:");
  console.log("  search <query>   Search all memory layers");
  console.log("  show [layer]     Show recent entries (user, agent, project)");
  console.log("  stats            Show memory file counts and sizes");
  console.log("");
}

function printMemoryStats(appConfig: KilnAppConfig, root: string): void {
  const memoryDir = join(root, appConfig.dirName, "memory");

  if (!existsSync(memoryDir)) {
    console.log(`No memory directory found. Run '${appConfig.appName} init' first.`);
    return;
  }

  const files = readdirSync(memoryDir);
  let totalSize = 0;

  for (const file of files) {
    const stat = statSync(join(memoryDir, file));
    totalSize += stat.size;
  }

  console.log("\nMemory Stats\n");
  console.log(`  Directory: ${appConfig.dirName}/memory/`);
  console.log(`  Files:     ${files.length}`);
  console.log(`  Size:      ${formatBytes(totalSize)}`);
  console.log("");
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]!}`;
}
