import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  assertCompleteBundle,
  assertPackedToolExecutables,
  assertPackedLegalFiles,
  assertTrustedPublishingEnvironment,
  buildReleasePlan,
  buildWorkspaceOrder,
  calculateIntegrity,
  discoverPackages,
  inferReleaseIdentity,
  isCleanSmokeTermination,
  parseReleaseRef,
  prepareStaging,
  selectInstallTarballs,
  validateRegistryState,
  type RegistryPackageState,
  type PackedFileMetadata,
  type ReleasePlan,
  type ReleaseTarball,
} from "./release.js";
import {
  assertModelGatewayHostReleaseArtifact,
  assertModelGatewayHostReleaseBundle,
} from "./model-gateway-host-artifact.js";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const packagesRoot = join(repositoryRoot, "packages");
const releaseRoot = join(repositoryRoot, ".release");
const stageRoot = join(releaseRoot, "stage");
const bundleRoot = resolve(pathOption("--bundle") ?? join(releaseRoot, "bundle"));
const bundleManifestPath = join(bundleRoot, "release-bundle.json");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

interface ReleaseBundle extends ReleasePlan {
  readonly tarballs: readonly ReleaseTarball[];
}

const command = process.argv[2];
try {
  switch (command) {
    case "build":
      await buildWorkspace();
      break;
    case "validate":
      await validate();
      break;
    case "pack":
      await pack();
      break;
    case "smoke":
      await smoke();
      break;
    case "preflight":
      await preflight(await readBundle());
      break;
    case "publish":
      await publish();
      break;
    default:
      throw new Error("Usage: cli.ts <build|validate|pack|smoke|preflight|publish> [--ref vX.Y.Z] [--bundle path]");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

async function buildWorkspace(): Promise<void> {
  const records = await discoverPackages(packagesRoot);
  const builds = buildWorkspaceOrder(records);
  for (const build of builds) {
    try {
      const result = await execFile(
        process.execPath,
        ["run", "--cwd", join(packagesRoot, build.directory), "build"],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          maxBuffer: 50 * 1024 * 1024,
        },
      );
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      throw new Error(
        [
          `${build.name}: workspace build failed`,
          failure.stdout,
          failure.stderr,
          failure.message,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }
  console.log(`Built ${builds.length} workspaces in dependency order`);
}

// Validation answers whether the workspace forms one coherent release cohort.
// The Windows host artifact is produced during packaging, so requiring it here
// blocked every pull request on a binary that does not exist yet. pack() and
// publish() still assert it, and publishing remains impossible without it.
async function validate(): Promise<void> {
  const records = await discoverPackages(packagesRoot);
  const explicitRef = stringOption("--ref") ?? process.env.RELEASE_REF;
  const identity = explicitRef
    ? parseReleaseRef(explicitRef)
    : inferReleaseIdentity(records);
  const plan = buildReleasePlan(records, identity);
  console.log(
    `Validated ${plan.packages.length}-package ${plan.version} cohort for npm dist-tag ${plan.distTag}:\n` +
      plan.packages.map((pkg, index) => `${index + 1}. ${pkg.name}`).join("\n"),
  );
}

async function pack(): Promise<void> {
  await assertModelGatewayHostReleaseArtifact(join(packagesRoot, "model-gateway-host-win32-x64"));
  const records = await discoverPackages(packagesRoot);
  const explicitRef =
    stringOption("--ref") ??
    process.env.RELEASE_REF ??
    process.env.GITHUB_REF_NAME;
  const identity = explicitRef
    ? parseReleaseRef(explicitRef)
    : inferReleaseIdentity(records);
  const plan = buildReleasePlan(records, identity);
  await rm(releaseRoot, { recursive: true, force: true });
  await mkdir(bundleRoot, { recursive: true });
  await prepareStaging(plan, packagesRoot, stageRoot);

  const tarballs: ReleaseTarball[] = [];
  for (const pkg of plan.packages) {
    const result = await runNpm([
      "pack",
      join(stageRoot, pkg.directory),
      "--json",
      "--pack-destination",
      bundleRoot,
    ]);
    const packed = parsePackOutput(result.stdout, pkg.name);
    assertPackedLegalFiles(pkg, packed.files.map((file) => file.path));
    assertPackedToolExecutables(pkg, packed.files);
    const integrity = await calculateIntegrity(join(bundleRoot, packed.filename));
    if (packed.integrity !== integrity) {
      throw new Error(`${pkg.name}: npm pack integrity ${packed.integrity} does not match local ${integrity}`);
    }
    tarballs.push({ name: pkg.name, version: pkg.version, filename: packed.filename, integrity });
  }
  assertCompleteBundle(plan, tarballs);
  await writeFile(bundleManifestPath, `${JSON.stringify({ ...plan, tarballs }, null, 2)}\n`);
  console.log(`Packed complete ${plan.version} release bundle with ${tarballs.length} tarballs`);
}

async function smoke(): Promise<void> {
  const bundle = await readBundle();
  const smokeRoot = await mkdtemp(join(tmpdir(), "kiln-release-smoke-"));
  try {
    await writeFile(
      join(smokeRoot, "package.json"),
      `${JSON.stringify({ name: "kiln-release-smoke", version: "0.0.0", private: true }, null, 2)}\n`,
    );
    const installTarballs = selectInstallTarballs(
      bundle,
      bundle.tarballs,
      process.platform,
      process.arch,
    );
    const tarballPaths = installTarballs.map((tarball) => join(bundleRoot, tarball.filename));
    await runNpm(["install", "--no-audit", "--no-fund", ...tarballPaths], smokeRoot);
    for (const tarball of installTarballs) {
      const installedManifest = JSON.parse(
        await readFile(join(smokeRoot, "node_modules", ...tarball.name.split("/"), "package.json"), "utf8"),
      ) as { name?: string; version?: string };
      if (installedManifest.name !== tarball.name || installedManifest.version !== bundle.version) {
        throw new Error(`${tarball.name}: clean install did not contain ${tarball.name}@${bundle.version}`);
      }
    }
    const cliManifest = JSON.parse(
      await readFile(join(smokeRoot, "node_modules", "@kilnai", "cli", "package.json"), "utf8"),
    ) as { bin?: Record<string, string> };
    if (!cliManifest.bin?.kiln) {
      throw new Error("@kilnai/cli clean install is missing the kiln executable");
    }
    await smokePublishedImports(smokeRoot);
    const versionResult = await runNpm(["exec", "--offline", "--", "kiln", "--version"], smokeRoot);
    if (!versionResult.stdout.includes(`kiln ${bundle.version}`)) {
      throw new Error(`Packaged kiln --version did not report ${bundle.version}`);
    }
    await smokePackagedGui(smokeRoot);
    console.log(
      `Clean-install and runtime smoke passed for ${installTarballs.length} host-compatible packages on ` +
        `${process.platform}-${process.arch}; all ${bundle.tarballs.length} bundle integrities verified`,
    );
  } finally {
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

async function smokePublishedImports(smokeRoot: string): Promise<void> {
  const script = `
    const names = [
      "@kilnai/gateway-contracts",
      "@kilnai/core",
      "@kilnai/runtime",
      "@kilnai/react",
      "@kilnai/tui",
      "@kilnai/tools"
    ];
    for (const name of names) {
      const surface = await import(name);
      if (Object.keys(surface).length === 0) throw new Error(name + " exported an empty surface");
    }
    const widget = await import("@kilnai/widget");
    if (typeof widget.KilnWidget !== "function") throw new Error("@kilnai/widget export is unavailable");
    const tools = await import("@kilnai/tools");
    const platformPackage = tools.resolveVendoredPlatformPackage();
    if (!platformPackage) throw new Error("No vendored package resolved for the current platform");
    if (platformPackage.platform !== process.platform || platformPackage.arch !== process.arch) {
      throw new Error("Vendored package resolved for the wrong platform");
    }
    for (const binary of platformPackage.binaries) {
      const resolved = tools.resolveVendoredToolBinary(binary);
      if (!resolved || resolved.packageName !== platformPackage.packageName) {
        throw new Error("Could not resolve vendored " + binary);
      }
      const child = Bun.spawnSync([resolved.path, "--version"], { stdout: "pipe", stderr: "pipe" });
      if (child.exitCode !== 0) throw new Error("Vendored " + binary + " failed --version");
    }
  `;
  await execFile(process.execPath, ["--eval", script], {
    cwd: smokeRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function smokePackagedGui(smokeRoot: string): Promise<void> {
  const home = join(smokeRoot, "home");
  await mkdir(home, { recursive: true });
  const port = await reservePort();
  const cliEntry = join(smokeRoot, "node_modules", "@kilnai", "cli", "dist", "index.js");
  const child = spawn(
    process.execPath,
    [cliEntry, "gui", "--prod", "--no-open", "--port", String(port)],
    {
      cwd: smokeRoot,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_DATA_HOME: join(home, ".local", "share"),
        LOCALAPPDATA: join(home, "AppData", "Local"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output = appendBounded(output, String(chunk));
  });
  child.stderr?.on("data", (chunk) => {
    output = appendBounded(output, String(chunk));
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });

  try {
    await waitForGuiReadiness(port, exited, () => output);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }
  const result = await Promise.race([
    exited,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Packaged GUI did not terminate cleanly\n${output}`)), 10_000),
    ),
  ]);
  if (!isCleanSmokeTermination(result)) {
    throw new Error(`Packaged GUI exited with code ${result.code} signal ${result.signal ?? "none"}\n${output}`);
  }
}

async function waitForGuiReadiness(
  port: number,
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const prematureExit = await Promise.race([
      exited.then((result) => result),
      new Promise<null>((resolveDelay) => setTimeout(() => resolveDelay(null), 250)),
    ]);
    if (prematureExit) {
      throw new Error(
        `Packaged GUI exited before readiness with code ${prematureExit.code}\n${output()}`,
      );
    }
    try {
      const [health, gui] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/health`),
        fetch(`http://127.0.0.1:${port}/gui/`),
      ]);
      if (health.ok && gui.ok && (await gui.text()).includes("<!doctype html>")) {
        return;
      }
    } catch {
      // Startup is still in progress.
    }
  }
  throw new Error(`Packaged GUI did not become ready within 30 seconds\n${output()}`);
}

async function reservePort(): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a GUI smoke port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

function appendBounded(current: string, chunk: string): string {
  const combined = current + chunk;
  return combined.length <= 32_000 ? combined : combined.slice(-32_000);
}

async function preflight(bundle: ReleaseBundle): Promise<Map<string, RegistryPackageState>> {
  const states = new Map<string, RegistryPackageState>();
  for (const tarball of bundle.tarballs) {
    const state = await registryState(tarball.name, tarball.version, bundle.distTag);
    validateRegistryState(tarball, state, bundle.distTag);
    states.set(tarball.name, state);
  }
  console.log(`Registry preflight passed for all ${bundle.tarballs.length} packages`);
  return states;
}

async function publish(): Promise<void> {
  assertTrustedPublishingEnvironment(process.env);
  const bundle = await readBundle();
  assertModelGatewayHostReleaseBundle(bundle);
  const states = await preflight(bundle);
  for (const pkg of bundle.packages) {
    const tarball = bundle.tarballs.find((candidate) => candidate.name === pkg.name)!;
    const state = states.get(pkg.name)!;
    const action = validateRegistryState(tarball, state, bundle.distTag);
    if (action === "publish") {
      await runNpm([
        "publish",
        join(bundleRoot, tarball.filename),
        "--access",
        "public",
        "--provenance",
        "--tag",
        bundle.distTag,
      ]);
      console.log(`Published ${pkg.name}@${bundle.version}`);
    } else {
      console.log(`Skipped integrity-matching ${pkg.name}@${bundle.version}`);
      if (state.channelVersion !== bundle.version) {
        await runNpm(["dist-tag", "add", `${pkg.name}@${bundle.version}`, bundle.distTag]);
      }
    }
  }
  for (const pkg of bundle.packages) {
    const channelVersion = await npmView(pkg.name, `dist-tags.${bundle.distTag}`);
    if (channelVersion !== bundle.version) {
      throw new Error(
        `${pkg.name}: npm dist-tag ${bundle.distTag} is ${channelVersion ?? "absent"}, expected ${bundle.version}`,
      );
    }
  }
  console.log(`Published and validated complete ${bundle.version} cohort on ${bundle.distTag}`);
}

async function readBundle(): Promise<ReleaseBundle> {
  const bundle = JSON.parse(await readFile(bundleManifestPath, "utf8")) as ReleaseBundle;
  const identity = parseReleaseRef(`v${bundle.version}`);
  if (identity.distTag !== bundle.distTag) {
    throw new Error(`Release bundle dist-tag ${bundle.distTag} does not match version ${bundle.version}`);
  }
  assertCompleteBundle(bundle, bundle.tarballs);
  for (const tarball of bundle.tarballs) {
    const actual = await calculateIntegrity(join(bundleRoot, tarball.filename));
    if (actual !== tarball.integrity) {
      throw new Error(`${tarball.name}: downloaded tarball integrity does not match release bundle`);
    }
  }
  return bundle;
}

async function registryState(
  name: string,
  version: string,
  distTag: ReleasePlan["distTag"],
): Promise<RegistryPackageState> {
  return {
    versionIntegrity: await npmView(`${name}@${version}`, "dist.integrity"),
    channelVersion: await npmView(name, `dist-tags.${distTag}`),
  };
}

async function npmView(spec: string, field: string): Promise<string | null> {
  try {
    const result = await runNpm(["view", spec, field, "--json"]);
    const value = JSON.parse(result.stdout || "null") as unknown;
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("E404") || message.includes("is not in this registry")) {
      return null;
    }
    throw error;
  }
}

async function runNpm(
  args: readonly string[],
  cwd = repositoryRoot,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFile(npm, [...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new Error(
      [`npm ${args.join(" ")} failed`, failure.stdout, failure.stderr, failure.message]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function parsePackOutput(
  stdout: string,
  expectedName: string,
): { filename: string; integrity: string; files: readonly PackedFileMetadata[] } {
  const value = JSON.parse(stdout) as Array<{
    name?: string;
    filename?: string;
    integrity?: string;
    files?: Array<{ path?: string; mode?: number }>;
  }>;
  const packed = value[0];
  if (
    value.length !== 1 ||
    packed?.name !== expectedName ||
    typeof packed.filename !== "string" ||
    typeof packed.integrity !== "string" ||
    !Array.isArray(packed.files) ||
    packed.files.some((file) => typeof file.path !== "string" || !Number.isSafeInteger(file.mode))
  ) {
    throw new Error(`${expectedName}: npm pack returned invalid metadata`);
  }
  return {
    filename: packed.filename,
    integrity: packed.integrity,
    files: packed.files.map((file) => ({ path: file.path!, mode: file.mode! })),
  };
}

function stringOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function pathOption(name: string): string | undefined {
  const value = stringOption(name);
  return value === undefined ? undefined : isAbsolute(value) ? value : resolve(repositoryRoot, value);
}
