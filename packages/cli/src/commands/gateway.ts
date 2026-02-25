// CLI command: kiln gateway -- start persistent multi-app Gateway

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export async function gatewayCommand(args: string[]): Promise<void> {
  // Parse --config flag (default: gateway.yaml in cwd)
  let configPath: string | undefined;
  let portOverride: number | undefined;

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === "--config" && i + 1 < args.length) {
      configPath = args[i + 1];
      i += 2;
    } else if (arg === "--port" && i + 1 < args.length) {
      const parsed = parseInt(args[i + 1]!, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        portOverride = parsed;
      }
      i += 2;
    } else if (arg === "--help" || arg === "-h") {
      printGatewayHelp();
      return;
    } else {
      i += 1;
    }
  }

  // Resolve config path
  const resolvedPath = configPath
    ? resolve(configPath)
    : join(process.cwd(), "gateway.yaml");

  if (!existsSync(resolvedPath)) {
    const displayPath = configPath ?? resolvedPath;
    console.error(`Gateway config not found: ${displayPath}`);
    console.error("Create a gateway.yaml or specify --config /path/to/gateway.yaml");
    process.exit(1);
  }

  // Dynamically import to avoid loading gateway deps on every CLI invocation
  const { startGateway } = await import("@kilnai/runtime");
  await startGateway(resolvedPath, { port: portOverride });
}

function printGatewayHelp(): void {
  console.log("\nUsage: gateway [options]\n");
  console.log("Start persistent Gateway (multi-app hosting)\n");
  console.log("Options:");
  console.log("  --config <path>  Path to gateway.yaml (default: ./gateway.yaml)");
  console.log("  --port <number>  Override port from config");
  console.log("  --help, -h       Show this help message");
  console.log("");
}
