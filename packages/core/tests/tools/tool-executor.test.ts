import { describe, expect, it, vi } from "vitest";
import { ActionEffectAuthorizer } from "../../src/security/action-effect-authorizer.js";
import type { ActionEffectEnvelope } from "../../src/engine/domain/action-effect.js";
import { KilnError } from "../../src/engine/errors.js";
import { DevToolRegistry } from "../../src/tools/domain/tool-registry.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../../src/tools/domain/tool.js";
import { DevToolExecutionBridge } from "../../src/tools/tool-executor.js";

const READ_ONLY_EFFECT: ActionEffectEnvelope = {
  operation: "observe",
  boundaries: ["process", "workspace"],
  reversibility: "reversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: [],
  idempotency: "idempotent",
};

const WORKSPACE_MUTATION_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "workspace"],
  reversibility: "irreversible",
  dataEgress: "none",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "non-idempotent",
};

function makeTool(
  name: string,
  executeFn: (input: ToolInput) => Promise<ToolResult>,
  effectEnvelope: ActionEffectEnvelope = READ_ONLY_EFFECT,
  inputSchema: DevTool["inputSchema"] = {
    type: "object",
    properties: {},
    required: [],
  },
): DevTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema,
    effectEnvelope,
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
    expect(decision.level).toBe(1);
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
        WORKSPACE_MUTATION_EFFECT,
      ),
    );

    const bridge = new DevToolExecutionBridge({
      registry,
      authorizer: new ActionEffectAuthorizer(),
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
        WORKSPACE_MUTATION_EFFECT,
      ),
    );

    const bridge = new DevToolExecutionBridge({
      registry,
      authorizer: new ActionEffectAuthorizer(),
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

  it("meets request-level authority descriptor with effect authority", async () => {
    const registry = new DevToolRegistry();
    registry.register(
      makeTool(
        "write",
        async () => ({
          output: "ok",
          isError: false,
        }),
        WORKSPACE_MUTATION_EFFECT,
      ),
    );

    const bridge = new DevToolExecutionBridge({
      registry,
      authorizer: new ActionEffectAuthorizer(),
    });

    await expect(bridge.execute({
      name: "write",
      input: { filePath: "x.txt", content: "x" },
      authority: {
        level: 1,
        allowed: true,
        requiresApproval: false,
        reason: "Tenant policy pre-authorized this invocation",
      },
    })).rejects.toMatchObject({ code: "TOOL_AUTHORIZATION_DENIED" });
  });

  it("executes an outer-admitted invocation without re-running standalone authority policy", async () => {
    const execute = vi.fn(async () => ({ output: "ok", isError: false }));
    const registry = new DevToolRegistry();
    registry.register(makeTool("write", execute, WORKSPACE_MUTATION_EFFECT));
    const bridge = new DevToolExecutionBridge({
      registry,
      invocationAdmission: {
        authorize: () => ({
          level: 4,
          allowed: false,
          requiresApproval: false,
          reason: "Standalone policy must not be re-run after outer admission.",
        }),
      },
    });
    const authority = {
      level: 4 as const,
      allowed: true,
      requiresApproval: false,
      reason: "Outer runtime admitted this exact invocation.",
    };

    const result = await bridge.executeAdmitted({
      name: "write",
      input: { filePath: "x.txt", content: "x" },
      authority,
      resolvedEffect: WORKSPACE_MUTATION_EFFECT,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      result: { output: "ok", isError: false },
      attempts: 1,
      fallbackUsed: false,
      resolvedEffect: WORKSPACE_MUTATION_EFFECT,
      authority,
    });
  });

  it("blocks when configured admission denies despite an allowing caller bound", async () => {
    const execute = vi.fn(async () => ({ output: "must not execute", isError: false }));
    const registry = new DevToolRegistry();
    registry.register(makeTool("write", execute, READ_ONLY_EFFECT));
    const bridge = new DevToolExecutionBridge({
      registry,
      invocationAdmission: {
        authorize: () => ({
          level: 4,
          allowed: false,
          requiresApproval: false,
          reason: "configured policy forbids write",
        }),
      },
    });

    await expect(bridge.execute({
      name: "write",
      input: {},
      authority: { level: 1, allowed: true, requiresApproval: false, reason: "caller allows" },
    })).rejects.toMatchObject({ code: "TOOL_AUTHORIZATION_DENIED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks when the caller bound forbids despite configured and effect allow", async () => {
    const execute = vi.fn(async () => ({ output: "must not execute", isError: false }));
    const registry = new DevToolRegistry();
    registry.register(makeTool("echo", execute));
    const bridge = new DevToolExecutionBridge({
      registry,
      invocationAdmission: {
        authorize: () => ({ level: 1, allowed: true, requiresApproval: false, reason: "configured allows" }),
      },
    });

    await expect(bridge.execute({
      name: "echo",
      input: {},
      authority: { level: 4, allowed: false, requiresApproval: false, reason: "caller forbids" },
    })).rejects.toMatchObject({ code: "TOOL_AUTHORIZATION_DENIED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks effect approval even when configured admission allows", async () => {
    const execute = vi.fn(async () => ({ output: "must not execute", isError: false }));
    const registry = new DevToolRegistry();
    registry.register(makeTool("write", execute, WORKSPACE_MUTATION_EFFECT));
    const bridge = new DevToolExecutionBridge({
      registry,
      invocationAdmission: {
        authorize: () => ({ level: 1, allowed: true, requiresApproval: false, reason: "configured allows" }),
      },
    });

    await expect(bridge.execute({ name: "write", input: {} })).rejects.toMatchObject({
      code: "TOOL_AUTHORIZATION_DENIED",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed when request-level authority descriptor is malformed", async () => {
    const registry = new DevToolRegistry();
    registry.register(
      makeTool("echo", async () => ({
        output: "ok",
        isError: false,
      })),
    );

    const bridge = new DevToolExecutionBridge({ registry });

    await expect(
      bridge.execute({
        name: "echo",
        input: {},
        authority: {
          level: 9 as unknown as 1,
          allowed: true,
          requiresApproval: false,
          reason: "invalid",
        },
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

  it("lets millisecond tool input timeout extend the outer execution timeout", async () => {
    vi.useFakeTimers();
    try {
      const registry = new DevToolRegistry();
      registry.register(
        makeTool("bash", async () => {
          await new Promise((resolve) => setTimeout(resolve, 31_000));
          return {
            output: "late success",
            isError: false,
          };
        }, undefined, TOOL_SCHEMAS.bash.inputSchema),
      );

      const bridge = new DevToolExecutionBridge({ registry });
      const resultPromise = bridge.execute({
        name: "bash",
        input: { command: "sleep 31", timeout: 60_000 },
      });

      await vi.advanceTimersByTimeAsync(31_000);

      await expect(resultPromise).resolves.toMatchObject({
        result: {
          output: "late success",
          isError: false,
        },
        attempts: 1,
        fallbackUsed: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps explicit retry timeout authoritative over millisecond tool input timeout", async () => {
    vi.useFakeTimers();
    try {
      const registry = new DevToolRegistry();
      registry.register(
        makeTool("bash", async () => {
          await new Promise((resolve) => setTimeout(resolve, 31_000));
          return {
            output: "late success",
            isError: false,
          };
        }, undefined, TOOL_SCHEMAS.bash.inputSchema),
      );

      const bridge = new DevToolExecutionBridge({ registry });
      const resultPromise = bridge.execute({
        name: "bash",
        input: { command: "sleep 31", timeout: 60_000 },
        retry: { timeout: 0.01 },
      });
      const expectation = expect(resultPromise).rejects.toMatchObject({
        code: "TOOL_EXECUTION_TIMEOUT",
        context: { toolName: "bash", timeoutMs: 10 },
      } satisfies Partial<KilnError>);

      await vi.advanceTimersByTimeAsync(10);

      await expectation;
    } finally {
      vi.useRealTimers();
    }
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

  it("reauthorizes fallback tools with their own resolved effect", async () => {
    const registry = new DevToolRegistry();
    registry.register(
      makeTool("primary", async () => {
        throw new Error("HTTP 503 Service Unavailable");
      }),
    );
    registry.register(
      makeTool(
        "fallback",
        async () => ({
          output: "must not execute",
          isError: false,
        }),
        WORKSPACE_MUTATION_EFFECT,
      ),
    );

    const bridge = new DevToolExecutionBridge({ registry });

    await expect(
      bridge.execute({
        name: "primary",
        input: {},
        authority: {
          level: 1,
          allowed: true,
          requiresApproval: false,
          reason: "Primary tool only",
        },
        retry: {
          onTransientError: "exponential",
          maxAttempts: 1,
          fallback: "fallback",
        },
      }),
    ).rejects.toMatchObject({
      code: "TOOL_AUTHORIZATION_DENIED",
      context: {
        toolName: "fallback",
      },
    } satisfies Partial<KilnError>);
  });
});
