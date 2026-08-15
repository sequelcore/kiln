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
  renameSync: vi.fn((source: string, destination: string) => {
    const content = fsMocks.files.get(source);
    if (content === undefined) throw new Error(`ENOENT: ${source}`);
    fsMocks.files.set(destination, content);
    fsMocks.files.delete(source);
  }),
  rmSync: vi.fn((path: string) => {
    fsMocks.files.delete(path);
  }),
}));

vi.mock("node:os", () => {
  const homedir = vi.fn(() => "/home/tester");
  return {
    homedir,
    default: {
      homedir,
    },
  };
});

vi.mock("../../src/application/agent-loader.js", () => ({
  loadGlobalAgentDefinitions: vi.fn(),
}));

import { loadGlobalAgentDefinitions } from "../../src/application/agent-loader.js";
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
const loadAgentDefinitionsMock = loadGlobalAgentDefinitions as unknown as ReturnType<typeof vi.fn>;

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

    expect(result).toMatchObject({
      claude: true,
      codex: true,
      opencode: true,
      synced: 0,
      errors: [],
      outcomes: [],
    });
    expect(loadAgentDefinitionsMock).toHaveBeenCalledExactlyOnceWith({});
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it("projects only evidence-backed native communication controls", () => {
    const agent = {
      name: "reviewer",
      role: "Reviewer",
      goal: "Review changes",
      tier: "reasoning" as const,
      scope: "project" as const,
      communication: {
        responseDetail: "detailed" as const,
        locale: "es-MX",
        requiredContent: ["verification" as const],
        interactionProfile: {
          id: "pragmatic",
          revision: "v1",
          behaviors: ["outcome-first" as const, "plain-language" as const, "next-action-explicit" as const],
        },
      },
    };

    expect(agentToCodexToml(agent, "gpt-5.6-sol")).toContain('model_verbosity = "high"');
    expect(agentToCodexToml(agent, "gpt-5.6-sol")).toContain('personality = "pragmatic"');
    expect(agentToCodexToml(agent, "gpt-5.6-sol")).toContain("Respond using locale 'es-MX'");
    expect(agentToCodexToml(agent, "gpt-5.6-sol")).toContain("verification");
    expect(agentToOpenCodeMd({
      ...agent,
      communication: { responseDetail: "concise" as const },
    }, "openai/gpt-5.6-sol")).toContain("textVerbosity: low");
    expect(agentToClaudeMd({
      ...agent,
      communication: { locale: "es-MX", requiredContent: ["verification" as const] },
    }, "claude-opus-4-1")).toContain("Respond using locale 'es-MX'");
  });

  it("persists global/project/agent communication provenance with each owned projection", async () => {
    loadAgentDefinitionsMock.mockResolvedValueOnce([{
      name: "reviewer",
      role: "Reviewer",
      goal: "Review changes",
      tier: "reasoning",
      scope: "project",
      communication: { requiredContent: ["finding"] },
    }]);

    const result = await syncNativeAgentProjections("/workspace/project", {
      communicationCandidates: [
        { source: "global", intent: { locale: "en-US" } },
        { source: "project", intent: { locale: "es-MX", requiredContent: ["verification"] } },
      ],
    });

    expect(result.errors).toEqual([]);
    const state = JSON.parse(fsMocks.files.get(join("/home/tester", ".kiln", "runtime", "native-projections", "install-state.json")) ?? "{}") as {
      targets: Record<string, { communicationResolution?: { requested: { authority: Record<string, unknown>; intent: { requiredContent: string[] } } } }>;
    };
    expect(state.targets["codex-agent:reviewer"]?.communicationResolution?.requested).toMatchObject({
      authority: { locale: "project", requiredContent: { finding: ["agent-profile"], verification: ["project"] } },
      intent: { locale: "es-MX", requiredContent: ["finding", "verification"] },
    });
  });

  it("fails closed when a standalone harness cannot represent requested communication", () => {
    expect(() => agentToClaudeMd({
      name: "writer",
      role: "Writer",
      goal: "Write",
      tier: "reasoning",
      scope: "project",
      communication: { responseDetail: "detailed" },
    }, "claude-opus-4-1")).toThrow("cannot exactly project");
  });

  it("passes an explicit userHome to the agent loader and never falls back to the OS home", async () => {
    const userHome = "/synthetic/user-home";
    loadAgentDefinitionsMock.mockImplementation(async (options: { userHome?: string }) => {
      expect(options).toEqual({ userHome });
      return [{
        name: "synthetic-agent",
        role: "Synthetic agent",
        goal: "Prove native projection isolation",
        tier: "fast",
        instructions: "Use the synthetic home.",
        scope: "project",
      }];
    });

    const result = await syncNativeAgentProjections("/workspace/project", { userHome });

    expect(result.errors).toEqual([]);
    expect(loadAgentDefinitionsMock).toHaveBeenCalledExactlyOnceWith({ userHome });
    expect(homedirMock).not.toHaveBeenCalled();
    expect(fsMocks.files.has(join(userHome, ".codex", "agents", "synthetic-agent.toml"))).toBe(true);
    expect(fsMocks.files.has(join("/home/tester", ".codex", "agents", "synthetic-agent.toml"))).toBe(false);
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

  it("reports an unresolved strict route instead of inferring admission from the Codex encoder", async () => {
    loadAgentDefinitionsMock.mockResolvedValue([
      {
        name: "reviewer",
        role: "Review specialist",
        goal: "Review implementation quality",
        tier: "reasoning",
        targetId: "codex-unproven",
        authorityProfileId: "foundation-readonly-plan",
        instructions: "Review only.",
        scope: "project",
      },
    ]);

    const result = await syncNativeAgentProjections("/workspace/project");

    expect(result).toMatchObject({
      claude: true,
      codex: true,
      opencode: true,
      synced: 0,
      errors: [],
    });
    expect(result.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "codex-agent:reviewer", status: "skipped", reason: expect.stringContaining("proof-unknown") }),
    ]));
    expect(fsMocks.files.has(join("/home/tester", ".claude", "agents", "reviewer.md"))).toBe(false);
    expect(fsMocks.files.has(join("/home/tester", ".config", "opencode", "agents", "reviewer.md"))).toBe(false);
  });

  it("plans every agent target without creating directories, files, backups, or install state", async () => {
    loadAgentDefinitionsMock.mockResolvedValue([{
      name: "reviewer",
      role: "Review specialist",
      goal: "Review implementation quality",
      tier: "reasoning",
      instructions: "Review only.",
      scope: "project",
    }]);

    const result = await syncNativeAgentProjections("/workspace/project", { dryRun: true });

    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(unlinkSyncMock).not.toHaveBeenCalled();
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.every((outcome) => outcome.status === "planned")).toBe(true);
  });

  it("does not infer an OpenCode projection from its model encoder", async () => {
    loadAgentDefinitionsMock.mockResolvedValue([
      {
        name: "scout",
        role: "Context scout",
        goal: "Map local context",
        tier: "fast",
        targetId: "opencode-unproven",
        authorityProfileId: "foundation-readonly-plan",
        instructions: "Scout only.",
        scope: "project",
      },
    ]);

    const result = await syncNativeAgentProjections("/workspace/project");

    expect(result.errors).toHaveLength(0);
    expect(result.synced).toBe(0);
    expect(result.outcomes).toEqual(expect.arrayContaining([expect.objectContaining({ targetId: "opencode-agent:scout", status: "skipped" })]));
    expect(fsMocks.files.has(join("/home/tester", ".codex", "agents", "scout.toml"))).toBe(false);
  });

  it("removes unchanged fully-owned projections when a route becomes unresolved", async () => {
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
        targetId: "opencode-unproven",
        authorityProfileId: "foundation-readonly-plan",
        instructions: "Scout only.",
        scope: "project",
      },
    ]);

    const second = await syncNativeAgentProjections("/workspace/project");

    expect(second.errors).toHaveLength(0);
    expect(second.synced).toBe(0);
    expect(unlinkSyncMock).toHaveBeenCalledTimes(3);
    expect(second.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "claude-agent:scout", status: "removed" }),
      expect.objectContaining({ targetId: "codex-agent:scout", status: "removed" }),
      expect.objectContaining({ targetId: "opencode-agent:scout", status: "removed" }),
    ]));
    expect(fsMocks.files.has(join("/home/tester", ".codex", "agents", "scout.toml"))).toBe(false);

    const state = JSON.parse(fsMocks.files.get(join("/home/tester", ".kiln", "runtime", "native-projections", "install-state.json")) ?? "{}") as {
      targets: Record<string, unknown>;
    };
    expect(state.targets).toEqual({});
  });

  it("adopts a legacy unchanged agent snapshot before safe unavailable removal", async () => {
    const agent = {
      name: "planner",
      role: "Planning specialist",
      goal: "Produce a verified implementation plan",
      tier: "reasoning" as const,
      instructions: "Plan first.",
      scope: "project" as const,
    };
    loadAgentDefinitionsMock.mockResolvedValueOnce([agent]);
    await syncNativeAgentProjections("/workspace/project");
    const statePath = join("/home/tester", ".kiln", "runtime", "native-projections", "install-state.json");
    const state = JSON.parse(fsMocks.files.get(statePath) ?? "{}") as {
      targets: Record<string, Record<string, unknown>>;
    };
    const target = state.targets["codex-agent:planner"]!;
    delete target.projectionKind;
    delete target.harness;
    delete target.sourceIdentity;
    target.installedContentHash = target.contentHash;
    fsMocks.files.set(statePath, JSON.stringify(state));
    loadAgentDefinitionsMock.mockResolvedValueOnce([{
      ...agent,
      targetId: "opencode-unproven",
      authorityProfileId: "foundation-readonly-plan",
    }]);

    const result = await syncNativeAgentProjections("/workspace/project");

    expect(result.errors).toHaveLength(0);
    expect(unlinkSyncMock).toHaveBeenCalledWith(join("/home/tester", ".codex", "agents", "planner.toml"));
    const migrated = JSON.parse(fsMocks.files.get(statePath) ?? "{}") as {
      targets: Record<string, unknown>;
    };
    expect(migrated.targets).not.toHaveProperty("codex-agent:planner");
  });

  it("blocks and preserves true drift when an unavailable projection is managed", async () => {
    const agent = {
      name: "planner",
      role: "Planning specialist",
      goal: "Produce a verified implementation plan",
      tier: "reasoning" as const,
      instructions: "Plan first.",
      scope: "project" as const,
    };
    loadAgentDefinitionsMock.mockResolvedValueOnce([agent]);
    await syncNativeAgentProjections("/workspace/project");

    const codexPath = join("/home/tester", ".codex", "agents", "planner.toml");
    fsMocks.files.set(codexPath, "operator drift\n");
    loadAgentDefinitionsMock.mockResolvedValueOnce([{
      ...agent,
      targetId: "opencode-unproven",
      authorityProfileId: "foundation-readonly-plan",
    }]);

    const result = await syncNativeAgentProjections("/workspace/project", { force: true });

    expect(result.codex).toBe(false);
    expect(result.errors).toContain(
      "Codex agent \"planner\" failed: managed file drift detected: file content",
    );
    expect(fsMocks.files.get(codexPath)).toBe("operator drift\n");
    expect(unlinkSyncMock).not.toHaveBeenCalledWith(codexPath);
  });

  it("preserves unmanaged files when an unavailable agent cannot be removed", async () => {
    const codexPath = join("/home/tester", ".codex", "agents", "planner.toml");
    fsMocks.files.set(codexPath, "operator-owned\n");
    loadAgentDefinitionsMock.mockResolvedValue([{
      name: "planner",
      role: "Planning specialist",
      goal: "Produce a verified implementation plan",
      tier: "reasoning" as const,
      targetId: "opencode-unproven",
      authorityProfileId: "foundation-readonly-plan",
      instructions: "Plan first.",
      scope: "project" as const,
    }]);

    const result = await syncNativeAgentProjections("/workspace/project");

    expect(result.errors).toHaveLength(0);
    expect(unlinkSyncMock).not.toHaveBeenCalled();
    expect(fsMocks.files.get(codexPath)).toBe("operator-owned\n");
  });

  it("plans unavailable projection removal without mutating files or install state", async () => {
    const agent = {
      name: "planner",
      role: "Planning specialist",
      goal: "Produce a verified implementation plan",
      tier: "reasoning" as const,
      instructions: "Plan first.",
      scope: "project" as const,
    };
    loadAgentDefinitionsMock.mockResolvedValueOnce([agent]);
    await syncNativeAgentProjections("/workspace/project");
    const statePath = join("/home/tester", ".kiln", "runtime", "native-projections", "install-state.json");
    const before = fsMocks.files.get(statePath);
    vi.clearAllMocks();
    unlinkSyncMock.mockImplementation((path: string) => fsMocks.files.delete(path));
    existsSyncMock.mockImplementation((path: string) => fsMocks.files.has(path));
    readFileSyncMock.mockImplementation((path: string) => fsMocks.files.get(path) ?? "");
    loadAgentDefinitionsMock.mockResolvedValueOnce([{
      ...agent,
      targetId: "opencode-unproven",
      authorityProfileId: "foundation-readonly-plan",
    }]);

    const result = await syncNativeAgentProjections("/workspace/project", { dryRun: true });

    expect(result.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "codex-agent:planner", status: "planned" }),
    ]));
    expect(unlinkSyncMock).not.toHaveBeenCalled();
    expect(fsMocks.files.get(statePath)).toBe(before);
  });

  it("removes unchanged projections for an agent omitted from the current catalog", async () => {
    loadAgentDefinitionsMock.mockResolvedValueOnce([{
      name: "retired",
      role: "Retired agent",
      goal: "No longer configured",
      tier: "fast" as const,
      instructions: "Retired.",
      scope: "project" as const,
    }]);
    await syncNativeAgentProjections("/workspace/project");

    loadAgentDefinitionsMock.mockResolvedValueOnce([]);
    const result = await syncNativeAgentProjections("/workspace/project");

    expect(result.errors).toHaveLength(0);
    expect(unlinkSyncMock).toHaveBeenCalledTimes(3);
    expect(result.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "opencode-agent:retired", status: "removed" }),
    ]));
    const state = JSON.parse(fsMocks.files.get(join("/home/tester", ".kiln", "runtime", "native-projections", "install-state.json")) ?? "{}") as {
      targets: Record<string, unknown>;
    };
    expect(state.targets).toEqual({});
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

    writeFileSyncMock.mockImplementation((targetPath: string, content: string) => {
      if (targetPath.includes(".codex")) {
        throw new Error("codex write failed");
      }
      fsMocks.files.set(targetPath, content);
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
    const state = JSON.parse(fsMocks.files.get(join("/home/tester", ".kiln", "runtime", "native-projections", "install-state.json")) ?? "{}") as {
      targets: Record<string, { projectionKind?: string; managedFields: string[]; harness?: string; sourceIdentity?: string }>;
    };
    expect(Object.keys(state.targets).sort()).toEqual([
      "claude-agent:planner",
      "codex-agent:planner",
      "opencode-agent:planner",
    ]);
    expect(state.targets["codex-agent:planner"]).toMatchObject({
      projectionKind: "file",
      managedFields: ["$file"],
      harness: "codex",
      sourceIdentity: "agent:planner",
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
      "Codex agent \"planner\" failed: managed file drift detected: file content",
    ]);
    expect(fsMocks.files.get(codexAgentPath)).toBe("user drift\n");

    const forced = await syncNativeAgentProjections("/workspace/project", { force: true });

    expect(forced.codex).toBe(true);
    expect(forced.errors).toHaveLength(0);
    expect(fsMocks.files.get(codexAgentPath)).toContain('name = "planner"');
  });

  describe("with a harness-specific config dir env var set", () => {
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      savedEnv.CODEX_HOME = process.env.CODEX_HOME;
      process.env.CODEX_HOME = "/scratch/codex-home";
    });

    afterEach(() => {
      if (savedEnv.CODEX_HOME === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = savedEnv.CODEX_HOME;
      }
    });

    it("writes to CODEX_HOME instead of the OS home directory, matching what Codex itself reads", async () => {
      loadAgentDefinitionsMock.mockResolvedValue([
        {
          name: "scout",
          role: "Discovery specialist",
          goal: "Map the affected surface",
          tier: "reasoning",
          instructions: "Scout first.",
          scope: "project",
        },
      ]);

      const result = await syncNativeAgentProjections("/workspace/project");

      expect(result.errors).toHaveLength(0);
      expect(fsMocks.files.has(join("/scratch/codex-home", "agents", "scout.toml"))).toBe(true);
      expect(fsMocks.files.has(join("/home/tester", ".codex", "agents", "scout.toml"))).toBe(false);
    });
  });
});
