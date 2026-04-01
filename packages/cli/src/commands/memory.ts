import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { KilnAppConfig } from "../config.js";

export function memoryCommand(
  _appConfig: KilnAppConfig,
  subcommand: string,
  _args: string[],
  projectPath?: string,
): void {
  const root = projectPath ?? process.cwd();

  if (!subcommand) {
    printMemoryHelp();
    return;
  }

  switch (subcommand) {
    case "stats": {
      printMemoryStats(root);
      break;
    }

    default:
      console.log(`Unknown memory subcommand: ${subcommand}`);
      printMemoryHelp();
  }
}

function printMemoryHelp(): void {
  console.log(`\nUsage: kiln memory <subcommand>\n`);
  console.log("Subcommands:");
  console.log("  stats            Show memory file counts and sizes");
  console.log("");
}

function printMemoryStats(root: string): void {
  const memoryDir = join(root, ".kiln", "memory");

  if (!existsSync(memoryDir)) {
    console.log(`No memory directory found. Run 'kiln init' first.`);
    return;
  }

  const files = readdirSync(memoryDir);
  let totalSize = 0;

  for (const file of files) {
    const stat = statSync(join(memoryDir, file));
    totalSize += stat.size;
  }

  console.log("\nMemory Stats\n");
  console.log(`  Directory: .kiln/memory/`);
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
