import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readMcpRuntimeState, recordMcpDiscovery, recordMcpFailure } from "../../src/config/mcp-runtime-state.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function snapshot(tools: string[]) {
  return {
    serverId: "fixture",
    tools: tools.map((selector) => ({ serverId: "fixture", kind: "tool" as const, selector, descriptor: { name: selector, inputSchema: {} } })),
    resources: [],
    prompts: [],
    discoveredAt: "2026-07-19T00:00:00.000Z",
  };
}

describe("MCP runtime observation state", () => {
  it("records current discovery and detects a changed admitted catalog", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-mcp-state-")); roots.push(root);
    expect(recordMcpDiscovery(root, snapshot(["mcp:fixture:tool:a"])).discovery).toBe("current");
    expect(recordMcpDiscovery(root, snapshot(["mcp:fixture:tool:b"])).discovery).toBe("changed");
    expect(readMcpRuntimeState(root).servers.fixture).toMatchObject({ health: "healthy", tools: 1, admitted: 1 });
  });

  it("redacts URLs from persisted failures", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-mcp-state-failure-")); roots.push(root);
    recordMcpFailure(root, "fixture", new Error("failed at https://secret.example/mcp?token=value"));
    expect(readMcpRuntimeState(root).servers.fixture).toMatchObject({ health: "unavailable", discovery: "failed" });
    expect(readMcpRuntimeState(root).servers.fixture?.lastFailure).not.toContain("secret.example");
  });
});
