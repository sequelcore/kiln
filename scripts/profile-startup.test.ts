import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");

test("profiles the first usable GUI interaction when browser measurement is enabled", async () => {
  const gatewayPort = await reservePort();
  const guiPort = await reservePort();
  const child = Bun.spawn([
    "bun",
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
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  expect(exitCode, stderr).toBe(0);
  const profile = JSON.parse(stdout) as {
    command: { measureFirstPaint?: boolean };
    timings: {
      firstUsablePaintMs?: number;
      milestones: Array<{ name: string; atMs: number }>;
    };
  };
  expect(profile.command.measureFirstPaint).toBe(true);
  expect(profile.timings.firstUsablePaintMs).toBeGreaterThan(0);
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
