import { spawn, type ChildProcessByStdio } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";
import { expect, test as base, type Page } from "@playwright/test";

const READY_TIMEOUT_MS = 30_000;
const RUNNER_RELATIVE_PATH = "packages/gui/tests/parity/fixtures/gateway-runner.ts";

interface GatewayFixture {
  gatewayPort: number;
  operatorToken: string;
}

type GatewayTestFixtures = Record<never, never>;

type GatewayRunnerProcess = ChildProcessByStdio<null, Readable, Readable>;

let activeOperatorToken = "";

function resolveRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
}

async function waitForReady(child: GatewayRunnerProcess): Promise<{ readonly port: number; readonly operatorToken: string }> {
  let stdoutBuffer = "";
  let stderrBuffer = "";

  return await new Promise<{ readonly port: number; readonly operatorToken: string }>((resolveReady, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Gateway runner timed out waiting for READY line. Stderr:\n${stderrBuffer}`));
    }, READY_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", onError);
    };

    const rejectWith = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onError = (error: Error) => {
      rejectWith(error);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      rejectWith(new Error(`Gateway runner exited before READY (code=${code}, signal=${signal}). Stderr:\n${stderrBuffer}`));
    };

    const onStderr = (chunk: Buffer | string) => {
      stderrBuffer += chunk.toString();
    };

    const onStdout = (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^READY\s+(\d+)\s+(\S+)$/.exec(line.trim());
        if (!match) {
          continue;
        }
        cleanup();
        resolveReady({
          port: Number.parseInt(match[1]!, 10),
          operatorToken: match[2] === "none" ? "" : match[2]!,
        });
        return;
      }
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("exit", onExit);
    child.on("error", onError);
  });
}

async function stopRunner(child: GatewayRunnerProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolveStop) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 3_000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });

    child.kill("SIGTERM");
  });
}

export const test = base.extend<GatewayTestFixtures, GatewayFixture>({
  gatewayPort: [async ({ browserName }, use) => {
    void browserName;
    const repoRoot = resolveRepoRoot();
    // Use GUI_GATEWAY_PORT from the environment (set by playwright.config.ts via
    // reserveGatewayPort). This is the same port the Vite dev-server proxy
    // targets, so HTTP and WebSocket tests both route to the same live gateway.
    // workers:1 in the config ensures only one worker runs at a time, so this
    // single port is never bound by two processes simultaneously.
    // The runner passes this port to Bun.serve and emits READY <actualPort>,
    // which may differ if the OS has since reclaimed the reserved port — in that
    // case we fall back to whatever Bun bound, and the Vite proxy will miss, but
    // Bun with port=0 is used as a last resort to avoid a hard crash.
    const configPort = process.env.GUI_GATEWAY_PORT ?? "0";
    const runner = spawn(
      "bun",
      ["run", RUNNER_RELATIVE_PATH],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          GUI_GATEWAY_PORT: configPort,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    try {
      const ready = await waitForReady(runner);
      activeOperatorToken = ready.operatorToken;
      await use(ready.port);
    } finally {
      activeOperatorToken = "";
      await stopRunner(runner);
    }
  }, { scope: "worker", auto: true }],
  operatorToken: [async ({ gatewayPort }, use) => {
    void gatewayPort;
    await use(activeOperatorToken);
  }, { scope: "worker" }],
});

export async function waitForGuiReady(page: Page): Promise<void> {
  await expect(page.getByRole("status", { name: "Runtime bootstrap" })).toBeHidden({ timeout: 15_000 });
  await expect(page.locator("#composer-input")).toBeAttached({ timeout: 15_000 });
  const targetSelector = page.getByRole("button", { name: /Execution target selector/ });
  if ((await targetSelector.getAttribute("aria-label"))?.includes("Current selection: none")) {
    await targetSelector.click();
    await page.getByRole("option", { name: "Claude, Automatic" }).click();
    await expect(targetSelector).toHaveAttribute("aria-label", /Current selection: Claude/);
  }
}

export { expect };
