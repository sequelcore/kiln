import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const fsMocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
}));

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn((path: string, content: string) => {
    fsMocks.files.set(path, content);
  }),
  unlinkSync: vi.fn((path: string) => {
    fsMocks.files.delete(path);
  }),
  existsSync: vi.fn((path: string) => fsMocks.files.has(path)),
  readFileSync: vi.fn((path: string) => fsMocks.files.get(path) ?? ""),
}));

vi.mock("node:os", () => ({
  default: {
    homedir: vi.fn(),
  },
}));

vi.mock("../../src/application/agent-loader.js", () => ({
  loadAgentDefinitions: vi.fn(),
}));

import { loadAgentDefinitions } from "../../src/application/agent-loader.js";
import {
  agentToClaudeMd,
  agentToCodexToml,
  agentToOpenCodeMd,
  syncNativeAgentProjections,
} from "../../src/config/native-agent-projection.js";

const mkdirSyncMock = mkdirSync as unknown as ReturnType<typeof vi.fn>;
const writeFileSyncMock = writeFileSync as unknown as ReturnType<typeof vi.fn>;
const unlinkSyncMock = unlinkSync as unknown as ReturnType<typeof vi.fn>;
const existsSyncMock = existsSync as unknown as ReturnType<typeof vi.fn>;
const readFileSyncMock = readFileSync as unknown as ReturnType<typeof vi.fn>;
const homedirMock = os.homedir as unknown as ReturnType<typeof vi.fn>;
const loadAgentDefinitionsMock = loadAgentDefinitions as unknown as ReturnType<typeof vi.fn>;

describe("native-agent-projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdirSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    unlinkSyncMock.mockReset();
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
    homedirMock.mockReset();
    loadAgentDefinitionsMock.mockReset();
    fsMocks.files.clear();

    homedirMock.mockReturnValue("/home/tester");
    mkdirSyncMock.mockImplementation(() => undefined);
    writeFileSyncMock.mockImplementation((path: string, content: string) => {
      fsMocks.files.set(path, content);
    });
    unlinkSyncMock.mockImplementation((path: string) => {
      fsMocks.files.delete(path);
    });
    existsSyncMock.mockImplementation((path: string) => fsMocks.files.has(path));
    readFileSyncMock.mockImplementation((path: string) => fsMocks.files.get(path) ?? "");
  });

  it("returns synced:0 and all true when no agents defined", async () => {
    loadAgentDefinitionsMock.mockResolvedValue([]);

    const result = await syncNativeAgentProjections("/workspace/project");

    expect(result).toEqual({
      claude: true,
      codex: true,
      opencode: true,
      synced: 0,
      errors: [],
    });
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it("agentToClaudeMd() generates correct frontmatter + body", () => {
    const md = agentToClaudeMd({
      name: "planner",
      displayName: "Hal",
      nicknameCandidates: ["Planning Hal"],
      role: "Planning specialist",
      description: "Plans implementation work",
      goal: "Produce a verified implementation plan",
      tier: "reasoning",
      tools: ["read", "write"],
      skills: ["sequel-spring"],
      instructions: "Plan first.",
      scope: "project",
    }, "gpt-5.4");

    expect(md).toContain("---\n");
    expect(md).toContain("name: planner");
    expect(md).toContain("displayName: Hal");
    expect(md).toContain("nicknameCandidates:");
    expect(md).toContain("- Planning Hal");
    expect(md).toContain("role: Planning specialist");
    expect(md).toContain("description: Plans implementation work");
    expect(md).toContain("goal: Produce a verified implementation plan");
    expect(md).toContain("tools:");
    expect(md).toContain("- read");
    expect(md).toContain("model: gpt-5.4");
    expect(md).toContain("skills:");
    expect(md).toContain("- sequel-spring");
    expect(md).toContain("---\nPlan first.");
  });

  it("agentToCodexToml() generates name, description, developer_instructions, model", () => {
    const toml = agentToCodexToml({
      name: "planner",
      displayName: "Hal",
      nicknameCandidates: ["Planning Hal"],
      role: "Planning specialist",
      description: "Plans implementation work",
      goal: "Produce a verified implementation plan",
      tier: "reasoning",
      instructions: "Plan first.",
      scope: "project",
    }, "gpt-5.4");

    expect(toml).toContain('name = "planner"');
    expect(toml).toContain('description = "Plans implementation work"');
    expect(toml).toContain('Goal: Produce a verified implementation plan');
    expect(toml).toContain("Display name: Hal");
    expect(toml).toContain('nickname_candidates = ["Hal", "Planning Hal"]');
    expect(toml).toContain("Plan first.");
    expect(toml).toContain('model = "gpt-5.4"');
  });

  it("agentToCodexToml() uses canonical goal when no instructions", () => {
    const toml = agentToCodexToml({
      name: "planner",
      displayName: "Hal",
      role: "Planning specialist",
      goal: "Produce a verified implementation plan",
      tier: "reasoning",
      scope: "project",
    });

    expect(toml).toContain("Display name: Hal");
    expect(toml).toContain("Goal: Produce a verified implementation plan");
    expect(toml).toContain('nickname_candidates = ["Hal"]');
  });

  it("agentToOpenCodeMd() generates frontmatter + body", () => {
    const md = agentToOpenCodeMd({
      name: "planner",
      displayName: "Hal",
      role: "Planning specialist",
      description: "Plans implementation work",
      goal: "Produce a verified implementation plan",
      tier: "reasoning",
      instructions: "Follow the checklist.",
      scope: "project",
    }, "gpt-5.4-mini");

    expect(md).toContain("---\n");
    expect(md).toContain("name: planner");
    expect(md).toContain("displayName: Hal");
    expect(md).toContain("description: Plans implementation work");
    expect(md).toContain("model: gpt-5.4-mini");
    expect(md).toContain("Goal: Produce a verified implementation plan");
    expect(md).toContain("Display name: Hal");
    expect(md).toContain("Follow the checklist.");
  });

  it("agentToOpenCodeMd() omits model from frontmatter when not set", () => {
    const md = agentToOpenCodeMd({
      name: "planner",
      role: "Planning specialist",
      goal: "Produce a verified implementation plan",
      tier: "reasoning",
      scope: "project",
    });

    expect(md).toContain("description: Planning specialist");
    expect(md).not.toContain("model:");
  });

  it("sync projects a strict Codex route only to compatible native Codex config", async () => {
    loadAgentDefinitionsMock.mockResolvedValue([
      {
        name: "reviewer",
        role: "Review specialist",
        goal: "Review implementation quality",
        tier: "reasoning",
        providerRoute: {
          providerId: "codex-oauth",
          model: "gpt-5.5",
        },
        instructions: "Review only.",
        scope: "project",
      },
    ]);

    const result = await syncNativeAgentProjections("/workspace/project");

    expect(result).toEqual({
      claude: true,
      codex: true,
      opencode: true,
      synced: 1,
      errors: [],
    });
    expect(fsMocks.files.get(join("/home/tester", ".codex", "agents", "reviewer.toml"))).toContain('model = "gpt-5.5"');
    expect(fsMocks.files.has(join("/home/tester", ".claude", "agents", "reviewer.md"))).toBe(false);
    expect(fsMocks.files.has(join("/home/tester", ".config", "opencode", "agents", "reviewer.md"))).toBe(false);
  });

  it("sync projects a strict OpenCode route only to compatible native OpenCode config", async () => {
    loadAgentDefinitionsMock.mockResolvedValue([
      {
        name: "scout",
        role: "Context scout",
        goal: "Map local context",
        tier: "fast",
        providerRoute: {
          providerId: "opencode-go",
          model: "deepseek-v4-flash",
        },
        instructions: "Scout only.",
        scope: "project",
      },
    ]);

    const result = await syncNativeAgentProjections("/workspace/project");

    expect(result.errors).toHaveLength(0);
    expect(result.synced).toBe(1);
    expect(fsMocks.files.get(join("/home/tester", ".config", "opencode", "agents", "scout.md"))).toContain(
      "model: opencode-go/deepseek-v4-flash",
    );
    expect(fsMocks.files.has(join("/home/tester", ".codex", "agents", "scout.toml"))).toBe(false);
  });

  it("removes an owned native file when a strict route becomes incompatible with that harness", async () => {
    loadAgentDefinitionsMock.mockResolvedValueOnce([
      {
        name: "scout",
        role: "Context scout",
        goal: "Map local context",
        tier: "fast",
        instructions: "Scout only.",
        scope: "project",
      },
    ]);
    const first = await syncNativeAgentProjections("/workspace/project");
    expect(first.errors).toHaveLength(0);
    expect(fsMocks.files.has(join("/home/tester", ".codex", "agents", "scout.toml"))).toBe(true);

    loadAgentDefinitionsMock.mockResolvedValueOnce([
      {
        name: "scout",
        role: "Context scout",
        goal: "Map local context",
        tier: "fast",
        providerRoute: {
          providerId: "opencode-go",
          model: "deepseek-v4-flash",
        },
        instructions: "Scout only.",
        scope: "project",
      },
    ]);

    const second = await syncNativeAgentProjections("/workspace/project");

    expect(second.errors).toHaveLength(0);
    expect(second.synced).toBe(1);
    expect(unlinkSyncMock).toHaveBeenCalledWith(join("/home/tester", ".codex", "agents", "scout.toml"));
    expect(fsMocks.files.has(join("/home/tester", ".codex", "agents", "scout.toml"))).toBe(false);

    const state = JSON.parse(fsMocks.files.get(join("/workspace/project", ".kiln", "install-state.json")) ?? "{}") as {
      targets: Record<string, unknown>;
    };
    expect(Object.keys(state.targets).sort()).toEqual(["opencode-agent:scout"]);
  });

  it("write failure marks correct target as false and captures error", async () => {
    loadAgentDefinitionsMock.mockResolvedValue([
      {
        name: "planner",
        role: "Planning specialist",
        goal: "Produce a verified implementation plan",
        tier: "reasoning",
        instructions: "Plan first.",
        scope: "project",
      },
    ]);

    writeFileSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath.includes(".codex")) {
        throw new Error("codex write failed");
      }
    });

    const result = await syncNativeAgentProjections("/workspace/project");

    expect(result.claude).toBe(true);
    expect(result.codex).toBe(false);
    expect(result.opencode).toBe(true);
    expect(result.synced).toBe(2);
    expect(result.errors.some((entry) => entry.includes("codex write failed"))).toBe(true);
  });

  it("records install state for projected agent files", async () => {
    loadAgentDefinitionsMock.mockResolvedValue([
      {
        name: "planner",
        role: "Planning specialist",
        goal: "Produce a verified implementation plan",
        tier: "reasoning",
        instructions: "Plan first.",
        scope: "project",
      },
    ]);

    const result = await syncNativeAgentProjections("/workspace/project");

    expect(result.errors).toHaveLength(0);
    const state = JSON.parse(fsMocks.files.get(join("/workspace/project", ".kiln", "install-state.json")) ?? "{}") as {
      targets: Record<string, { projectionKind?: string; managedFields: string[] }>;
    };
    expect(Object.keys(state.targets).sort()).toEqual([
      "claude-agent:planner",
      "codex-agent:planner",
      "opencode-agent:planner",
    ]);
    expect(state.targets["codex-agent:planner"]).toMatchObject({
      projectionKind: "file",
      managedFields: ["$file"],
    });
  });

  it("aborts only drifted projected agent files unless force is set", async () => {
    loadAgentDefinitionsMock.mockResolvedValue([
      {
        name: "planner",
        role: "Planning specialist",
        goal: "Produce a verified implementation plan",
        tier: "reasoning",
        instructions: "Plan first.",
        scope: "project",
      },
    ]);
    const first = await syncNativeAgentProjections("/workspace/project");
    expect(first.errors).toHaveLength(0);

    const codexAgentPath = join("/home/tester", ".codex", "agents", "planner.toml");
    fsMocks.files.set(codexAgentPath, "user drift\n");

    const second = await syncNativeAgentProjections("/workspace/project");

    expect(second.claude).toBe(true);
    expect(second.codex).toBe(false);
    expect(second.opencode).toBe(true);
    expect(second.errors).toEqual([
      "Codex agent \"planner\" failed: managed file drift detected: $file",
    ]);
    expect(fsMocks.files.get(codexAgentPath)).toBe("user drift\n");

    const forced = await syncNativeAgentProjections("/workspace/project", { force: true });

    expect(forced.codex).toBe(true);
    expect(forced.errors).toHaveLength(0);
    expect(fsMocks.files.get(codexAgentPath)).toContain('name = "planner"');
  });
});
