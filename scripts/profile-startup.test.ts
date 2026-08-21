import { execFile as execFileCallback } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(import.meta.dirname, "..");

test("profiles the first usable GUI interaction when browser measurement is enabled", async () => {
  const gatewayPort = await reservePort();
  const guiPort = await reservePort();
  const configHome = await seedGlobalConfiguration();
  const stdout = await runStartupProfile(gatewayPort, guiPort, configHome)
    .finally(() => rm(configHome, { recursive: true, force: true }));

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
}, 75_000);

/**
 * The GUI refuses to start without a configured execution target, and a startup
 * benchmark that reads the operator's own configuration cannot be compared
 * between runs or machines. Point global configuration at a committed fixture so
 * every run profiles the same input. packages/cli keeps that fixture in step with
 * the configuration contract.
 */
async function seedGlobalConfiguration(): Promise<string> {
  const configHome = await mkdtemp(join(tmpdir(), "kiln-startup-profile-config-"));
  const kilnHome = join(configHome, "kiln");
  const sourceConfigPath = resolve(repoRoot, "scripts", "fixtures", "startup-profile-global-config.yaml");
  const configSource = await readFile(sourceConfigPath, "utf8");
  const evidenceRevision = configSource.match(/^[ \t]*evidenceRevision:[ \t]*["']?(sha256:[a-f0-9]{64})["']?[ \t]*$/mu)?.[1];
  if (!evidenceRevision) throw new Error("Startup profile fixture does not declare an execution-target evidence revision.");
  const evidenceDirectory = join(kilnHome, "evidence", "execution-targets");
  await mkdir(evidenceDirectory, { recursive: true });
  await copyFile(
    sourceConfigPath,
    join(kilnHome, "config.yaml"),
  );
  await copyFile(
    resolve(repoRoot, "scripts", "fixtures", "startup-profile-execution-target-evidence.json"),
    join(evidenceDirectory, `${evidenceRevision.slice("sha256:".length)}.json`),
  );
  return configHome;
}

async function runStartupProfile(
  gatewayPort: number,
  guiPort: number,
  configHome: string,
): Promise<string> {
  try {
    const result = await execFile("bun", [
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
      "60000",
      "--measure-first-paint",
      "--no-open",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 70_000,
      env: { ...process.env, XDG_CONFIG_HOME: configHome },
    });
    return result.stdout;
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new Error(
      [
        "GUI startup profile command failed",
        failure.stdout,
        failure.stderr,
        failure.message,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

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
