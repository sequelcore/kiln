import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("BunPtyAdapter", () => {
  it("supports bidirectional input through the platform PTY", () => {
    const runtimeRoot = fileURLToPath(new URL("../..", import.meta.url));
    const serviceUrl = pathToFileURL(resolve(runtimeRoot, "src/operator-terminal/operator-terminal-service.ts"));
    const adapterUrl = pathToFileURL(resolve(runtimeRoot, "src/operator-terminal/bun-pty-adapter.ts"));
    const bunExecutable = (process.env.PATH ?? "")
      .split(delimiter)
      .map((directory) => resolve(directory, process.platform === "win32" ? "bun.exe" : "bun"))
      .find(existsSync);
    expect(bunExecutable, "Bun executable must be available on PATH for the PTY integration test").toBeDefined();
    const script = `
      import { OperatorTerminalService } from ${JSON.stringify(serviceUrl.href)};
      import { BunPtyAdapter } from ${JSON.stringify(adapterUrl.href)};
      const marker = "kiln-operator-terminal-integration";
      const childScript = \`
        process.stdin.setRawMode?.(true);
        process.stdin.resume();
        process.stdin.once("data", () => {
          process.stdin.pause();
          process.stdout.write(\${JSON.stringify(marker + "\\n")}, () => {
            process.exitCode = 0;
          });
        });
      \`;
      const service = new OperatorTerminalService({
        workspaceRoot: process.cwd(),
        adapter: new BunPtyAdapter(),
        resolveShell: () => ({ executable: process.execPath, args: ["-e", childScript] }),
      });
      let receivedMarker = false;
      let receivedExit = false;
      const done = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("PTY did not return interactive output.")), 5000);
        const complete = () => {
          if (receivedMarker && receivedExit) {
            clearTimeout(timeout);
            resolve();
          }
        };
        service.open({ ownerId: "test", cols: 80, rows: 24, onEvent: (event) => {
          if (event.type === "output" && event.data.includes(marker)) receivedMarker = true;
          if (event.type === "exit" && event.exitCode === 0) receivedExit = true;
          complete();
        }}).then(({ terminalId }) => {
          service.write("test", terminalId, "ping");
        }).catch(reject);
      });
      await done;
      console.log("PTY_INTEGRATION_OK");
    `;
    const result = spawnSync(bunExecutable!, ["-e", script], {
      cwd: runtimeRoot,
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("PTY_INTEGRATION_OK");
  }, 15_000);
});
