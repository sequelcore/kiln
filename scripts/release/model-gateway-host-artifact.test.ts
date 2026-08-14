import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import cliPackage from "../../packages/cli/package.json" with { type: "json" };
import {
  MODEL_GATEWAY_HOST_REVISION,
  MODEL_GATEWAY_HOST_SHA256,
  MODEL_GATEWAY_HOST_VERSION,
} from "../../packages/cli/src/application/model-gateway-host.js";
import {
  assertModelGatewayHostReleaseArtifact,
  assertModelGatewayHostReleaseBundle,
} from "./model-gateway-host-artifact.js";

describe("assertModelGatewayHostReleaseArtifact", () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("blocks public packaging when the platform artifact is absent", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-release-host-"));
    await expect(assertModelGatewayHostReleaseArtifact(root)).rejects.toThrow("packaging is blocked");
  });

  it("admits only the exact platform manifest and approved artifact digest", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-release-host-"));
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(join(root, "bin", "bun.exe"), Uint8Array.from([1, 2, 3]));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "@kilnai/model-gateway-host-win32-x64",
        version: cliPackage.version,
        os: ["win32"],
        cpu: ["x64"],
        files: ["bin/bun.exe", "host.json"],
      }),
    );
    await writeFile(
      join(root, "host.json"),
      JSON.stringify({
        schemaVersion: 1,
        version: MODEL_GATEWAY_HOST_VERSION,
        revision: MODEL_GATEWAY_HOST_REVISION,
        sha256: MODEL_GATEWAY_HOST_SHA256,
      }),
    );
    await expect(assertModelGatewayHostReleaseArtifact(root, () => MODEL_GATEWAY_HOST_SHA256)).resolves.toBeUndefined();
    await expect(assertModelGatewayHostReleaseArtifact(root, () => "0".repeat(64))).rejects.toThrow("digest");
  });

  it("blocks publishing a bundle that omits the admitted platform artifact", () => {
    expect(() =>
      assertModelGatewayHostReleaseBundle({ version: cliPackage.version, packages: [], tarballs: [] }),
    ).toThrow("publishing is blocked");

    expect(() =>
      assertModelGatewayHostReleaseBundle({
        version: cliPackage.version,
        packages: [{ name: "@kilnai/model-gateway-host-win32-x64" }],
        tarballs: [{ name: "@kilnai/model-gateway-host-win32-x64", version: cliPackage.version }],
      }),
    ).not.toThrow();
  });
});
