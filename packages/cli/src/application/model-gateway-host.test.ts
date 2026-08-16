import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalModelGatewayHostIdentity,
  expectedModelGatewayHost,
  MODEL_GATEWAY_HOST_REVISION,
  MODEL_GATEWAY_HOST_SHA256,
  MODEL_GATEWAY_HOST_VERSION,
  resolveModelGatewayHost,
} from "./model-gateway-host.js";

/**
 * The admitted host artifact is intentionally Windows x64 only. Pin the platform
 * through the production seam so these cases assert host resolution rather than
 * the operating system the suite happens to run on; the rejection of
 * unadmitted platforms has its own case below.
 */
const ADMITTED_PLATFORM = { platform: "win32", arch: "x64" } as const;

describe("resolveModelGatewayHost", () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("publishes only an approved bundled artifact and records a relative executable with the canonical host identity", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-host-"));
    const inspect = {
      inspect: vi.fn(async (_executable: string, args: readonly string[]) =>
        args[0] === "--version" ? MODEL_GATEWAY_HOST_VERSION : MODEL_GATEWAY_HOST_REVISION,
      ),
    };

    const resolved = await resolveModelGatewayHost({
      ...ADMITTED_PLATFORM,
      runtimeDir: root,
      bundledArtifact: Uint8Array.from([1, 2, 3]),
      inspect,
      calculateSha256: () => MODEL_GATEWAY_HOST_SHA256,
    });

    expect(resolved.host).toEqual(canonicalModelGatewayHostIdentity());
    expect(resolved.source).toBe("bundled");
    expect(resolved.executable).toBe(join(root, "model-gateway-hosts", MODEL_GATEWAY_HOST_SHA256, "bun.exe"));
    expect(
      JSON.parse(await readFile(join(root, "model-gateway-hosts", MODEL_GATEWAY_HOST_SHA256, "manifest.json"), "utf8")),
    ).toEqual({
      schemaVersion: 1,
      executable: "bun.exe",
      host: canonicalModelGatewayHostIdentity(),
    });
    expect(inspect.inspect).toHaveBeenCalledTimes(2);
  });

  it("revalidates the installed bytes and executable identity on every resolution", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-host-"));
    const inspect = {
      inspect: vi.fn(async (_executable: string, args: readonly string[]) =>
        args[0] === "--version" ? MODEL_GATEWAY_HOST_VERSION : MODEL_GATEWAY_HOST_REVISION,
      ),
    };
    const input = {
      ...ADMITTED_PLATFORM,
      runtimeDir: root,
      bundledArtifact: Uint8Array.from([1]),
      inspect,
      calculateSha256: () => MODEL_GATEWAY_HOST_SHA256,
    };
    await resolveModelGatewayHost(input);
    await resolveModelGatewayHost({ ...input, bundledArtifact: undefined });
    expect(inspect.inspect).toHaveBeenCalledTimes(4);
  });

  it("migrates only the exact predecessor source and platform-package identity", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-host-"));
    const inspect = {
      inspect: vi.fn(async (_executable: string, args: readonly string[]) =>
        args[0] === "--version" ? MODEL_GATEWAY_HOST_VERSION : MODEL_GATEWAY_HOST_REVISION,
      ),
    };
    await resolveModelGatewayHost({
      ...ADMITTED_PLATFORM,
      runtimeDir: root,
      bundledArtifact: Uint8Array.from([1]),
      inspect,
      calculateSha256: () => MODEL_GATEWAY_HOST_SHA256,
    });
    const manifestPath = join(root, "model-gateway-hosts", MODEL_GATEWAY_HOST_SHA256, "manifest.json");
    const predecessor = JSON.parse(await readFile(manifestPath, "utf8"));
    predecessor.host.source = "repository";
    predecessor.host.packageName = "@kilnai/model-gateway-host";
    await writeFile(manifestPath, JSON.stringify(predecessor));

    await expect(
      resolveModelGatewayHost({ ...ADMITTED_PLATFORM, runtimeDir: root, inspect, calculateSha256: () => MODEL_GATEWAY_HOST_SHA256 }),
    ).resolves.toMatchObject({
      host: { source: "bundled" },
    });
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toMatchObject({ host: { source: "bundled" } });
  });

  it("fails closed without a bundled artifact", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-host-"));
    await expect(resolveModelGatewayHost({ ...ADMITTED_PLATFORM, runtimeDir: root })).rejects.toThrow(
      "No approved bundled model gateway host",
    );
  });

  it("rejects platforms without an admitted host artifact before reading local state", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-host-"));
    await expect(
      resolveModelGatewayHost({ runtimeDir: root, platform: "linux", arch: "x64" }),
    ).rejects.toThrow("No approved model gateway host artifact");
  });

  it("derives a teardown reference without requiring the executable to be readable", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-host-"));
    expect(expectedModelGatewayHost(root)).toEqual({
      executable: join(root, "model-gateway-hosts", MODEL_GATEWAY_HOST_SHA256, "bun.exe"),
      host: canonicalModelGatewayHostIdentity(),
      source: "bundled",
    });
  });

  it("rejects an artifact whose bytes do not match the approved digest before execution", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-host-"));
    const inspect = { inspect: vi.fn() };
    await expect(
      resolveModelGatewayHost({ ...ADMITTED_PLATFORM, runtimeDir: root, bundledArtifact: Uint8Array.from([1]), inspect }),
    ).rejects.toThrow("SHA-256");
    expect(inspect.inspect).not.toHaveBeenCalled();
  });

  it("fails closed when an installed manifest tries to escape the content-addressed directory", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-model-gateway-host-"));
    const installed = join(root, "model-gateway-hosts", MODEL_GATEWAY_HOST_SHA256);
    await mkdir(installed, { recursive: true });
    await writeFile(
      join(installed, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, executable: "../bun.exe", host: canonicalModelGatewayHostIdentity() }),
    );

    await expect(resolveModelGatewayHost({ ...ADMITTED_PLATFORM, runtimeDir: root })).rejects.toThrow("single relative filename");
  });
});
