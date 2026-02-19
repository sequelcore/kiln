import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseGatewayYaml } from "@kiln/core";
import { resolveApps } from "../../src/gateway/app-resolver.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, "fixtures");

function loadGatewayConfig() {
  const content = readFileSync(join(fixturesDir, "gateway.yaml"), "utf-8");
  return parseGatewayYaml(content);
}

describe("resolveApps", () => {
  it("resolves relative config paths correctly", () => {
    const config = loadGatewayConfig();
    const resolved = resolveApps(config, fixturesDir);

    expect(resolved).toHaveLength(2);
    expect(resolved[0]!.name).toBe("test-app-a");
    expect(resolved[1]!.name).toBe("test-app-b");
    expect(resolved[0]!.app.name).toBe("test-app-a");
    expect(resolved[1]!.app.name).toBe("test-app-b");
  });

  it("computes memory base paths with app name prefix", () => {
    const config = loadGatewayConfig();
    const resolved = resolveApps(config, fixturesDir);

    const expectedBase = join(homedir(), ".temper", "gateway");
    expect(resolved[0]!.memoryBasePath).toBe(join(expectedBase, "test-app-a"));
    expect(resolved[1]!.memoryBasePath).toBe(join(expectedBase, "test-app-b"));
  });

  it("includes binding information for each resolved app", () => {
    const config = loadGatewayConfig();
    const resolved = resolveApps(config, fixturesDir);

    expect(resolved[0]!.binding.name).toBe("test-app-a");
    expect(resolved[0]!.binding.config).toBe("apps/app-a.yaml");
    expect(resolved[0]!.binding.channels[0]!.type).toBe("api");
  });

  it("throws on missing App YAML file", () => {
    const config = {
      port: 4800,
      apps: [
        {
          name: "missing-app",
          config: "apps/does-not-exist.yaml",
          channels: [{ type: "api", path: "/api/missing" }],
        },
      ],
    };

    expect(() => resolveApps(config, fixturesDir)).toThrow(
      "Failed to load App config at apps/does-not-exist.yaml: file not found",
    );
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

    const config = {
      port: 4800,
      apps: [
        {
          name: "bad-app",
          config: "tmp/bad-app.yaml",
          channels: [{ type: "api", path: "/api/bad" }],
        },
      ],
    };

    expect(() => resolveApps(config, fixturesDir)).toThrow("Failed to parse App config at tmp/bad-app.yaml");
  });

  it("resolves multiple apps independently", () => {
    const config = loadGatewayConfig();
    const resolved = resolveApps(config, fixturesDir);

    // Each app is independent -- different names, different apps, different memory paths
    expect(resolved[0]!.name).not.toBe(resolved[1]!.name);
    expect(resolved[0]!.app.name).not.toBe(resolved[1]!.app.name);
    expect(resolved[0]!.memoryBasePath).not.toBe(resolved[1]!.memoryBasePath);

    // Each app has its own teams
    expect(Object.keys(resolved[0]!.app.teams)).toContain("default");
    expect(Object.keys(resolved[1]!.app.teams)).toContain("default");
  });
});
