import { describe, expect, it } from "vitest";
import { AnnotationAuthorizer } from "../../src/security/annotation-authorizer.js";
import { KilnError } from "../../src/engine/errors.js";
import { DevToolRegistry } from "../../src/tools/domain/tool-registry.js";
import type { DevTool, ToolInput, ToolResult } from "../../src/tools/domain/tool.js";
import { DevToolExecutionBridge } from "../../src/tools/tool-executor.js";

function makeTool(
  name: string,
  executeFn: (input: ToolInput) => Promise<ToolResult>,
  annotations?: DevTool["annotations"],
): DevTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    annotations,
    execute: executeFn,
  };
}

describe("DevToolExecutionBridge", () => {
  it("authorizeRequest returns default allow decision for registered tool", () => {
    const registry = new DevToolRegistry();
    registry.register(
      makeTool("echo", async (input) => ({
        output: JSON.stringify(input.input),
        isError: false,
      })),
    );

    const bridge = new DevToolExecutionBridge({ registry });
    const decision = bridge.authorizeRequest("echo");

    expect(decision.toolName).toBe("echo");
    expect(decision.level).toBe(2);
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it("authorizeRequest returns destructive denial decision with authorizer", () => {
    const registry = new DevToolRegistry();
    registry.register(
      makeTool(
        "write",
        async () => ({
          output: "ok",
          isError: false,
        }),
        { destructive: true },
      ),
    );

    const bridge = new DevToolExecutionBridge({
      registry,
      authorizer: new AnnotationAuthorizer(),
    });
    const decision = bridge.authorizeRequest("write");

    expect(decision.toolName).toBe("write");
    expect(decision.level).toBe(4);
    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it("authorizeRequest throws INTERNAL_ERROR for unknown tool", () => {
    const bridge = new DevToolExecutionBridge({
      registry: new DevToolRegistry(),
    });

    expect(() => bridge.authorizeRequest("missing")).toThrowError(
      expect.objectContaining({
        code: "INTERNAL_ERROR",
      } satisfies Partial<KilnError>),
    );
  });

  it("executes a registered tool and returns ToolExecutionResult metadata", async () => {
    const registry = new DevToolRegistry();
    registry.register(
      makeTool("echo", async (input) => ({
        output: JSON.stringify(input.input),
        isError: false,
      })),
    );

    const bridge = new DevToolExecutionBridge({ registry });
    const result = await bridge.execute({
      name: "echo",
      input: { message: "hello" },
    });

    expect(result.result).toEqual({
      output: JSON.stringify({ message: "hello" }),
      isError: false,
    });
    expect(result.attempts).toBe(1);
    expect(result.fallbackUsed).toBe(false);
  });

  it("throws when the requested tool is not registered", async () => {
    const bridge = new DevToolExecutionBridge({
      registry: new DevToolRegistry(),
    });

    await expect(
      bridge.execute({
        name: "missing",
        input: {},
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    } satisfies Partial<KilnError>);
  });

  it("applies existing authorizer decisions", async () => {
    const registry = new DevToolRegistry();
    registry.register(
      makeTool(
        "write",
        async () => ({
          output: "ok",
          isError: false,
        }),
        { destructive: true },
      ),
    );

    const bridge = new DevToolExecutionBridge({
      registry,
      authorizer: new AnnotationAuthorizer(),
    });

    await expect(
      bridge.execute({
        name: "write",
        input: { filePath: "x.txt", content: "x" },
      }),
    ).rejects.toMatchObject({
      code: "TOOL_AUTHORIZATION_DENIED",
    } satisfies Partial<KilnError>);
  });

  it("retries transient failures with executeWithRetry", async () => {
    const registry = new DevToolRegistry();
    let attempts = 0;

    registry.register(
      makeTool("flaky", async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("HTTP 503 Service Unavailable");
        }

        return {
          output: "recovered",
          isError: false,
        };
      }),
    );

    const bridge = new DevToolExecutionBridge({ registry });
    const result = await bridge.execute({
      name: "flaky",
      input: {},
      retry: {
        onTransientError: "exponential",
        maxAttempts: 2,
      },
    });

    expect(result.result.output).toBe("recovered");
    expect(result.attempts).toBe(2);
    expect(result.fallbackUsed).toBe(false);
  });

  it("uses fallback tool via retry wrapper when configured", async () => {
    const registry = new DevToolRegistry();
    registry.register(
      makeTool("primary", async () => {
        throw new Error("HTTP 503 Service Unavailable");
      }),
    );
    registry.register(
      makeTool("fallback", async () => ({
        output: "from fallback",
        isError: false,
      })),
    );

    const bridge = new DevToolExecutionBridge({ registry });
    const result = await bridge.execute({
      name: "primary",
      input: {},
      retry: {
        onTransientError: "exponential",
        maxAttempts: 1,
        fallback: "fallback",
      },
    });

    expect(result.result.output).toBe("from fallback");
    expect(result.attempts).toBe(1);
    expect(result.fallbackUsed).toBe(true);
  });
});
