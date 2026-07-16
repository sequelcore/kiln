import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("BunPtyAdapter", () => {
  it("supports bidirectional input through the platform PTY", () => {
    const runtimeRoot = resolve(process.cwd(), "packages/runtime");
    const serviceUrl = pathToFileURL(resolve(runtimeRoot, "src/operator-terminal/operator-terminal-service.ts"));
    const adapterUrl = pathToFileURL(resolve(runtimeRoot, "src/operator-terminal/bun-pty-adapter.ts"));
    const script = `
      import { OperatorTerminalService } from ${JSON.stringify(serviceUrl.href)};
      import { BunPtyAdapter } from ${JSON.stringify(adapterUrl.href)};
      const service = new OperatorTerminalService({ workspaceRoot: process.cwd(), adapter: new BunPtyAdapter() });
      let terminalId = "";
      const marker = "kiln-operator-terminal-integration";
      const done = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("PTY did not return interactive output.")), 5000);
        service.open({ ownerId: "test", cols: 80, rows: 24, onEvent: (event) => {
          if (event.type === "output" && event.data.includes(marker)) {
            clearTimeout(timeout);
            resolve();
          }
        }}).then((terminal) => {
          terminalId = terminal.terminalId;
          service.write("test", terminalId, "echo " + marker + (process.platform === "win32" ? String.fromCharCode(13) : "\\n"));
        }).catch(reject);
      });
      await done;
      service.closeOwner("test");
      console.log("PTY_INTEGRATION_OK");
    `;
    const result = spawnSync("bun", ["-e", script], {
      cwd: runtimeRoot,
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("PTY_INTEGRATION_OK");
  }, 15_000);
});
