import { existsSync } from "node:fs";
import { join } from "node:path";
import type { KilnAppConfig } from "../config.js";
import { YamlWatcher } from "./dev-watcher.js";

export interface DevFlags {
  port?: number;
  configPath?: string;
}

export async function devCommand(appConfig: KilnAppConfig, flags?: DevFlags): Promise<void> {
  const root = process.cwd();
  const appDir = join(root, appConfig.dirName);

  if (!existsSync(appDir)) {
    console.error(`Not initialized. Run '${appConfig.appName} init' first.`);
    process.exit(1);
  }

  const configPath = flags?.configPath ?? join(appDir, "gateway.yaml");
  if (!existsSync(configPath)) {
    console.error(`No gateway.yaml found at ${configPath}.`);
    process.exit(1);
  }

  const appYamlPath = join(appDir, "app.yaml");
  const watchPaths = [configPath];
  if (existsSync(appYamlPath)) watchPaths.push(appYamlPath);

  console.log(`Starting dev mode on port ${flags?.port ?? 4000}...`);
  console.log(`Watching: ${watchPaths.join(", ")}`);

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

  try {
    const { startGateway } = await import("@kilnai/runtime");
    await startGateway(configPath, { port: flags?.port, devMode: true });
  } catch (err) {
    console.error(`Failed to start gateway: ${err instanceof Error ? err.message : String(err)}`);
    watcher.stop();
    process.exit(1);
  }

  watcher.stop();
}
