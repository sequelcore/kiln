import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readKilnYaml } from "../../src/kiln-yaml.js";
import { validateGlobalConfig } from "../../src/config/global-config.js";
import { resolveKilnMcpConfiguration } from "../../src/config/config-merger.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Kiln MCP configuration boundary", () => {
  it("rejects an invalid project MCP definition while reading kiln.yaml", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-mcp-project-"));
    tempDirectories.push(root);
    const kilnDir = join(root, ".kiln");
    mkdirSync(kilnDir);
    writeFileSync(join(kilnDir, "kiln.yaml"), [
      'version: "1"',
      "mcp:",
      "  servers:",
      "    invalid:",
      "      transport: stdio",
      "      url: https://example.com/mcp",
      "",
    ].join("\n"));

    expect(() => readKilnYaml(kilnDir)).toThrow(/MCP_TRANSPORT_FIELDS_MIXED/);
  });

  it("rejects an incomplete global MCP definition", () => {
    expect(() => validateGlobalConfig({
      version: "3",
      mcp: {
        servers: {
          incomplete: { transport: "stdio" },
        },
      },
    })).toThrow(/MCP_SERVER_DEFINITION_INCOMPLETE/);
  });

  it("rejects unknown server fields and malformed nested policy at the YAML boundary", () => {
    expect(() => validateGlobalConfig({
      version: "3",
      mcp: {
        servers: {
          invalid: {
            transport: "stdio",
            command: "fixture",
            type: "stdio",
          },
        },
      },
    })).toThrow(/Unknown mcp\.servers\.invalid field: type/);

    expect(() => validateGlobalConfig({
      version: "3",
      mcp: {
        servers: {
          invalid: {
            transport: "stdio",
            command: "fixture",
            admission: { state: "admitted", tools: { allow: "echo" } },
          },
        },
      },
    })).toThrow(/mcp\.servers\.invalid\.admission\.tools\.allow must be an array/);

    expect(() => validateGlobalConfig({
      version: "3",
      mcp: {
        servers: {
          invalid: {
            transport: "stdio",
            command: "fixture",
            admission: { state: "admitted", effects: { echo: { operation: "observe" } } },
          },
        },
      },
    })).toThrow(/admission\.effects\.echo must be a complete valid action-effect envelope/);
  });

  it("resolves global and project sources without losing provenance", () => {
    const result = resolveKilnMcpConfiguration({
      globalConfig: {
        version: "3",
        mcp: {
          servers: {
            studio: {
              transport: "stdio",
              command: "cmd.exe",
              args: ["/c", "%LOCALAPPDATA%\\Roblox\\mcp.bat"],
            },
          },
        },
      },
      globalPath: "C:\\Users\\operator\\.kiln\\config.yaml",
      projectConfig: {
        version: "1",
        mcp: {
          servers: {
            studio: {
              admission: { state: "admitted", tools: { allow: ["inspect_tree"] } },
            },
          },
        },
      },
      projectPath: "C:\\workspace\\.kiln\\kiln.yaml",
      environment: { LOCALAPPDATA: "C:\\Users\\operator\\AppData\\Local" },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.servers.studio).toMatchObject({
      source: "overridden",
      command: "cmd.exe",
      admission: { state: "admitted", tools: { allow: ["inspect_tree"] } },
    });
    expect(result.servers.studio?.provenance.command).toMatchObject({ scope: "global" });
    expect(result.servers.studio?.provenance.admission).toMatchObject({ scope: "project" });
  });

  it("parses every canonical MCP project bundled with the App Gateway examples", () => {
    const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
    for (const example of ["support-agent", "booking-assistant", "research-brief", "incident-triage"]) {
      const config = readKilnYaml(join(repositoryRoot, "docs", "examples", example, ".kiln"));
      expect(config?.mcp?.servers).toBeDefined();
    }
  });
});
