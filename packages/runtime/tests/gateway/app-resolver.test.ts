import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveApps } from "../../src/gateway/app-resolver.js";
import { readGatewayConfigurationSource } from "../../src/gateway/gateway-configuration-source.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, "fixtures");

function loadGatewaySource() {
  return readGatewayConfigurationSource(join(fixturesDir, "gateway.yaml"));
}

describe("resolveApps", () => {
  it("resolves relative config paths correctly", () => {
    const resolved = resolveApps(loadGatewaySource());

    expect(resolved).toHaveLength(2);
    expect(resolved[0]!.name).toBe("test-app-a");
    expect(resolved[1]!.name).toBe("test-app-b");
    expect(resolved[0]!.app.name).toBe("test-app-a");
    expect(resolved[1]!.app.name).toBe("test-app-b");
  });

  it("computes memory base paths below the explicit global Kiln home", () => {
    const kilnHome = join("C:\\synthetic", "xdg", "kiln");
    const resolved = resolveApps(loadGatewaySource(), { kilnHome });

    const expectedBase = join(kilnHome, "gateway");
    expect(resolved[0]!.memoryBasePath).toBe(join(expectedBase, "test-app-a"));
    expect(resolved[1]!.memoryBasePath).toBe(join(expectedBase, "test-app-b"));
  });

  it("includes binding information for each resolved app", () => {
    const resolved = resolveApps(loadGatewaySource());

    expect(resolved[0]!.binding.name).toBe("test-app-a");
    expect(resolved[0]!.binding.config).toBe("apps/app-a.yaml");
    expect(resolved[0]!.binding.channels[0]!.type).toBe("api");
  });

  it("throws on missing App YAML file", () => {
    const sourcePath = join(fixturesDir, "tmp", "missing-gateway.yaml");
    mkdirSync(dirname(sourcePath), { recursive: true });
    try {
      writeFileSync(sourcePath, "port: 4800\napps:\n  - name: missing-app\n    config: does-not-exist.yaml\n    channels:\n      - type: api\n        path: /api/missing\n");
      expect(() => readGatewayConfigurationSource(sourcePath)).toThrow("App 'missing-app' configuration file not found");
    } finally {
      rmSync(sourcePath, { force: true });
    }
  });

  it("throws on invalid App YAML content", () => {
    const tmpDir = join(fixturesDir, "tmp");
    try {
      mkdirSync(tmpDir, { recursive: true });
    } catch {
      // dir may already exist
    }
    const badYamlPath = join(tmpDir, "bad-app.yaml");
    writeFileSync(badYamlPath, "this: is: not: valid: yaml: content: [unclosed");

    const gatewayPath = join(tmpDir, "bad-gateway.yaml");
    try {
      writeFileSync(gatewayPath, "port: 4800\napps:\n  - name: bad-app\n    config: bad-app.yaml\n    channels:\n      - type: api\n        path: /api/bad\n");
      expect(() => resolveApps(readGatewayConfigurationSource(gatewayPath))).toThrow(`Failed to parse App config at ${badYamlPath}`);
    } finally {
      rmSync(gatewayPath, { force: true });
    }
  });

  it("resolves multiple apps independently", () => {
    const resolved = resolveApps(loadGatewaySource());

    // Each app is independent -- different names, different apps, different memory paths
    expect(resolved[0]!.name).not.toBe(resolved[1]!.name);
    expect(resolved[0]!.app.name).not.toBe(resolved[1]!.app.name);
    expect(resolved[0]!.memoryBasePath).not.toBe(resolved[1]!.memoryBasePath);

    // Each app has its own teams
    expect(Object.keys(resolved[0]!.app.teams)).toContain("default");
    expect(Object.keys(resolved[1]!.app.teams)).toContain("default");
  });
});
