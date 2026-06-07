import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base } from "@playwright/test";

const READY_TIMEOUT_MS = 30_000;
const RUNNER_RELATIVE_PATH = "packages/gui/tests/parity/fixtures/gateway-runner.ts";

interface GatewayFixture {
  gatewayPort: number;
}

function resolveRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
}

async function waitForReady(child: ChildProcessWithoutNullStreams): Promise<number> {
  let stdoutBuffer = "";
  let stderrBuffer = "";

  return await new Promise<number>((resolveReady, reject) => {
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
        const match = /^READY\s+(\d+)$/.exec(line.trim());
        if (!match) {
          continue;
        }
        cleanup();
        resolveReady(Number.parseInt(match[1], 10));
        return;
      }
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("exit", onExit);
    child.on("error", onError);
  });
}

async function stopRunner(child: ChildProcessWithoutNullStreams): Promise<void> {
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

export const test = base.extend<Record<string, never>, GatewayFixture>({
  gatewayPort: [async ({}, use) => {
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
      const readyPort = await waitForReady(runner);
      await use(readyPort);
    } finally {
      await stopRunner(runner);
    }
  }, { scope: "worker", auto: true }],
});

export { expect } from "@playwright/test";
