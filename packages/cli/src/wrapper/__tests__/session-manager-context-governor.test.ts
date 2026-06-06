import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const {
  coreGovernorConstructorMock,
  coreGovernorProjectMock,
  projectedContextFromCore,
} = vi.hoisted(() => ({
  coreGovernorConstructorMock: vi.fn(),
  coreGovernorProjectMock: vi.fn(),
  projectedContextFromCore: {
    blocks: [],
    estimatedTokens: 137,
    tokenBudget: 900,
    deferredBlocks: [],
    overflow: false,
  },
}));

vi.mock("@kilnai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/core")>();
  class MockCoreDefaultContextGovernor {
    constructor() {
      coreGovernorConstructorMock();
    }

    project = coreGovernorProjectMock;
  }

  return {
    ...actual,
    Orchestrator: class {
      readonly costSummary = undefined;
      readonly currentPhase = "analyze";
      readonly task = "";
    },
    GateRunner: class {},
    VerificationLoop: class {},
    EventBus: class {},
    DefaultContextGovernor: MockCoreDefaultContextGovernor,
  };
});

describe("SessionManager context governor integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    coreGovernorProjectMock.mockReturnValue(projectedContextFromCore);
  });

  it("uses the core DefaultContextGovernor when preparing projected context", async () => {
    const { SessionManager } = await import("../session-manager.js");

    const registry = {
      loadInstalledDomains: vi.fn(),
      detectAndMerge: vi.fn().mockReturnValue({ displayName: "CLI Test Domain" }),
    };
    const buildSystemPrompt = vi.fn().mockReturnValue("system prompt");
    const artifactCache = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
      delete: vi.fn().mockReturnValue(false),
      listByKind: vi.fn().mockReturnValue([]),
    };
    const manager = new SessionManager(
      { mode: "api-key", permissionPolicy: {} as never },
      {
        createRegistry: () => registry as never,
        buildSystemPrompt,
      },
      artifactCache,
    );

    await expect(
      manager.prepare("prove core governor usage", "/workspace/project", "memory snapshot"),
    ).resolves.toMatchObject({
      projectedContext: projectedContextFromCore,
      systemPrompt: "system prompt",
    });

    expect(coreGovernorConstructorMock).toHaveBeenCalledTimes(1);
    expect(coreGovernorProjectMock).toHaveBeenCalledTimes(1);
    expect(buildSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        projectedContext: projectedContextFromCore,
      }),
    );
  });

  it("passes the core governor contract shape instead of the CLI-local one", async () => {
    const { SessionManager } = await import("../session-manager.js");

    const artifactCache = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
      delete: vi.fn().mockReturnValue(false),
      listByKind: vi.fn().mockReturnValue([]),
    };
    const manager = new SessionManager(
      { mode: "api-key", permissionPolicy: {} as never },
      {
        createRegistry: () => ({
          loadInstalledDomains: vi.fn(),
          detectAndMerge: vi.fn().mockReturnValue({ displayName: "CLI Test Domain" }),
        }) as never,
        buildSystemPrompt: vi.fn().mockReturnValue("system prompt"),
        kilnYaml: {
          contextGovernance: {
            turnBudget: 900,
            preferredSources: ["summary"],
            summaryAggressiveness: "high",
          },
        } as never,
      },
      artifactCache,
    );

    await manager.prepare(
      "shape test",
      "/workspace/project",
      "memory snapshot",
      false,
      "resume-shape",
    );

    expect(coreGovernorProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactCache,
        renderLedger: expect.any(Function),
        tokenBudget: 900,
        preferredSources: ["summary"],
        summaryAggressiveness: "high",
        memorySnapshot: "memory snapshot",
        aggressivenessPolicy: {
          low: { summaryBonus: -0.08, artifactPenalty: 0 },
          medium: { summaryBonus: 0, artifactPenalty: 0 },
          high: { summaryBonus: 0.12, artifactPenalty: 0.08 },
        },
      }),
    );
    expect(coreGovernorProjectMock.mock.calls[0]?.[0]).not.toHaveProperty("cache");
  });

  it("defaults missing summary aggressiveness to medium", async () => {
    const { SessionManager } = await import("../session-manager.js");

    const artifactCache = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
      delete: vi.fn().mockReturnValue(false),
      listByKind: vi.fn().mockReturnValue([]),
    };
    const manager = new SessionManager(
      { mode: "api-key", permissionPolicy: {} as never },
      {
        createRegistry: () => ({
          loadInstalledDomains: vi.fn(),
          detectAndMerge: vi.fn().mockReturnValue({ displayName: "CLI Test Domain" }),
        }) as never,
        buildSystemPrompt: vi.fn().mockReturnValue("system prompt"),
      },
      artifactCache,
    );

    await manager.prepare("default aggressiveness", "/workspace/project");

    expect(coreGovernorProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        summaryAggressiveness: "medium",
      }),
    );
  });

  it("passes app-level context candidates into the core governor", async () => {
    const { SessionManager } = await import("../session-manager.js");

    const artifactCache = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
      delete: vi.fn().mockReturnValue(false),
      listByKind: vi.fn().mockReturnValue([]),
    };
    const contextCandidates = [{
      kind: "procedural" as const,
      source: "runtime-skill:/workspace/project/.kiln/skills/review/SKILL.md",
      content: "Skill\nname: review",
      required: true,
    }];
    const manager = new SessionManager(
      { mode: "api-key", permissionPolicy: {} as never },
      {
        createRegistry: () => ({
          loadInstalledDomains: vi.fn(),
          detectAndMerge: vi.fn().mockReturnValue({ displayName: "CLI Test Domain" }),
        }) as never,
        buildSystemPrompt: vi.fn().mockReturnValue("system prompt"),
        contextCandidates,
      },
      artifactCache,
    );

    await manager.prepare("candidate test", "/workspace/project");

    expect(coreGovernorProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        artifacts: contextCandidates,
      }),
    );
  });

  it("does not inject cached historical summaries into fresh sessions", async () => {
    const { SessionManager } = await import("../session-manager.js");

    const artifactCache = {
      get: vi.fn().mockReturnValue({
        key: "context-artifact",
        kind: "project-summary",
        content: "Project-level historical evidence.\nPrevious task",
        createdAt: new Date("2026-06-06T00:00:00.000Z"),
        updatedAt: new Date("2026-06-06T00:00:00.000Z"),
      }),
      set: vi.fn(),
      delete: vi.fn().mockReturnValue(false),
      listByKind: vi.fn().mockReturnValue([]),
    };
    const manager = new SessionManager(
      { mode: "api-key", permissionPolicy: {} as never },
      {
        createRegistry: () => ({
          loadInstalledDomains: vi.fn(),
          detectAndMerge: vi.fn().mockReturnValue({ displayName: "CLI Test Domain" }),
        }) as never,
        buildSystemPrompt: vi.fn().mockReturnValue("system prompt"),
      },
      artifactCache,
    );

    await manager.prepare("fresh task", "/workspace/project");

    const input = coreGovernorProjectMock.mock.calls[0]?.[0];

    expect(input).toMatchObject({
      artifactCache: undefined,
      projectArtifactKey: undefined,
      planArtifactKey: undefined,
      sessionArtifactKey: undefined,
      moduleArtifactKeys: [],
    });
    expect(artifactCache.get).not.toHaveBeenCalled();
  });

  it("passes resume ledger and replay artifacts through the core renderLedger path", async () => {
    const { SessionManager } = await import("../session-manager.js");

    const artifactCache = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
      delete: vi.fn().mockReturnValue(false),
      listByKind: vi.fn().mockReturnValue([]),
    };
    const manager = new SessionManager(
      { mode: "api-key", permissionPolicy: {} as never },
      {
        createRegistry: () => ({
          loadInstalledDomains: vi.fn(),
          detectAndMerge: vi.fn().mockReturnValue({ displayName: "CLI Test Domain" }),
        }) as never,
        buildSystemPrompt: vi.fn().mockReturnValue("system prompt"),
      },
      artifactCache,
    );

    await manager.prepare(
      "resume test",
      "/workspace/project",
      undefined,
      false,
      "resume-123",
      {
        kilnSessionId: "resume-123",
        provider: "codex",
        task: "previous task",
        startedAt: "2026-04-27T00:00:00.000Z",
        sessionLedger: {
          currentPhase: "verify",
          lastProvider: "codex",
          toolCallCount: 4,
          turnDepth: 7,
        },
        exactArtifacts: ["Replay artifact A", "Replay artifact B"],
      },
    );

    const input = coreGovernorProjectMock.mock.calls[0]?.[0];

    expect(input).toMatchObject({
      artifactCache,
      projectArtifactKey: "project-summary:/workspace/project",
      planArtifactKey: "plan-summary:/workspace/project:resume-test",
      sessionArtifactKey: "session-summary:resume-123",
      sessionLedger: expect.objectContaining({
        currentPhase: "verify",
        resumedFrom: "resume-123",
        workingDirectory: "/workspace/project",
        lastProvider: "codex",
        toolCallCount: 4,
        turnDepth: 7,
      }),
      exactArtifacts: expect.any(Array),
    });
    expect(input?.renderLedger?.(input.sessionLedger)).toContain("Resumed from session: resume-123");
  });

  it("does not re-export the deleted CLI-local governor surface", () => {
    const sourceIndexUrl = new URL("../index.ts", import.meta.url);
    const wrapperIndexUrl = existsSync(sourceIndexUrl)
      ? sourceIndexUrl
      : new URL("../../../src/wrapper/index.ts", import.meta.url);
    const wrapperIndex = readFileSync(wrapperIndexUrl, "utf8");

    expect(wrapperIndex).not.toContain("../application/context-governor.js");
    expect(wrapperIndex).not.toContain("DefaultContextGovernor");
    expect(wrapperIndex).not.toContain("ContextGovernor");
    expect(wrapperIndex).not.toContain("ProjectContextInput");
  });
});
