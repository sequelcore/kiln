import { describe, expect, it, vi } from "vitest";
import type { DomainConfig } from "@kilnai/core/domain";
import type { SessionContext } from "../../src/wrapper/index.js";
import type { SessionRunOptions } from "../../src/wrapper/session.js";
import { governSessionContext } from "../../src/application/context-governance.js";

const runSessionMocks = vi.hoisted(() => ({
  buildPreamble: vi.fn((_context: SessionContext) => "PROMPT"),
}));

vi.mock("../../src/wrapper/preamble-builder.js", () => ({
  buildPreamble: runSessionMocks.buildPreamble,
}));

import { runSession } from "../../src/application/run-session.js";

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
  projectedContext: SessionContext["projectedContext"],
  systemPrompt = "",
): SessionContext {
  return {
    mode: "api-key",
    domain: DOMAIN,
    systemPrompt,
    projectedContext,
    mcpServerEntryPath: "",
    workingDirectory: process.cwd(),
    task: "Test task",
    resumeStrategy: "none",
  };
}

function makeRunSessionHarness(context: SessionContext) {
  const run = vi.fn(async function* (_options: SessionRunOptions) {
    yield {
      type: "completed",
      totalUsd: 0,
      durationMs: 1,
      outcome: "completed",
      isPreflightCrash: false,
    } as const;
  });

  const fakeSession = {
    run,
    dispose: async () => {},
  };

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

  const runWithPolicy = (permissionPolicy: { approval: "on-request"; sandbox: "read-only"; fileGovernance?: { excludeFromContext: boolean } }) =>
    runSession({
      registry: registry as any,
      cleanupRegistry: cleanupRegistry as any,
      manager: manager as any,
      context,
      requirements: {},
      sessionConfig: {
        task: "test",
        permissionPolicy: { approval: "on-request", sandbox: "read-only" },
      },
      permissionPolicy,
      env: {},
      sessionHooks: sessionHooks as any,
    });

  return { run, runWithPolicy };
}

describe("governSessionContext", () => {
  it("removes memory blocks from projectedContext when excludeFromContext is true", () => {
    const context = makeContext({
      blocks: [
        { id: "1", kind: "memory", modelFacingSemantics: "evidence", source: "test", content: "sensitive memory", required: false, score: 0, estimatedTokens: 100 },
        { id: "2", kind: "artifact", modelFacingSemantics: "evidence", source: "test", content: "some artifact", required: false, score: 0, estimatedTokens: 50 },
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
        { id: "1", kind: "memory", modelFacingSemantics: "evidence", source: "test", content: "normal memory", required: false, score: 0, estimatedTokens: 100 },
        { id: "2", kind: "artifact", modelFacingSemantics: "evidence", source: "test", content: "some artifact", required: false, score: 0, estimatedTokens: 50 },
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
    runSessionMocks.buildPreamble.mockClear();
    const context = makeContext({
      blocks: [
        { id: "1", kind: "memory", modelFacingSemantics: "evidence", source: "test", content: "sensitive memory", required: false, score: 0, estimatedTokens: 100 },
      ],
      estimatedTokens: 100,
    });

    const { run, runWithPolicy } = makeRunSessionHarness(context);

    const result = await runWithPolicy({
      approval: "on-request",
      sandbox: "read-only",
      fileGovernance: { excludeFromContext: true },
    });

    expect(result.sessionSucceeded).toBe(true);
    expect(runSessionMocks.buildPreamble).toHaveBeenCalledTimes(1);
    const governedContext = runSessionMocks.buildPreamble.mock.calls[0]![0];
    expect(governedContext.projectedContext?.blocks?.length).toBe(0);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "PROMPT",
      promptKind: "kiln-preamble",
    }));
  }, 10_000);

  // Regression for #59: SessionManager.prepare() builds `context.systemPrompt`
  // before the real per-turn permission policy is known (it always uses
  // DEFAULT_POLICY). Passing that stale, pre-rendered value through as
  // `system` on the turn request let excluded content survive filtering by
  // completely bypassing the governed projection. The turn request must
  // carry only the current governed prompt.
  it("never forwards the stale prepared systemPrompt as the turn's system value, even when it contains excluded content", async () => {
    runSessionMocks.buildPreamble.mockClear();
    const excludedMarker = "KILN_TEST_MARKER_STALE_MEMORY_7f3a1c";
    const context = makeContext(
      {
        blocks: [
          { id: "1", kind: "memory", modelFacingSemantics: "evidence", source: "test", content: excludedMarker, required: false, score: 0, estimatedTokens: 100 },
        ],
        estimatedTokens: 100,
      },
      `<kiln-preamble>${excludedMarker}</kiln-preamble>`,
    );

    const { run, runWithPolicy } = makeRunSessionHarness(context);

    await runWithPolicy({
      approval: "on-request",
      sandbox: "read-only",
      fileGovernance: { excludeFromContext: true },
    });

    const callOptions = run.mock.calls[0]![0];
    expect(callOptions.system).toBeUndefined();
    expect(callOptions.prompt).not.toContain(excludedMarker);
  }, 10_000);

  it("retains non-excluded governed context when excludeFromContext is false, without forwarding a separate stale system value", async () => {
    runSessionMocks.buildPreamble.mockClear();
    const retainedMarker = "KILN_TEST_MARKER_RETAINED_9d2e0b";
    const context = makeContext(
      {
        blocks: [
          { id: "1", kind: "memory", modelFacingSemantics: "evidence", source: "test", content: retainedMarker, required: false, score: 0, estimatedTokens: 100 },
        ],
        estimatedTokens: 100,
      },
      "stale prepared prompt that must never reach the provider",
    );

    const { run, runWithPolicy } = makeRunSessionHarness(context);

    await runWithPolicy({
      approval: "on-request",
      sandbox: "read-only",
      fileGovernance: { excludeFromContext: false },
    });

    const governedContext = runSessionMocks.buildPreamble.mock.calls[0]![0];
    expect(governedContext.projectedContext?.blocks?.some((block) => block.content === retainedMarker)).toBe(true);

    const callOptions = run.mock.calls[0]![0];
    expect(callOptions.system).toBeUndefined();
  }, 10_000);
});
