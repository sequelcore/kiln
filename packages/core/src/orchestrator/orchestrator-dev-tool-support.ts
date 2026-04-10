import type { EventBus } from "../events/event-bus.js";
import type {
  ToolAuthorizedEvent,
  ToolCalledEvent,
  ToolResultEvent,
} from "../events/index.js";
import { createPolicy, ROLE_PRESETS } from "../sandbox/index.js";
import type { SandboxPolicy } from "../sandbox/index.js";
import { KilnError } from "../engine/errors.js";
import { AnnotationAuthorizer } from "../security/annotation-authorizer.js";
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
      authorizer: new AnnotationAuthorizer(),
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
    request: DevToolExecutionRequest & { readonly role?: string; readonly cwd?: string },
  ): Promise<DevToolExecutionResult> {
    const startedAt = Date.now();
    const { sessionId, taskId } = this.deps.getSessionContext();
    const registeredTool = this.registry.lookup(request.name);
    const authorization = registeredTool
      ? this.executionBridge.authorizeRequest(request.name)
      : undefined;

    const calledEvent: ToolCalledEvent = {
      type: "tool_called",
      toolName: request.name,
      toolInput: request.input,
      taskId,
      annotations: registeredTool?.annotations as Record<string, unknown> | undefined,
      authorizationLevel: authorization?.level,
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

    const resolvedAuthorization = authorization ?? this.executionBridge.authorizeRequest(request.name);
    const authorizedEvent: ToolAuthorizedEvent = {
      type: "tool_authorized",
      toolName: resolvedAuthorization.toolName,
      level: resolvedAuthorization.level,
      allowed: resolvedAuthorization.allowed,
      reason: resolvedAuthorization.reason,
      timestamp: new Date(),
      sessionId,
    };
    this.deps.eventBus.emit(authorizedEvent);

    if (!resolvedAuthorization.allowed || resolvedAuthorization.requiresApproval) {
      throw new KilnError("TOOL_AUTHORIZATION_DENIED", resolvedAuthorization.reason, {
        context: {
          toolName: resolvedAuthorization.toolName,
          level: resolvedAuthorization.level,
          requiresApproval: resolvedAuthorization.requiresApproval,
        },
        retryable: false,
      });
    }

    try {
      const execution = await this.executionBridge.execute({
        ...request,
        sandbox,
      });

      const resultEvent: ToolResultEvent = {
        type: "tool_result",
        toolName: request.name,
        taskId,
        durationMs: Date.now() - startedAt,
        success: !execution.result.isError,
        isError: execution.result.isError,
        retryAttempt: execution.attempts,
        resultSummary: execution.result.output.slice(0, 200),
        timestamp: new Date(),
        sessionId,
      };
      this.deps.eventBus.emit(resultEvent);

      return execution;
    } catch (error) {
      if (error instanceof KilnError && error.code === "TOOL_AUTHORIZATION_DENIED") {
        throw error;
      }

      const failureSummary = error instanceof Error
        ? error.message
        : "Tool execution failed";
      const resultEvent: ToolResultEvent = {
        type: "tool_result",
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
