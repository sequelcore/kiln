import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { generateMcpConfig, generateConfig } from "../../src/mcp/config-generator.js";

const serverDef = { name: "kiln", command: "kiln", args: ["tools", "--mcp"] };

describe("generateConfig (backward compat)", () => {
  it("claude-code + stdio produces valid JSON with mcpServers", () => {
    const result = generateConfig({ client: "claude-code", transport: "stdio", mcpServerName: "kiln", appName: "kiln" });
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers["kiln"]).toBeDefined();
    expect(parsed.mcpServers["kiln"].command).toBe("kiln");
    expect(parsed.mcpServers["kiln"].args).toEqual(["tools", "--mcp"]);
  });

  it("cursor + stdio produces valid JSON", () => {
    const result = generateConfig({ client: "cursor", transport: "stdio", mcpServerName: "kiln", appName: "kiln" });
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers["kiln"]).toBeDefined();
    expect(parsed.mcpServers["kiln"].command).toBe("kiln");
    expect(parsed.mcpServers["kiln"].args).toEqual(["tools", "--mcp"]);
  });

  it("generic + sse includes url and port", () => {
    const result = generateConfig({ client: "generic", transport: "sse", port: 4000, mcpServerName: "kiln", appName: "kiln" });
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers["kiln"].url).toContain("4000");
    expect(parsed.mcpServers["kiln"].transportType).toBe("sse");
  });
});

describe("generateMcpConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdirSync(join(os.tmpdir(), `kiln-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("claude-code", () => {
    it("creates .mcp.json when none exists", async () => {
      await generateMcpConfig("claude-code", serverDef, tmpDir);
      const target = join(tmpDir, ".mcp.json");
      expect(readFileSync(target, "utf-8")).toBeTruthy();
      const parsed = JSON.parse(readFileSync(target, "utf-8"));
      expect(parsed.mcpServers.kiln).toBeDefined();
      expect(parsed.mcpServers.kiln.command).toBe("kiln");
      expect(parsed.mcpServers.kiln.args).toEqual(["tools", "--mcp"]);
    });

    it("merges into existing .mcp.json preserving other keys", async () => {
      writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({ otherTool: { setting: true }, mcpServers: { existing: { command: "x" } } }), "utf-8");
      await generateMcpConfig("claude-code", serverDef, tmpDir);
      const parsed = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
      expect(parsed.otherTool).toEqual({ setting: true });
      expect(parsed.mcpServers.existing).toBeDefined();
      expect(parsed.mcpServers.kiln).toBeDefined();
    });

    it("overwrites existing server name entry", async () => {
      writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({ mcpServers: { kiln: { command: "old" } } }), "utf-8");
      await generateMcpConfig("claude-code", serverDef, tmpDir);
      const parsed = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
      expect(parsed.mcpServers.kiln.command).toBe("kiln");
    });
  });

  describe("codex", () => {
    it("creates config.toml when none exists", async () => {
      await generateMcpConfig("codex", serverDef, tmpDir);
      const target = join(os.homedir(), ".codex", "config.toml");
      const raw = readFileSync(target, "utf-8");
      expect(raw).toBeTruthy();
      expect(raw).toContain("mcp_servers");
    });

    it("preserves existing TOML sections", async () => {
      const codexDir = join(os.homedir(), ".codex");
      mkdirSync(codexDir, { recursive: true });
      writeFileSync(join(codexDir, "config.toml"), `[other_section]\nkey = "value"\n`, "utf-8");
      await generateMcpConfig("codex", serverDef, tmpDir);
      const raw = readFileSync(join(codexDir, "config.toml"), "utf-8");
      expect(raw).toContain("other_section");
      expect(raw).toContain("mcp_servers");
    });
  });

  describe("opencode", () => {
    it("creates opencode.json when none exists", async () => {
      await generateMcpConfig("opencode", serverDef, tmpDir);
      const target = join(os.homedir(), ".config", "opencode", "opencode.json");
      const parsed = JSON.parse(readFileSync(target, "utf-8"));
      expect(parsed.mcp).toBeDefined();
      expect(parsed.mcp.kiln.type).toBe("local");
      expect(parsed.mcp.kiln.command).toEqual(["kiln", "tools", "--mcp"]);
      expect(parsed.mcp.kiln.enabled).toBe(true);
    });

    it("merges into existing opencode.json preserving other keys", async () => {
      const ocDir = join(os.homedir(), ".config", "opencode");
      mkdirSync(ocDir, { recursive: true });
      writeFileSync(join(ocDir, "opencode.json"), JSON.stringify({ theme: "dark", other: { nested: true } }), "utf-8");
      await generateMcpConfig("opencode", serverDef, tmpDir);
      const parsed = JSON.parse(readFileSync(join(ocDir, "opencode.json"), "utf-8"));
      expect(parsed.theme).toBe("dark");
      expect(parsed.other).toEqual({ nested: true });
      expect(parsed.mcp.kiln).toBeDefined();
    });

    it("strips JSONC-style comments before parsing", async () => {
      const ocDir = join(os.homedir(), ".config", "opencode");
      mkdirSync(ocDir, { recursive: true });
      const content = [
        '{',
        '  // this is a comment',
        '  "theme": "light"',
        '}',
      ].join("\n");
      writeFileSync(join(ocDir, "opencode.json"), content, "utf-8");
      await generateMcpConfig("opencode", serverDef, tmpDir);
      const parsed = JSON.parse(readFileSync(join(ocDir, "opencode.json"), "utf-8"));
      expect(parsed.theme).toBe("light");
      expect(parsed.mcp.kiln).toBeDefined();
    });
  });

  describe("all", () => {
    it("generates all three configs", async () => {
      await generateMcpConfig("all", serverDef, tmpDir);
      expect(readFileSync(join(tmpDir, ".mcp.json"), "utf-8")).toBeTruthy();
      expect(readFileSync(join(os.homedir(), ".codex", "config.toml"), "utf-8")).toBeTruthy();
      expect(readFileSync(join(os.homedir(), ".config", "opencode", "opencode.json"), "utf-8")).toBeTruthy();
    });
  });
});
