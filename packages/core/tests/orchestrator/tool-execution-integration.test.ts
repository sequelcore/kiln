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

  it("returns INTERNAL_ERROR when tool is not registered", async () => {
    const orchestrator = new Orchestrator();

    await expect(
      orchestrator.executeDevTool({
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
    ]);

    const authorized = toolEvents[1] as ToolAuthorizedEvent;
    expect(authorized.allowed).toBe(false);
    expect(authorized.level).toBe(4);

    const called = toolEvents[0] as ToolCalledEvent;
    expect(called.authorizationLevel).toBeUndefined();
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
