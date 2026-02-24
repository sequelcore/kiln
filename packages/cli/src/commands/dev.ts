import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { KilnAppConfig } from "../config.js";
import { YamlWatcher } from "./dev-watcher.js";

export interface DevFlags {
  port?: number;
  configPath?: string;
  playground?: boolean;
}

export async function devCommand(appConfig: KilnAppConfig, flags?: DevFlags): Promise<void> {
  const root = process.cwd();
  const appDir = join(root, appConfig.dirName);

  if (!existsSync(appDir)) {
    console.error(`Not initialized. Run '${appConfig.appName} init' first.`);
    process.exit(1);
  }

  const gatewayPath = flags?.configPath ?? join(appDir, "gateway.yaml");
  const appYamlPath = join(appDir, "app.yaml");
  const hasGateway = existsSync(gatewayPath);

  const watchPaths = hasGateway ? [gatewayPath] : [];
  if (existsSync(appYamlPath)) watchPaths.push(appYamlPath);

  if (watchPaths.length > 0) {
    const watcher = new YamlWatcher({
      paths: watchPaths,
      debounceMs: 300,
      onReload: (path) => {
        console.log(`\n[hot-reload] ${path} changed, reloading...`);
        console.log("[hot-reload] Config reloaded.");
      },
      onError: (err) => {
        console.error(`[watch-error] ${err.message}`);
      },
    });
    watcher.start();
  }

  const port = flags?.port ?? 4800;

  try {
    if (hasGateway) {
      const { startGateway } = await import("@kilnai/runtime");
      await startGateway(gatewayPath, { port, devMode: true });
    } else {
      const { startDevServer } = await import("@kilnai/runtime");
      await startDevServer({ port, appYamlPath: existsSync(appYamlPath) ? appYamlPath : undefined });
    }

    if (flags?.playground) {
      const url = `http://localhost:${port}/studio/`;
      openBrowser(url);
    }
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
