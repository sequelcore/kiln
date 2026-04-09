import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  default: {
    homedir: vi.fn(),
  },
}));

vi.mock("../application/agent-loader.js", () => ({
  loadAgentDefinitions: vi.fn(),
}));

import { loadAgentDefinitions } from "../application/agent-loader.js";
import {
  agentToClaudeMd,
  agentToCodexToml,
  agentToOpenCodeMd,
  syncAgents,
} from "./agent-sync.js";

const mkdirSyncMock = mkdirSync as unknown as ReturnType<typeof vi.fn>;
const writeFileSyncMock = writeFileSync as unknown as ReturnType<typeof vi.fn>;
const homedirMock = os.homedir as unknown as ReturnType<typeof vi.fn>;
const loadAgentDefinitionsMock = loadAgentDefinitions as unknown as ReturnType<typeof vi.fn>;

describe("agent-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdirSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    homedirMock.mockReset();
    loadAgentDefinitionsMock.mockReset();

    homedirMock.mockReturnValue("/home/tester");
    mkdirSyncMock.mockImplementation(() => undefined);
    writeFileSyncMock.mockImplementation(() => undefined);
  });

  it("returns synced:0 and all true when no agents defined", async () => {
    loadAgentDefinitionsMock.mockResolvedValue([]);

    const result = await syncAgents("/workspace/project");

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
      role: "Planning specialist",
      tools: ["read", "write"],
      model: "gpt-5.4",
      skills: ["sequel-spring"],
      instructions: "Plan first.",
      scope: "project",
    });

    expect(md).toContain("---\n");
    expect(md).toContain("name: planner");
    expect(md).toContain("role: Planning specialist");
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
      role: "Planning specialist",
      model: "gpt-5.4",
      instructions: "Plan first.",
      scope: "project",
    });

    expect(toml).toContain('name = "planner"');
    expect(toml).toContain('description = "Planning specialist"');
    expect(toml).toContain('developer_instructions = """Plan first."""');
    expect(toml).toContain('model = "gpt-5.4"');
  });

  it("agentToCodexToml() uses role as developer_instructions fallback when no instructions", () => {
    const toml = agentToCodexToml({
      name: "planner",
      role: "Planning specialist",
      scope: "project",
    });

    expect(toml).toContain('developer_instructions = """Planning specialist"""');
  });

  it("agentToOpenCodeMd() generates frontmatter + body", () => {
    const md = agentToOpenCodeMd({
      name: "planner",
      role: "Planning specialist",
      model: "gpt-5.4-mini",
      instructions: "Follow the checklist.",
      scope: "project",
    });

    expect(md).toContain("---\n");
    expect(md).toContain("description: Planning specialist");
    expect(md).toContain("model: gpt-5.4-mini");
    expect(md).toContain("---\nFollow the checklist.");
  });

  it("agentToOpenCodeMd() omits model from frontmatter when not set", () => {
    const md = agentToOpenCodeMd({
      name: "planner",
      role: "Planning specialist",
      scope: "project",
    });

    expect(md).toContain("description: Planning specialist");
    expect(md).not.toContain("model:");
  });

  it("write failure marks correct target as false and captures error", async () => {
    loadAgentDefinitionsMock.mockResolvedValue([
      {
        name: "planner",
        role: "Planning specialist",
        instructions: "Plan first.",
        scope: "project",
      },
    ]);

    writeFileSyncMock.mockImplementation((targetPath: string) => {
      if (targetPath.includes(".codex")) {
        throw new Error("codex write failed");
      }
    });

    const result = await syncAgents("/workspace/project");

    expect(result.claude).toBe(true);
    expect(result.codex).toBe(false);
    expect(result.opencode).toBe(true);
    expect(result.synced).toBe(2);
    expect(result.errors.some((entry) => entry.includes("codex write failed"))).toBe(true);
  });
});
