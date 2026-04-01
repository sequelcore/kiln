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

function makeContext(memorySnapshot: string | undefined): SessionContext {
  return {
    mode: "api-key",
    domain: DOMAIN,
    systemPrompt: "",
    memorySnapshot,
    mcpServerEntryPath: "",
    workingDirectory: process.cwd(),
    task: "Test task",
  };
}

describe("governSessionContext", () => {
  it("removes memorySnapshot when excludeFromContext is true", () => {
    const context = makeContext("sensitive memory");

    const governed = governSessionContext(context, {
      approval: "on-request",
      sandbox: "read-only",
      fileGovernance: { excludeFromContext: true },
    });

    expect(governed.memorySnapshot).toBeUndefined();
  });

  it("preserves memorySnapshot when excludeFromContext is false", () => {
    const context = makeContext("normal memory");

    const governed = governSessionContext(context, {
      approval: "on-request",
      sandbox: "read-only",
      fileGovernance: { excludeFromContext: false },
    });

    expect(governed.memorySnapshot).toBe("normal memory");
  });

  it("preserves memorySnapshot when excludeFromContext is undefined", () => {
    const context = makeContext("default memory");

    const governed = governSessionContext(context, {
      approval: "on-request",
      sandbox: "read-only",
    });

    expect(governed.memorySnapshot).toBe("default memory");
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

    const context = makeContext("sensitive memory");

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
    expect(governedContext.memorySnapshot).toBeUndefined();

    vi.doUnmock("../../src/wrapper/preamble-builder.js");
  });
});
