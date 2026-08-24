import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readMcpRuntimeState, recordMcpDiscovery, recordMcpFailure } from "../../src/config/mcp-runtime-state.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "xdg"));
    expect(recordMcpDiscovery(root, snapshot(["mcp:fixture:tool:a"])).discovery).toBe("current");
    expect(recordMcpDiscovery(root, snapshot(["mcp:fixture:tool:b"])).discovery).toBe("changed");
    expect(readMcpRuntimeState(root).servers.fixture).toMatchObject({ health: "healthy", tools: 1, admitted: 1 });
    expect(existsSync(join(root, ".kiln"))).toBe(false);
  });

  it("redacts URLs from persisted failures", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-mcp-state-failure-")); roots.push(root);
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "xdg"));
    recordMcpFailure(root, "fixture", new Error("failed at https://secret.example/mcp?token=value"));
    expect(readMcpRuntimeState(root).servers.fixture).toMatchObject({ health: "unavailable", discovery: "failed" });
    expect(readMcpRuntimeState(root).servers.fixture?.lastFailure).not.toContain("secret.example");
  });

  it("uses the established binding when ambient XDG points at another Kiln home", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-mcp-state-binding-")); roots.push(root);
    const bindingHome = join(root, "binding-home");
    const ambientHome = join(root, "ambient-home");
    vi.stubEnv("XDG_CONFIG_HOME", ambientHome);
    const binding = resolveProjectStateBinding(root, { kilnHome: bindingHome });

    recordMcpDiscovery(root, snapshot(["mcp:fixture:tool:a"]), {
      projectStateBinding: binding,
      testedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(readMcpRuntimeState(root, { projectStateBinding: binding }).servers.fixture).toMatchObject({
      health: "healthy",
      tools: 1,
      testedAt: "2026-07-19T00:00:00.000Z",
    });
    expect(existsSync(join(binding.runtimePath, "mcp-state.json"))).toBe(true);
    expect(existsSync(join(resolveProjectStateBinding(root).runtimePath, "mcp-state.json"))).toBe(false);
  });
});
