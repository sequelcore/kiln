import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readGatewayConfigurationSource } from "../../src/gateway/gateway-configuration-source.js";

describe("gateway configuration source", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("captures one exact gateway-plus-app revision from admitted source bytes", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-gateway-source-"));
    const appPath = join(root, "app.yaml");
    const configPath = join(root, "gateway.yaml");
    const appBytes = await readFile(appFixturePath(), "utf8");
    await writeFile(appPath, appBytes, "utf8");
    await writeFile(configPath, gatewayYaml(), "utf8");

    const first = readGatewayConfigurationSource(configPath);

    expect(first.configurationRevision).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.gateway).toMatchObject({ path: configPath, bytes: gatewayYaml() });
    expect(first.apps).toEqual([
      expect.objectContaining({ name: "app", path: appPath, bytes: appBytes }),
    ]);

    await writeFile(appPath, `${appBytes}\n# exact revision change\n`, "utf8");
    const second = readGatewayConfigurationSource(configPath);
    expect(second.configurationRevision).not.toBe(first.configurationRevision);
  });

  it("does not serialize source paths or configuration values into the revision identity", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-gateway-source-"));
    const appPath = join(root, "app.yaml");
    const configPath = join(root, "gateway.yaml");
    await writeFile(appPath, await readFile(appFixturePath(), "utf8"), "utf8");
    await writeFile(configPath, gatewayYaml(), "utf8");

    const source = readGatewayConfigurationSource(configPath);

    expect(source.configurationRevision).not.toContain(root);
    expect(source.configurationRevision).not.toContain("gateway.yaml");
    expect(source.configurationRevision).not.toContain("app.yaml");
  });
});

function gatewayYaml(): string {
  return "port: 4800\napps:\n  - name: app\n    config: app.yaml\n    channels:\n      - type: api\n        path: /app\n";
}

function appFixturePath(): string {
  return fileURLToPath(new URL("./fixtures/apps/app-a.yaml", import.meta.url));
}
