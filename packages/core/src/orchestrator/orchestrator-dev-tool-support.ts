import { randomUUID } from "node:crypto";
import type { EventBus } from "../events/event-bus.js";
import type {
  ToolAuthorizedEvent,
  ToolCalledEvent,
  ToolResultEvent,
} from "../events/index.js";
import { createPolicy, ROLE_PRESETS } from "../sandbox/index.js";
import type { SandboxPolicy } from "../sandbox/index.js";
import type { AuthorityDescriptor } from "../engine/domain/tool-execution.js";
import { KilnError } from "../engine/errors.js";
import { ActionEffectAuthorizer } from "../security/action-effect-authorizer.js";
import { DevToolRegistry } from "../tools/domain/tool-registry.js";
import type { DevTool } from "../tools/domain/tool.js";
import {
  DevToolExecutionBridge,
  type DevToolExecutionRequest,
  type DevToolExecutionResult,
} from "../tools/tool-executor.js";

interface DevToolSupportDeps {
  readonly eventBus: EventBus;
  readonly getSessionContext: () => {
    readonly sessionId: string;
    readonly taskId?: string;
  };
}

export class OrchestratorDevToolSupport {
  private readonly registry: DevToolRegistry;
  private readonly executionBridge: DevToolExecutionBridge;
  private readonly sandboxPolicies = new Map<string, SandboxPolicy>();

  constructor(private readonly deps: DevToolSupportDeps) {
    this.registry = new DevToolRegistry();
    this.executionBridge = new DevToolExecutionBridge({
      registry: this.registry,
      authorizer: new ActionEffectAuthorizer(),
    });
  }

  get devToolRegistry(): DevToolRegistry {
    return this.registry;
  }

  initSandbox(projectPath: string): void {
    for (const role of Object.keys(ROLE_PRESETS)) {
      this.sandboxPolicies.set(role, createPolicy(role, projectPath));
    }
  }

  getSandboxPolicy(role: string): SandboxPolicy | undefined {
    return this.sandboxPolicies.get(role);
  }

  get sandboxEnabled(): boolean {
    return this.sandboxPolicies.size > 0;
  }

  registerDevTool(tool: DevTool): void {
    this.registry.register(tool);
  }

  async executeDevTool(
    request: DevToolExecutionRequest & {
      readonly toolCallScopeId: string;
      readonly role?: string;
      readonly cwd?: string;
      readonly authority?: AuthorityDescriptor;
    },
  ): Promise<DevToolExecutionResult> {
    const startedAt = Date.now();
    const { sessionId, taskId } = this.deps.getSessionContext();
    const toolCallId = request.toolCallId ?? randomUUID();

    const calledEvent: ToolCalledEvent = {
      type: "tool_called",
      toolCallId,
      toolCallScopeId: request.toolCallScopeId,
      toolName: request.name,
      toolInput: request.input,
      taskId,
      timestamp: new Date(),
      sessionId,
    };
    this.deps.eventBus.emit(calledEvent);

    const roleSandbox = request.role ? this.getSandboxPolicy(request.role) : undefined;
    const sandbox = request.sandbox ?? (roleSandbox
      ? {
          cwd: request.cwd,
          policy: roleSandbox,
        }
      : undefined);

    try {
      const execution = await this.executionBridge.execute({
        ...request,
        sandbox,
      });

      const authorizedEvent: ToolAuthorizedEvent = {
        type: "tool_authorized",
        toolName: execution.toolName,
        level: execution.authority.level,
        allowed: execution.authority.allowed,
        reason: execution.authority.reason,
        resolvedEffect: execution.resolvedEffect,
        authority: execution.authority,
        timestamp: new Date(),
        sessionId,
      };
      this.deps.eventBus.emit(authorizedEvent);

      const resultEvent: ToolResultEvent = {
        type: "tool_result",
        toolCallId,
        toolCallScopeId: request.toolCallScopeId,
        toolName: request.name,
        taskId,
        durationMs: Date.now() - startedAt,
        success: !execution.result.isError,
        isError: execution.result.isError,
        retryAttempt: execution.attempts,
        resultSummary: execution.result.output.slice(0, 200),
        resolvedEffect: execution.resolvedEffect,
        authority: execution.authority,
        timestamp: new Date(),
        sessionId,
      };
      this.deps.eventBus.emit(resultEvent);

      return execution;
    } catch (error) {
      if (
        error instanceof KilnError &&
        (error.code === "TOOL_AUTHORIZATION_DENIED" || error.code === "TOOL_APPROVAL_REQUIRED")
      ) {
        const context = error.context as {
          readonly toolName?: unknown;
          readonly resolvedEffect?: ToolAuthorizedEvent["resolvedEffect"];
          readonly authority?: AuthorityDescriptor;
        };
        if (context.authority !== undefined) {
          const authorizedEvent: ToolAuthorizedEvent = {
            type: "tool_authorized",
            toolName: typeof context.toolName === "string" ? context.toolName : request.name,
            level: context.authority.level,
            allowed: context.authority.allowed,
            reason: context.authority.reason,
            resolvedEffect: context.resolvedEffect,
            authority: context.authority,
            timestamp: new Date(),
            sessionId,
          };
          this.deps.eventBus.emit(authorizedEvent);
        }
        const resultEvent: ToolResultEvent = {
          type: "tool_result",
          toolCallId,
          toolCallScopeId: request.toolCallScopeId,
          toolName: request.name,
          taskId,
          durationMs: Date.now() - startedAt,
          success: false,
          isError: true,
          resultSummary: error.message.slice(0, 200),
          resolvedEffect: context.resolvedEffect,
          authority: context.authority,
          timestamp: new Date(),
          sessionId,
        };
        this.deps.eventBus.emit(resultEvent);
        throw error;
      }

      const failureSummary = error instanceof Error
        ? error.message
        : "Tool execution failed";
      const resultEvent: ToolResultEvent = {
        type: "tool_result",
        toolCallId,
        toolCallScopeId: request.toolCallScopeId,
        toolName: request.name,
        taskId,
        durationMs: Date.now() - startedAt,
        success: false,
        isError: true,
        resultSummary: failureSummary.slice(0, 200),
        timestamp: new Date(),
        sessionId,
      };
      this.deps.eventBus.emit(resultEvent);
      throw error;
    }
  }
}
