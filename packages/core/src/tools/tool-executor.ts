import { executeWithRetry } from "../agents/tool-execution-engine.js";
import type { CapabilityAnnotations } from "../engine/domain/capability.js";
import type {
  AuthorityDescriptor,
  RetryConfig,
  ToolExecutionRequest,
  ToolAuthorizer,
  ToolExecutionResult,
} from "../engine/domain/tool-execution.js";
import { KilnError } from "../engine/errors.js";
import type { DevTool, ToolResult } from "./domain/tool.js";
import { DevToolRegistry } from "./domain/tool-registry.js";

export interface DevToolExecutionRequest extends ToolExecutionRequest {
  readonly sandbox?: unknown;
  readonly retry?: RetryConfig;
}

export interface DevToolExecutionBridgeOptions {
  readonly registry: DevToolRegistry;
  readonly authorizer?: ToolAuthorizer;
}

export interface DevToolExecutionResult extends ToolExecutionResult {
  readonly result: ToolResult;
}

export interface DevToolAuthorizationDecision {
  readonly toolName: string;
  readonly level: number;
  readonly allowed: boolean;
  readonly requiresApproval: boolean;
  readonly reason: string;
}

export class DevToolExecutionBridge {
  private readonly registry: DevToolRegistry;
  private readonly authorizer?: ToolAuthorizer;

  constructor(options: DevToolExecutionBridgeOptions) {
    this.registry = options.registry;
    this.authorizer = options.authorizer;
  }

  listTools(): readonly DevTool[] {
    return this.registry.list();
  }

  async execute(request: DevToolExecutionRequest): Promise<DevToolExecutionResult> {
    const primaryTool = this.registry.lookup(request.name);
    if (!primaryTool) {
      throw new KilnError("INTERNAL_ERROR", `Tool "${request.name}" is not registered`, {
        context: { toolName: request.name },
        retryable: false,
      });
    }
    this.authorize(primaryTool, request.authority);

    if (request.retry?.fallback && !this.registry.lookup(request.retry.fallback)) {
      throw new KilnError(
        "INTERNAL_ERROR",
        `Fallback tool "${request.retry.fallback}" is not registered`,
        {
          context: { fallbackToolName: request.retry.fallback },
          retryable: false,
        },
      );
    }

    const executor = async (
      toolName: string,
      input: Record<string, unknown>,
    ): Promise<ToolResult> => {
      return await this.executeSingle(toolName, input, request.sandbox, request.authority);
    };

    const fallbackExecutor = request.retry?.fallback ? executor : undefined;

    const execution = await executeWithRetry(
      request.name,
      request.input,
      executor,
      request.retry,
      fallbackExecutor,
    );

    if (!isToolResult(execution.result)) {
      throw new KilnError(
        "INTERNAL_ERROR",
        `Tool "${request.name}" returned an invalid result shape`,
        {
          context: {
            toolName: request.name,
            resultType: typeof execution.result,
          },
          retryable: false,
        },
      );
    }

    return {
      ...execution,
      result: execution.result,
    };
  }

  authorizeRequest(name: string): DevToolAuthorizationDecision {
    return this.authorizeRequestWithAuthority(name);
  }

  authorizeRequestWithAuthority(
    name: string,
    authority?: AuthorityDescriptor,
  ): DevToolAuthorizationDecision {
    const tool = this.registry.lookup(name);
    if (!tool) {
      throw new KilnError("INTERNAL_ERROR", `Tool "${name}" is not registered`, {
        context: { toolName: name },
        retryable: false,
      });
    }

    return this.getAuthorizationDecision(tool, authority);
  }

  private async executeSingle(
    toolName: string,
    input: Record<string, unknown>,
    sandbox?: unknown,
    authority?: AuthorityDescriptor,
  ): Promise<ToolResult> {
    const tool = this.registry.lookup(toolName);
    if (!tool) {
      throw new KilnError("INTERNAL_ERROR", `Tool "${toolName}" is not registered`, {
        context: { toolName },
        retryable: false,
      });
    }

    this.authorize(tool, authority);
    return await tool.execute({ name: toolName, input }, sandbox);
  }

  private authorize(tool: DevTool, authority?: AuthorityDescriptor): void {
    const decision = this.getAuthorizationDecision(tool, authority);

    if (!decision.allowed) {
      throw new KilnError("TOOL_AUTHORIZATION_DENIED", decision.reason, {
        context: {
          toolName: tool.name,
          level: decision.level,
        },
        retryable: false,
      });
    }

    if (decision.requiresApproval) {
      throw new KilnError("TOOL_APPROVAL_REQUIRED", decision.reason, {
        context: {
          toolName: tool.name,
          level: decision.level,
          requiresApproval: true,
        },
        retryable: false,
      });
    }
  }

  private getAuthorizationDecision(
    tool: DevTool,
    authority?: AuthorityDescriptor,
  ): DevToolAuthorizationDecision {
    if (authority !== undefined) {
      if (!isAuthorityDescriptor(authority)) {
        return {
          toolName: tool.name,
          level: 4,
          allowed: false,
          requiresApproval: false,
          reason: "Invalid authority descriptor; execution denied",
        };
      }
      return {
        toolName: tool.name,
        level: authority.level,
        allowed: authority.allowed,
        requiresApproval: authority.requiresApproval,
        reason: authority.reason,
      };
    }

    if (!this.authorizer) {
      return {
        toolName: tool.name,
        level: 2,
        allowed: true,
        requiresApproval: false,
        reason: "Audited execution",
      };
    }

    const decision = this.authorizer.authorize(
      tool.name,
      tool.annotations as CapabilityAnnotations | undefined,
    );

    return {
      toolName: tool.name,
      level: decision.level,
      allowed: decision.allowed,
      requiresApproval: decision.requiresApproval,
      reason: decision.reason,
    };
  }
}

function isToolResult(value: unknown): value is ToolResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    output?: unknown;
    isError?: unknown;
    metadata?: unknown;
  };

  if (typeof candidate.output !== "string") {
    return false;
  }

  if (typeof candidate.isError !== "boolean") {
    return false;
  }

  if (candidate.metadata !== undefined && typeof candidate.metadata !== "object") {
    return false;
  }

  return true;
}

function isAuthorityDescriptor(value: unknown): value is AuthorityDescriptor {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    level?: unknown;
    allowed?: unknown;
    requiresApproval?: unknown;
    reason?: unknown;
  };

  const validLevel = candidate.level === 1
    || candidate.level === 2
    || candidate.level === 3
    || candidate.level === 4;

  return validLevel
    && typeof candidate.allowed === "boolean"
    && typeof candidate.requiresApproval === "boolean"
    && typeof candidate.reason === "string"
    && candidate.reason.length > 0;
}
