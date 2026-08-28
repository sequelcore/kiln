import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

type ToolName = "rg" | "fd" | "jq" | "oxlint";

interface ToolManifestEntry {
  readonly path: string;
  readonly version: string;
  readonly source: string;
  readonly archiveSha256: string;
  readonly binarySha256: string;
  readonly sourceType?: "archive" | "file";
  readonly archivePath?: string;
}

interface ToolsManifest {
  readonly tools: Partial<Record<ToolName, ToolManifestEntry>>;
}

interface PlatformPackage {
  readonly packageRoot: string;
  readonly manifestPath: string;
}

const PLATFORM_PACKAGE_DIRS = [
  "packages/tools-win32-x64",
  "packages/tools-linux-x64",
  "packages/tools-darwin-arm64",
  "packages/tools-darwin-x64",
] as const;

const root = resolve(import.meta.dir, "..");

await vendorTools();

async function vendorTools(): Promise<void> {
  for (const platformPackage of platformPackages()) {
    const manifest = await readManifest(platformPackage.manifestPath);
    for (const [toolName, entry] of Object.entries(manifest.tools)) {
      if (!entry) {
        continue;
      }
      await vendorTool(platformPackage, toolName as ToolName, entry);
    }
  }
}

function platformPackages(): readonly PlatformPackage[] {
  return PLATFORM_PACKAGE_DIRS.map((packageDir) => {
    const packageRoot = resolve(root, packageDir);
    return {
      packageRoot,
      manifestPath: join(packageRoot, "tools.json"),
    };
  });
}

async function readManifest(path: string): Promise<ToolsManifest> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.tools)) {
    throw new Error(`Invalid tools manifest: ${path}`);
  }

  const tools: Partial<Record<ToolName, ToolManifestEntry>> = {};
  for (const toolName of ["rg", "fd", "jq", "oxlint"] as const) {
    const entry = parsed.tools[toolName];
    if (entry === undefined) {
      continue;
    }
    if (!isToolManifestEntry(entry)) {
      throw new Error(`Invalid ${toolName} manifest entry: ${path}`);
    }
    tools[toolName] = entry;
  }

  return { tools };
}

async function vendorTool(
  platformPackage: PlatformPackage,
  toolName: ToolName,
  entry: ToolManifestEntry,
): Promise<void> {
  assertSafePackageRelativePath(entry.path, "path");
  if (entry.archivePath !== undefined) {
    assertSafePackageRelativePath(entry.archivePath, "archivePath");
  }

  const workDir = await mkdtemp(join(tmpdir(), "kiln-tools-"));
  const downloadedPath = join(workDir, basename(new URL(entry.source).pathname));
  const extractDir = join(workDir, "extract");

  try {
    await download(entry.source, downloadedPath);
    await verifySha256(downloadedPath, entry.archiveSha256, "archive");
    const destinationPath = resolve(platformPackage.packageRoot, entry.path);
    assertInsideDirectory(destinationPath, platformPackage.packageRoot, "path");

    const sourceBinaryPath = await resolveDownloadedBinary(downloadedPath, extractDir, entry);
    await verifySha256(sourceBinaryPath, entry.binarySha256, "materialized binary");
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(sourceBinaryPath, destinationPath);
    if (!destinationPath.endsWith(".exe")) {
      await chmod(destinationPath, 0o755);
    }
    await verifySha256(destinationPath, entry.binarySha256, "materialized binary");

    console.log(`Vendored ${toolName} ${entry.version} -> ${destinationPath}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function resolveDownloadedBinary(
  downloadedPath: string,
  extractDir: string,
  entry: ToolManifestEntry,
): Promise<string> {
  if ((entry.sourceType ?? "archive") === "file") {
    await stat(downloadedPath);
    return downloadedPath;
  }

  if (!entry.archivePath) {
    throw new Error(`archivePath is required for archive source: ${entry.source}`);
  }

  await mkdir(extractDir, { recursive: true });
  await extractArchive(downloadedPath, extractDir);

  const extractedBinaryPath = resolve(extractDir, entry.archivePath);
  assertInsideDirectory(extractedBinaryPath, extractDir, "archivePath");
  await stat(extractedBinaryPath);
  return extractedBinaryPath;
}

async function download(url: string, destinationPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "kiln-vendor-tools",
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  await pipeline(response.body, createWriteStream(destinationPath));
}

async function verifySha256(path: string, expectedSha256: string, artifact: string): Promise<void> {
  const actualSha256 = createHash("sha256").update(await readFile(path)).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(`SHA-256 mismatch for ${artifact} ${path}: expected ${expectedSha256}, got ${actualSha256}`);
  }
}

async function extractArchive(archivePath: string, destinationDir: string): Promise<void> {
  await run("tar", ["-xf", archivePath, "-C", destinationDir]);
}

async function run(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, [...args], {
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

function isToolManifestEntry(value: unknown): value is ToolManifestEntry {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.version === "string" &&
    typeof value.source === "string" &&
    (value.sourceType === undefined || value.sourceType === "archive" || value.sourceType === "file") &&
    (value.sourceType === "file" || typeof value.archivePath === "string") &&
    typeof value.archiveSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.archiveSha256) &&
    typeof value.binarySha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.binarySha256)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSafePackageRelativePath(path: string, fieldName: string): void {
  const segments = path.split(/[\\/]+/u);
  if (isAbsolute(path) || segments.includes("..")) {
    throw new Error(`Unsafe ${fieldName}: ${path}`);
  }
}

function assertInsideDirectory(path: string, directory: string, fieldName: string): void {
  const relativePath = relative(directory, path);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${fieldName} escapes target directory: ${path}`);
  }
}
