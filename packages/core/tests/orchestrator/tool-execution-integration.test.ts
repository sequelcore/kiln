import { describe, expect, it } from "vitest";
import { KilnError } from "../../src/engine/errors.js";
import type {
  ToolAuthorizedEvent,
  ToolCalledEvent,
  ToolResultEvent,
} from "../../src/events/index.js";
import { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import type { ActionEffectEnvelope } from "../../src/engine/domain/action-effect.js";
import type { DevTool, ToolInput, ToolResult } from "../../src/tools/domain/tool.js";

const READ_ONLY_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["process", "workspace"],
  reversibility: "reversible",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

const MUTATION_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "workspace"],
  reversibility: "irreversible",
  dataEgress: "project-data",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "non-idempotent",
};

function makeTool(
  name: string,
  executeFn: (input: ToolInput, sandbox?: unknown) => Promise<ToolResult>,
  effectEnvelope: ActionEffectEnvelope = READ_ONLY_EFFECT,
): DevTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    effectEnvelope,
    execute: executeFn,
  };
}

describe("Orchestrator native tool execution path", () => {
  it("registers and executes a native tool via executeDevTool and emits tool events", async () => {
    const orchestrator = new Orchestrator();
    const sessionId = orchestrator.start("execute native tool");
    orchestrator.registerDevTool(
      makeTool(
        "echo",
        async (input) => ({
          output: JSON.stringify(input.input),
          isError: false,
        }),
      ),
    );

    const result = await orchestrator.executeDevTool({
      toolCallScopeId: "turn-1:response:1",
      name: "echo",
      input: { message: "hello" },
    });

    expect(result.result).toEqual({
      output: JSON.stringify({ message: "hello" }),
      isError: false,
    });
    expect(result.attempts).toBe(1);
    expect(result.fallbackUsed).toBe(false);

    const toolEvents = orchestrator.eventBus.history().filter((event) => {
      return event.type === "tool_called" || event.type === "tool_authorized" || event.type === "tool_result";
    });
    expect(toolEvents).toHaveLength(3);

    const called = toolEvents[0] as ToolCalledEvent;
    expect(called.type).toBe("tool_called");
    expect(called.toolCallId).toEqual(expect.any(String));
    expect(called.toolCallScopeId).toBe("turn-1:response:1");
    expect(called.toolName).toBe("echo");
    expect(called.toolInput).toEqual({ message: "hello" });
    expect(called.taskId).toBe("execute native tool");
    expect(called.resolvedEffect).toBeUndefined();
    expect(called.authorizationLevel).toBeUndefined();
    expect(called.sessionId).toBe(sessionId);

    const authorized = toolEvents[1] as ToolAuthorizedEvent;
    expect(authorized.type).toBe("tool_authorized");
    expect(authorized.toolName).toBe("echo");
    expect(authorized.allowed).toBe(true);
    expect(authorized.level).toBe(1);
    expect(authorized.reason.length).toBeGreaterThan(0);
    expect(authorized.resolvedEffect).toMatchObject(READ_ONLY_EFFECT);
    expect(authorized.authority).toMatchObject({ level: 1, allowed: true });
    expect(authorized.sessionId).toBe(sessionId);

    const executed = toolEvents[2] as ToolResultEvent;
    expect(executed.type).toBe("tool_result");
    expect(executed.toolCallId).toBe(called.toolCallId);
    expect(executed.toolCallScopeId).toBe(called.toolCallScopeId);
    expect(executed.toolName).toBe("echo");
    expect(executed.taskId).toBe("execute native tool");
    expect(executed.success).toBe(true);
    expect(executed.isError).toBe(false);
    expect(executed.retryAttempt).toBe(1);
    expect(executed.resultSummary).toBe(JSON.stringify({ message: "hello" }));
    expect(executed.resolvedEffect).toMatchObject(READ_ONLY_EFFECT);
    expect(executed.authority).toMatchObject({ level: 1, allowed: true });
    expect(executed.durationMs).toBeGreaterThanOrEqual(0);
    expect(executed.sessionId).toBe(sessionId);
  });

  it("preserves upstream tool call identity through native tool execution", async () => {
    const orchestrator = new Orchestrator();
    orchestrator.start("execute correlated native tool");
    orchestrator.registerDevTool(
      makeTool(
        "echo",
        async (input) => ({
          output: JSON.stringify(input.input),
          isError: false,
        }),
      ),
    );

    await orchestrator.executeDevTool({
      toolCallId: "provider-tool-call-1",
      toolCallScopeId: "turn-1:response:1",
      name: "echo",
      input: { message: "hello" },
    });

    const toolEvents = orchestrator.eventBus.history().filter((event) => {
      return event.type === "tool_called" || event.type === "tool_result";
    });

    expect(toolEvents).toHaveLength(2);
    expect(toolEvents[0]).toMatchObject({
      type: "tool_called",
      toolCallId: "provider-tool-call-1",
      toolCallScopeId: "turn-1:response:1",
      toolName: "echo",
    });
    expect(toolEvents[1]).toMatchObject({
      type: "tool_result",
      toolCallId: "provider-tool-call-1",
      toolCallScopeId: "turn-1:response:1",
      toolName: "echo",
      success: true,
    });
  });

  it("emits the same native tool identity when execution fails", async () => {
    const orchestrator = new Orchestrator();
    orchestrator.start("execute failing native tool");
    orchestrator.registerDevTool(
      makeTool("explode", async () => {
        throw new Error("boom");
      }),
    );

    await expect(
      orchestrator.executeDevTool({
        toolCallId: "provider-tool-call-failed",
        toolCallScopeId: "turn-1:response:1",
        name: "explode",
        input: {},
      }),
    ).rejects.toThrow("Tool \"explode\" failed after 3 attempts");

    const toolEvents = orchestrator.eventBus.history().filter((event) => {
      return event.type === "tool_called" || event.type === "tool_result";
    });

    expect(toolEvents).toHaveLength(2);
    expect(toolEvents[0]).toMatchObject({
      type: "tool_called",
      toolCallId: "provider-tool-call-failed",
      toolName: "explode",
    });
    expect(toolEvents[1]).toMatchObject({
      type: "tool_result",
      toolCallId: "provider-tool-call-failed",
      toolName: "explode",
      success: false,
      isError: true,
      resultSummary: "Tool \"explode\" failed after 3 attempts",
    });
  });

  it("returns INTERNAL_ERROR when tool is not registered", async () => {
    const orchestrator = new Orchestrator();

    await expect(
      orchestrator.executeDevTool({
        toolCallScopeId: "turn-1:response:1",
        name: "missing",
        input: {},
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    } satisfies Partial<KilnError>);
  });

  it("denies destructive tools through canonical action-effect authority", async () => {
    const orchestrator = new Orchestrator();
    orchestrator.start("deny destructive tool");
    orchestrator.registerDevTool(
      makeTool(
        "write",
        async () => ({
          output: "ok",
          isError: false,
        }),
        MUTATION_EFFECT,
      ),
    );

    await expect(
      orchestrator.executeDevTool({
        toolCallScopeId: "turn-1:response:1",
        name: "write",
        input: { filePath: "x.txt", content: "x" },
      }),
    ).rejects.toMatchObject({
      code: "TOOL_AUTHORIZATION_DENIED",
    } satisfies Partial<KilnError>);

    const toolEvents = orchestrator.eventBus.history().filter((event) => {
      return event.type === "tool_called" || event.type === "tool_authorized" || event.type === "tool_result";
    });
    expect(toolEvents.map((event) => event.type)).toEqual([
      "tool_called",
      "tool_authorized",
      "tool_result",
    ]);

    const authorized = toolEvents[1] as ToolAuthorizedEvent;
    expect(authorized.allowed).toBe(false);
    expect(authorized.level).toBe(4);

    const called = toolEvents[0] as ToolCalledEvent;
    expect(called.authorizationLevel).toBeUndefined();

    const result = toolEvents[2] as ToolResultEvent;
    expect(result.toolCallId).toBe(called.toolCallId);
    expect(result.success).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.authority).toEqual(authorized.authority);
  });

  it("injects role sandbox policy when role is provided", async () => {
    const orchestrator = new Orchestrator();
    orchestrator.initSandbox("C:/workspace");
    orchestrator.registerDevTool(
      makeTool("inspect", async (_input, sandbox) => {
        const context = sandbox as { cwd?: string; policy?: unknown } | undefined;
        return {
          output: "ok",
          isError: false,
          metadata: {
            hasPolicy: Boolean(context?.policy),
            cwd: context?.cwd ?? null,
          },
        };
      }, READ_ONLY_EFFECT),
    );

    const result = await orchestrator.executeDevTool({
      toolCallScopeId: "turn-1:response:1",
      name: "inspect",
      input: {},
      role: "worker",
      cwd: "C:/workspace",
    });

    expect(result.result.metadata).toEqual({
      hasPolicy: true,
      cwd: "C:/workspace",
    });
  });

  it("honors request-level authority descriptor in native execution path", async () => {
    const orchestrator = new Orchestrator();
    orchestrator.start("authority descriptor deny");
    orchestrator.registerDevTool(
      makeTool(
        "echo",
        async (input) => ({
          output: JSON.stringify(input.input),
          isError: false,
        }),
      ),
    );

    await expect(
      orchestrator.executeDevTool({
        toolCallScopeId: "turn-1:response:1",
        name: "echo",
        input: { message: "hello" },
        authority: {
          level: 4,
          allowed: false,
          requiresApproval: false,
          reason: "Tenant policy denies this call",
        },
      }),
    ).rejects.toMatchObject({
      code: "TOOL_AUTHORIZATION_DENIED",
    } satisfies Partial<KilnError>);
  });
});
