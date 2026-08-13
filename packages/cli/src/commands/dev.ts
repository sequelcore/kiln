import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { KilnAppConfig } from "../config.js";
import { YamlWatcher } from "./dev-watcher.js";
import { loadResolvedKilnMcpConfiguration } from "../config/config-merger.js";
import { createMcpCredentialAccess } from "../config/mcp-credentials.js";

export interface DevFlags {
  readonly port?: number;
  readonly configPath?: string;
  readonly open?: boolean;
}

export type DevLaunchPlan =
  | {
      readonly ok: true;
      readonly gatewayPath: string;
      readonly port: number;
      readonly watchPaths: readonly string[];
      readonly openUrl?: string;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

export function resolveDevLaunchPlan(
  root: string,
  flags: DevFlags = {},
  pathExists: (path: string) => boolean = existsSync,
): DevLaunchPlan {
  const appDir = join(root, ".kiln");

  if (!pathExists(appDir)) {
    return { ok: false, message: "Not initialized. Run 'kiln init' first." };
  }

  const gatewayPath = flags.configPath ?? join(appDir, "gateway.yaml");
  if (!pathExists(gatewayPath)) {
    return {
      ok: false,
      message: "No gateway configuration found. Run 'kiln init' or pass --config <path>.",
    };
  }

  const appYamlPath = join(appDir, "app.yaml");
  const watchPaths = [gatewayPath];
  if (pathExists(appYamlPath)) watchPaths.push(appYamlPath);
  const port = flags.port ?? 4800;

  return {
    ok: true,
    gatewayPath,
    port,
    watchPaths,
    ...(flags.open ? { openUrl: `http://localhost:${port}/gui/` } : {}),
  };
}

export async function devCommand(_appConfig: KilnAppConfig, flags: DevFlags = {}): Promise<void> {
  const root = process.cwd();
  const plan = resolveDevLaunchPlan(root, flags);

  if (!plan.ok) {
    console.error(plan.message);
    process.exit(1);
    return;
  }

  if (plan.watchPaths.length > 0) {
    const watcher = new YamlWatcher({
      paths: plan.watchPaths,
      debounceMs: 300,
      onReload: (path) => {
        console.log(`\n[watch] ${path} changed. Restart \`kiln dev\` to apply changes.`);
      },
      onError: (err) => {
        console.error(`[watch-error] ${err.message}`);
      },
    });
    watcher.start();
  }

  try {
    const { startGateway } = await import("@kilnai/runtime");
    const mcp = loadResolvedKilnMcpConfiguration(root);
    if (mcp.diagnostics.length > 0) {
      throw new Error(`Canonical MCP configuration is invalid: ${mcp.diagnostics.map((item) => item.code).join(", ")}`);
    }
    await startGateway(plan.gatewayPath, {
      port: plan.port,
      swarmCoordination: "project-local",
      canonicalMcpServers: new Map(Object.entries(mcp.servers)),
      mcpCredentialResolver: createMcpCredentialAccess().resolve,
      ...(plan.openUrl ? { onReady: () => openBrowser(plan.openUrl!) } : {}),
    });
  } catch (err) {
    console.error(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "win32" ? `start "" "${url}"` :
    process.platform === "darwin" ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.error(`Could not open browser: ${err.message}`);
  });
}
