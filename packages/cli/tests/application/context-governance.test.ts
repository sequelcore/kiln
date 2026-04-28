import { describe, expect, it, vi } from "vitest";
import type { DomainConfig } from "@kilnai/core";
import type { SessionContext } from "../../src/wrapper/index.js";
import { governSessionContext } from "../../src/application/context-governance.js";

const DOMAIN: DomainConfig = {
  name: "generic",
  displayName: "Generic",
  detectPatterns: [],
  toolTags: new Set(),
  qualityGates: [],
  multishotExamples: "",
  phaseExamples: "",
};

function makeContext(
  projectedContext: SessionContext["projectedContext"]
): SessionContext {
  return {
    mode: "api-key",
    domain: DOMAIN,
    systemPrompt: "",
    projectedContext,
    memorySnapshot: undefined,
    mcpServerEntryPath: "",
    workingDirectory: process.cwd(),
    task: "Test task",
    resumeStrategy: "none",
  };
}

describe("governSessionContext", () => {
  it("removes memory blocks from projectedContext when excludeFromContext is true", () => {
    const context = makeContext({
      blocks: [
        { id: "1", kind: "memory", source: "test", content: "sensitive memory", required: false, score: 0, estimatedTokens: 100 },
        { id: "2", kind: "artifact", source: "test", content: "some artifact", required: false, score: 0, estimatedTokens: 50 },
      ],
      estimatedTokens: 150,
    });

    const governed = governSessionContext(context, {
      approval: "on-request",
      sandbox: "read-only",
      fileGovernance: { excludeFromContext: true },
    });

    expect(governed.projectedContext?.blocks).toHaveLength(1);
    expect(governed.projectedContext?.blocks[0]?.kind).toBe("artifact");
  });

  it("preserves projectedContext when excludeFromContext is false", () => {
    const context = makeContext({
      blocks: [
        { id: "1", kind: "memory", source: "test", content: "normal memory", required: false, score: 0, estimatedTokens: 100 },
        { id: "2", kind: "artifact", source: "test", content: "some artifact", required: false, score: 0, estimatedTokens: 50 },
      ],
      estimatedTokens: 150,
    });

    const governed = governSessionContext(context, {
      approval: "on-request",
      sandbox: "read-only",
      fileGovernance: { excludeFromContext: false },
    });

    expect(governed.projectedContext?.blocks).toHaveLength(2);
  });
});

describe("runSession context governance integration", () => {
  it("uses governed context when building prompt", async () => {
    const buildPreambleMock = vi.fn(() => "PROMPT");
    vi.doMock("../../src/wrapper/preamble-builder.js", () => ({
      buildPreamble: buildPreambleMock,
    }));

    const { runSession } = await import("../../src/application/run-session.js");

    const fakeSession = {
      run: async function* () {
        yield {
          type: "completed",
          totalUsd: 0,
          durationMs: 1,
          isError: false,
          isPreflightCrash: false,
        } as const;
      },
      dispose: async () => {},
    };

    const context = makeContext({
      blocks: [
        { id: "1", kind: "memory", source: "test", content: "sensitive memory", required: false, score: 0, estimatedTokens: 100 },
      ],
      estimatedTokens: 100,
    });

    const registry = {
      selectBest: () => ({
        primary: "claude",
        orderedFallbacks: [],
        scores: [],
      }),
      createSession: () => fakeSession,
      reportFailure: () => {},
      reportSuccess: () => {},
    };

    const cleanupRegistry = {
      register: () => {},
    };

    const manager = {
      trackCostUpdate: () => {},
    };

    const sessionHooks = {
      userPromptSubmit: () => {},
      preToolUse: () => {},
      postToolUse: () => {},
    };

    const result = await runSession({
      registry: registry as any,
      cleanupRegistry: cleanupRegistry as any,
      manager: manager as any,
      context,
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: { approval: "on-request", sandbox: "read-only" },
      },
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
        fileGovernance: { excludeFromContext: true },
      },
      env: {},
      sessionHooks: sessionHooks as any,
    });

    expect(result.sessionSucceeded).toBe(true);
    expect(buildPreambleMock).toHaveBeenCalledTimes(1);
    const governedContext = buildPreambleMock.mock.calls[0]?.[0] as SessionContext;
    expect(governedContext.projectedContext?.blocks?.length).toBe(0);

    vi.doUnmock("../../src/wrapper/preamble-builder.js");
  }, 10_000);
});
