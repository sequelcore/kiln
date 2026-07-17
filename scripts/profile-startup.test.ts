import { execFile as execFileCallback } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(import.meta.dirname, "..");

test("profiles the first usable GUI interaction when browser measurement is enabled", async () => {
  const gatewayPort = await reservePort();
  const guiPort = await reservePort();
  const { stdout } = await execFile("bun", [
    "run",
    "scripts/profile-startup.ts",
    "--mode",
    "dev",
    "--cwd",
    repoRoot,
    "--port",
    String(gatewayPort),
    "--gui-port",
    String(guiPort),
    "--timeout-ms",
    "30000",
    "--measure-first-paint",
    "--no-open",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 40_000,
  });

  const profile = JSON.parse(stdout) as {
    command: { measureFirstPaint?: boolean };
    timings: {
      firstUsablePaintMs?: number;
      browserResourceSummary?: {
        count: number;
        slowest: Array<{ name: string; durationMs: number }>;
      };
      milestones: Array<{ name: string; atMs: number }>;
    };
  };
  expect(profile.command.measureFirstPaint).toBe(true);
  expect(profile.timings.firstUsablePaintMs).toBeGreaterThan(0);
  expect(profile.timings.browserResourceSummary?.count).toBeGreaterThan(0);
  expect(profile.timings.browserResourceSummary?.slowest.length).toBeGreaterThan(0);
  expect(profile.timings.browserResourceSummary?.slowest[0]?.durationMs).toBeGreaterThanOrEqual(0);
  expect(profile.timings.browserResourceSummary?.slowest[0]?.name).toMatch(/^\/gui\//u);
  expect(profile.timings.milestones.map((milestone) => milestone.name)).toContain("browser-ready");
  expect(profile.timings.milestones.map((milestone) => milestone.name)).toContain("gui-first-usable-interaction");
}, 45_000);

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a startup profile port");
  }
  return address.port;
}
