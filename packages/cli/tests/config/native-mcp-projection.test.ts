import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { resolveMcpConfiguration, type McpConfigurationResolution, type ResolvedMcpServer } from "@kilnai/core";
import { projectMcpServer } from "../../src/config/native-mcp-projection.js";
import {
  assertNativeMcpProjectionCurrent,
  syncNativeMcpProjections,
  uninstallNativeMcpProjections,
} from "../../src/config/native-mcp-projection-sync.js";
import * as nativeProjectionState from "../../src/config/native-projection-state.js";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function server(overrides: Partial<ResolvedMcpServer> = {}): ResolvedMcpServer {
  return {
    id: "studio",
    enabled: true,
    transport: "stdio",
    command: "cmd.exe",
    args: ["/c", "C:\\Users\\operator\\AppData\\Local\\Roblox\\mcp.bat"],
    admission: { state: "admitted", tools: { allow: ["inspect_tree"], deny: ["subagent"] } },
    trust: "local",
    source: "project",
    provenance: {},
    connection: { state: "not-tested" },
    projection: { state: "not-synchronized" },
    ...overrides,
  };
}

describe("native MCP projection compatibility", () => {
  it("projects the Roblox-compatible stdio definition to Codex without splitting arguments", () => {
    expect(projectMcpServer("codex", server())).toEqual({
      status: "compatible",
      entry: {
        command: "cmd.exe",
        args: ["/c", "C:\\Users\\operator\\AppData\\Local\\Roblox\\mcp.bat"],
        enabled: true,
        default_tools_approval_mode: "prompt",
        enabled_tools: ["inspect_tree"],
        disabled_tools: ["subagent"],
      },
    });
  });

  it("projects Streamable HTTP environment header references for every verified harness", () => {
    const http = server({
      id: "docs",
      transport: "streamable-http",
      command: undefined,
      args: undefined,
      url: "https://mcp.example.com/mcp",
      headers: {
        Authorization: { fromEnv: "MCP_TOKEN" },
        "X-Workspace": { value: "kiln" },
      },
      admission: { state: "admitted" },
    });

    expect(projectMcpServer("codex", http)).toMatchObject({
      status: "compatible",
      entry: {
        url: "https://mcp.example.com/mcp",
        http_headers: { "X-Workspace": "kiln" },
        env_http_headers: { Authorization: "MCP_TOKEN" },
        default_tools_approval_mode: "prompt",
      },
    });
    expect(projectMcpServer("claude", http)).toMatchObject({
      status: "compatible",
      entry: { type: "http", headers: { Authorization: "${MCP_TOKEN}", "X-Workspace": "kiln" } },
    });
    expect(projectMcpServer("opencode", http)).toMatchObject({
      status: "compatible",
      entry: { type: "remote", headers: { Authorization: "{env:MCP_TOKEN}", "X-Workspace": "kiln" } },
    });
  });

  it("reports disabled, credential-only, and semantically unrepresentable definitions explicitly", () => {
    expect(projectMcpServer("codex", server({ enabled: false }))).toMatchObject({ status: "disabled" });
    expect(projectMcpServer("claude", server())).toMatchObject({
      status: "incompatible",
      reason: expect.stringContaining("tool admission"),
    });
    expect(projectMcpServer("opencode", server({
      admission: { state: "admitted" },
      env: { TOKEN: { fromCredential: "studio-token" } },
    }))).toMatchObject({
      status: "incompatible",
      reason: expect.stringContaining("credential"),
    });
    expect(projectMcpServer("codex", server({
      admission: {
        state: "admitted",
        effects: {
          inspect_tree: {
            operation: "observe", boundaries: ["external-system"], reversibility: "reversible",
            dataEgress: "none", identityUse: "none", consequences: [], idempotency: "idempotent",
          },
        },
      },
    }))).toMatchObject({ status: "incompatible", reason: expect.stringContaining("action-effect") });
    expect(projectMcpServer("codex", server({ maxCapabilities: 32 }))).toMatchObject({
      status: "incompatible",
      reason: expect.stringContaining("catalog limit"),
    });
  });
});

function resolution(): McpConfigurationResolution {
  return resolveMcpConfiguration({
    project: {
      scope: "project",
      sourcePath: "C:/repo/.kiln/kiln.yaml",
      servers: {
        "studio.v2": {
          transport: "stdio",
          command: "cmd.exe",
          args: ["/c", "C:\\Roblox\\mcp.bat"],
          admission: { state: "admitted", tools: { allow: ["inspect_tree"] } },
        },
      },
    },
  });
}

function portableResolution(): McpConfigurationResolution {
  return resolveMcpConfiguration({
    project: {
      scope: "project",
      sourcePath: "C:/repo/.kiln/kiln.yaml",
      servers: {
        portable: {
          transport: "stdio",
          command: "node",
          args: ["fixture-server.mjs", "argument with spaces"],
          admission: { state: "admitted" },
        },
      },
    },
  });
}

function emptyResolution(): McpConfigurationResolution {
  return resolveMcpConfiguration({});
}

function writeKilnProjectMarker(root: string): void {
  mkdirSync(join(root, ".kiln"), { recursive: true });
  writeFileSync(join(root, ".kiln", "kiln.yaml"), "version: '1'\n", "utf8");
}

describe("native MCP projection lifecycle", () => {
  it("installs a distinct project-local control-plane bridge for every harness and removes only owned bridges", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-mcp-control-plane-"));
    roots.push(root);
    writeKilnProjectMarker(root);
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(join(root, ".codex", "config.toml"), 'model = "keep-me"\n\n[mcp_servers.unmanaged]\ncommand = "keep"\n');
    writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { unmanaged: { command: "keep" } } }));
    writeFileSync(join(root, "opencode.json"), JSON.stringify({ mcp: {
      unmanaged: { type: "local", command: ["keep"] },
      kiln: { type: "local", command: ["kiln", "tools", "--mcp"], enabled: true },
    } }));

    const sync = await syncNativeMcpProjections(emptyResolution(), root, {
      includeKilnControlPlane: true,
    });

    expect(sync.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ harness: "codex", status: "current" }),
    ]));
    const codex = parseToml(readFileSync(join(root, ".codex", "config.toml"), "utf8")) as Record<string, unknown>;
    expect(codex).toMatchObject({
      model: "keep-me",
      mcp_servers: {
        unmanaged: { command: "keep" },
        "kiln-control-plane": {
          command: "kiln",
          args: ["native-harness", "control-plane-mcp", "--harness", "codex", "--project-root", root],
        },
      },
    });
    expect(JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: {
        unmanaged: { command: "keep" },
        "kiln-control-plane": {
          type: "stdio",
          command: "kiln",
          args: ["native-harness", "control-plane-mcp", "--harness", "claude", "--project-root", root],
        },
      },
    });
    expect(JSON.parse(readFileSync(join(root, "opencode.json"), "utf8"))).toEqual({
      mcp: {
        unmanaged: { type: "local", command: ["keep"] },
        kiln: { type: "local", command: ["kiln", "tools", "--mcp"], enabled: true },
        "kiln-control-plane": {
          type: "local",
          command: ["kiln", "native-harness", "control-plane-mcp", "--harness", "opencode", "--project-root", root],
          enabled: true,
        },
      },
    });

    await uninstallNativeMcpProjections(root);
    const uninstalled = parseToml(readFileSync(join(root, ".codex", "config.toml"), "utf8")) as Record<string, unknown>;
    expect(uninstalled).toMatchObject({
      model: "keep-me",
      mcp_servers: { unmanaged: { command: "keep" } },
    });
    expect((uninstalled.mcp_servers as Record<string, unknown>)["kiln-control-plane"]).toBeUndefined();
    expect(JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"))).toEqual({ mcpServers: { unmanaged: { command: "keep" } } });
    expect(JSON.parse(readFileSync(join(root, "opencode.json"), "utf8"))).toEqual({ mcp: {
      unmanaged: { type: "local", command: ["keep"] },
      kiln: { type: "local", command: ["kiln", "tools", "--mcp"], enabled: true },
    } });
  });

  it("fails closed without modifying an unmanaged native MCP server named kiln-control-plane", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-mcp-control-plane-collision-"));
    roots.push(root);
    writeKilnProjectMarker(root);
    mkdirSync(join(root, ".codex"), { recursive: true });
    const target = join(root, ".codex", "config.toml");
    const original = '[mcp_servers.kiln-control-plane]\ncommand = "someone-else"\nargs = ["serve"]\n';
    writeFileSync(target, original);

    const result = await syncNativeMcpProjections(emptyResolution(), root, {
      harnesses: ["codex"],
      includeKilnControlPlane: true,
    });

    expect(result.targets).toEqual([
      expect.objectContaining({
        harness: "codex",
        status: "incompatible",
        servers: [expect.objectContaining({ id: "kiln-control-plane", status: "incompatible", reason: expect.stringContaining("unmanaged") })],
      }),
    ]);
    expect(readFileSync(target, "utf8")).toBe(original);
    expect(existsSync(join(root, ".kiln", "install-state.json"))).toBe(false);
  });

  it("reserves the control-plane identity for every harness instead of overwriting canonical MCP", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-mcp-control-plane-reserved-"));
    roots.push(root);
    writeKilnProjectMarker(root);
    const conflicting = resolveMcpConfiguration({
      project: {
        scope: "project",
        sourcePath: join(root, ".kiln", "kiln.yaml"),
        servers: {
          "kiln-control-plane": { transport: "stdio", command: "someone-else", admission: { state: "admitted" } },
        },
      },
    });

    const result = await syncNativeMcpProjections(conflicting, root, {
      harnesses: ["codex", "claude", "opencode"],
      includeKilnControlPlane: true,
    });

    expect(result.targets).toHaveLength(3);
    expect(result.targets.every((target) => target.status === "incompatible" && target.reason?.includes("reserved"))).toBe(true);
    expect(existsSync(join(root, ".codex", "config.toml"))).toBe(false);
    expect(existsSync(join(root, ".kiln", "install-state.json"))).toBe(false);
  });

  it("refuses to project the control-plane bridge outside an adopted Kiln project", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-mcp-control-plane-unadopted-"));
    roots.push(root);

    await expect(syncNativeMcpProjections(emptyResolution(), root, {
      includeKilnControlPlane: true,
    })).rejects.toThrow(join(".kiln", "kiln.yaml"));

    expect(existsSync(join(root, ".codex", "config.toml"))).toBe(false);
    expect(existsSync(join(root, ".mcp.json"))).toBe(false);
    expect(existsSync(join(root, "opencode.json"))).toBe(false);
    expect(existsSync(join(root, ".kiln", "install-state.json"))).toBe(false);
  });

  it("restores every native MCP file byte-for-byte when install-state persistence fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-mcp-state-rollback-"));
    roots.push(root);
    writeKilnProjectMarker(root);
    const files = [
      join(root, ".codex", "config.toml"),
      join(root, ".mcp.json"),
      join(root, "opencode.json"),
    ];
    mkdirSync(dirname(files[0]!), { recursive: true });
    writeFileSync(files[0]!, 'model = "operator"\r\n', "utf8");
    writeFileSync(files[1]!, '{"operator":true}\r\n', "utf8");
    writeFileSync(files[2]!, '{"theme":"operator"}\r\n', "utf8");
    const before = new Map(files.map((path) => [path, readFileSync(path, "utf8")]));
    vi.spyOn(nativeProjectionState, "writeNativeProjectionInstallState").mockImplementation(() => {
      throw new Error("synthetic MCP install-state failure");
    });

    await expect(syncNativeMcpProjections(emptyResolution(), root, {
      includeKilnControlPlane: true,
    })).rejects.toThrow("synthetic MCP install-state failure");

    for (const [path, content] of before) expect(readFileSync(path, "utf8")).toBe(content);
    expect(existsSync(join(root, ".kiln", "install-state.json"))).toBe(false);
  });

  it("restores every native MCP file byte-for-byte when uninstall-state persistence fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-mcp-uninstall-rollback-"));
    roots.push(root);
    await syncNativeMcpProjections(portableResolution(), root, { harnesses: ["claude", "opencode"] });
    const files = [join(root, ".mcp.json"), join(root, "opencode.json")];
    const before = new Map(files.map((path) => [path, readFileSync(path, "utf8")]));
    vi.spyOn(nativeProjectionState, "writeNativeProjectionInstallState").mockImplementation(() => {
      throw new Error("synthetic MCP uninstall-state failure");
    });

    await expect(uninstallNativeMcpProjections(root, {
      harnesses: ["claude", "opencode"],
    })).rejects.toThrow("synthetic MCP uninstall-state failure");

    for (const [path, content] of before) expect(readFileSync(path, "utf8")).toBe(content);
  });

  it("syncs all verified harnesses, preserves unmanaged settings, and records ownership", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-mcp-"));
    roots.push(root);
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(join(root, ".codex", "config.toml"), 'model = "keep-me"\n\n[mcp_servers.unmanaged]\ncommand = "keep"\n');

    const result = await syncNativeMcpProjections(resolution(), root, {
      now: "2026-07-19T12:00:00.000Z",
    });

    expect(result.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ harness: "codex", status: "current" }),
      expect.objectContaining({ harness: "claude", status: "incompatible" }),
      expect.objectContaining({ harness: "opencode", status: "incompatible" }),
    ]));
    const codex = parseToml(readFileSync(join(root, ".codex", "config.toml"), "utf-8")) as Record<string, unknown>;
    expect(codex).toMatchObject({
      model: "keep-me",
      mcp_servers: {
        unmanaged: { command: "keep" },
        "studio.v2": { command: "cmd.exe", args: ["/c", "C:\\Roblox\\mcp.bat"] },
      },
    });
    expect(JSON.parse(readFileSync(join(root, ".kiln", "install-state.json"), "utf-8")))
      .toMatchObject({ targets: { "mcp:codex": { managedFields: ["/mcp_servers/studio.v2"] } } });
  });

  it("fails safely on malformed native config and never replaces it", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-mcp-malformed-"));
    roots.push(root);
    mkdirSync(join(root, ".codex"), { recursive: true });
    const target = join(root, ".codex", "config.toml");
    writeFileSync(target, "not = [valid");

    const result = await syncNativeMcpProjections(resolution(), root, { harnesses: ["codex"] });

    expect(result.targets).toEqual([expect.objectContaining({ harness: "codex", status: "blocked-malformed" })]);
    expect(readFileSync(target, "utf-8")).toBe("not = [valid");
    expect(existsSync(join(root, ".kiln", "install-state.json"))).toBe(false);
  });

  it("synchronizes and uninstalls portable definitions for Claude and OpenCode while preserving unmanaged keys", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-mcp-portable-"));
    roots.push(root);
    writeFileSync(join(root, ".mcp.json"), JSON.stringify({ keep: true, mcpServers: { unmanaged: { command: "keep" } } }));
    writeFileSync(join(root, "opencode.json"), JSON.stringify({ theme: "keep", mcp: { unmanaged: { type: "local", command: ["keep"] } } }));

    const sync = await syncNativeMcpProjections(portableResolution(), root, { harnesses: ["claude", "opencode"] });
    expect(sync.targets).toEqual([
      expect.objectContaining({ harness: "claude", status: "current" }),
      expect.objectContaining({ harness: "opencode", status: "current" }),
    ]);
    expect(JSON.parse(readFileSync(join(root, ".mcp.json"), "utf-8"))).toMatchObject({
      keep: true,
      mcpServers: { unmanaged: { command: "keep" }, portable: { command: "node", args: ["fixture-server.mjs", "argument with spaces"] } },
    });
    expect(JSON.parse(readFileSync(join(root, "opencode.json"), "utf-8"))).toMatchObject({
      theme: "keep",
      mcp: { unmanaged: { type: "local" }, portable: { type: "local", command: ["node", "fixture-server.mjs", "argument with spaces"] } },
    });

    await uninstallNativeMcpProjections(root);
    expect(JSON.parse(readFileSync(join(root, ".mcp.json"), "utf-8"))).toEqual({ keep: true, mcpServers: { unmanaged: { command: "keep" } } });
    expect(JSON.parse(readFileSync(join(root, "opencode.json"), "utf-8"))).toEqual({ theme: "keep", mcp: { unmanaged: { type: "local", command: ["keep"] } } });
  });

  it("detects drift, repairs only with force, and uninstalls owned fields", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-mcp-drift-"));
    roots.push(root);
    await syncNativeMcpProjections(resolution(), root, { harnesses: ["codex"] });
    const target = join(root, ".codex", "config.toml");
    writeFileSync(target, readFileSync(target, "utf-8").replace("cmd.exe", "tampered.exe"));

    const drift = await syncNativeMcpProjections(resolution(), root, { harnesses: ["codex"] });
    expect(drift.targets).toEqual([expect.objectContaining({ status: "drifted" })]);
    expect(readFileSync(target, "utf-8")).toContain("tampered.exe");

    const repaired = await syncNativeMcpProjections(resolution(), root, { harnesses: ["codex"], force: true });
    expect(repaired.targets).toEqual([expect.objectContaining({ status: "current" })]);
    expect(readFileSync(target, "utf-8")).toContain("cmd.exe");
    expect(() => assertNativeMcpProjectionCurrent(resolution(), root, "codex")).not.toThrow();

    const uninstall = await uninstallNativeMcpProjections(root);
    expect(uninstall.targets).toEqual([expect.objectContaining({ harness: "codex", status: "uninstalled" })]);
    const after = parseToml(readFileSync(target, "utf-8")) as { mcp_servers?: Record<string, unknown> };
    expect(after.mcp_servers?.["studio.v2"]).toBeUndefined();
  });
});
