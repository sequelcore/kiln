import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base } from "@playwright/test";

const READY_TIMEOUT_MS = 30_000;
const RUNNER_RELATIVE_PATH = "packages/gui/e2e/fixtures/gateway-runner.ts";

interface GatewayFixture {
  gatewayPort: number;
}

function resolveRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  await new Promise<void>((resolveClose, reject) => {
    server.close((err) => (err ? reject(err) : resolveClose()));
  });
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a gateway port for Playwright.");
  }
  return address.port;
}

function resolveGatewayPortFromEnv(): number | undefined {
  const raw = process.env.GUI_GATEWAY_PORT;
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid GUI_GATEWAY_PORT value: ${raw}`);
  }
  return parsed;
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

export const test = base.extend<GatewayFixture>({
  // eslint-disable-next-line no-empty-pattern
  gatewayPort: async ({}, use) => {
    const repoRoot = resolveRepoRoot();
    const port = resolveGatewayPortFromEnv() ?? await reservePort();
    const runner = spawn(
      "bun",
      ["run", RUNNER_RELATIVE_PATH],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          GUI_GATEWAY_PORT: String(port),
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
  },
});

export { expect } from "@playwright/test";
