import { spawnSync, type ChildProcess, type SpawnSyncReturns } from "node:child_process";

interface StopGuiChildProcessOptions {
  readonly platform?: NodeJS.Platform;
  readonly spawnSyncImpl?: typeof spawnSync;
}

export async function stopGuiChildProcess(
  child: ChildProcess,
  options: StopGuiChildProcessOptions = {},
): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  const platform = options.platform ?? process.platform;
  if (platform === "win32" && child.pid !== undefined) {
    const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
    spawnSyncImpl("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    }) as SpawnSyncReturns<Buffer>;
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
    return;
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000);
    child.once("exit", finish);
    if (!child.kill("SIGINT")) {
      child.kill("SIGTERM");
    }
  });
}
