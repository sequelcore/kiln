import { executeWithRetry } from "../agents/tool-execution-engine.js";
import {
  CONSERVATIVE_UNKNOWN_ENVELOPE,
  resolveInvocationEffect,
  type ActionEffectEnvelope,
  type InvocationEffectResolverRegistry,
  type ResolvedInvocationEffect,
} from "../engine/domain/action-effect.js";
import type {
  AuthorizationLevel,
  AuthorityDescriptor,
  RetryConfig,
  ToolExecutionRequest,
  ToolAuthorizer,
  ToolExecutionResult,
} from "../engine/domain/tool-execution.js";
import { KilnError } from "../engine/errors.js";
import { ActionEffectAuthorizer } from "../security/action-effect-authorizer.js";
import type { DevTool, DevToolExecutionContext, ToolResult } from "./domain/tool.js";
import { getBuiltinEffectEnvelope } from "./domain/tool-effect-envelopes.js";
import type { ToolResourceLinker } from "./domain/tool-resource-links.js";
import { DevToolRegistry } from "./domain/tool-registry.js";
import { buildBuiltinInvocationEffectResolvers } from "./infrastructure/invocation-effect-resolvers.js";

const KILN_TIMEOUT_UNIT_SCHEMA_KEY = "x-kiln-timeout-unit";

export interface DevToolExecutionRequest extends ToolExecutionRequest {
  readonly toolCallId?: string;
  readonly sandbox?: unknown;
  readonly retry?: RetryConfig;
  readonly executionContext?: DevToolExecutionContext;
}

export interface DevToolExecutionBridgeOptions {
  readonly registry: DevToolRegistry;
  readonly authorizer?: ToolAuthorizer;
  readonly resourceLinker?: ToolResourceLinker;
  readonly invocationEffectResolvers?: InvocationEffectResolverRegistry;
}

export interface DevToolExecutionResult extends ToolExecutionResult {
  readonly result: ToolResult;
  readonly toolName: string;
  readonly resolvedEffect: ResolvedInvocationEffect;
  readonly authority: AuthorityDescriptor;
}

export interface DevToolAuthorizationDecision {
  readonly toolName: string;
  readonly level: AuthorizationLevel;
  readonly allowed: boolean;
  readonly requiresApproval: boolean;
  readonly reason: string;
}

export class DevToolExecutionBridge {
  private readonly registry: DevToolRegistry;
  private readonly authorizer: ToolAuthorizer;
  private readonly resourceLinker?: ToolResourceLinker;
  private readonly invocationEffectResolvers: InvocationEffectResolverRegistry;

  constructor(options: DevToolExecutionBridgeOptions) {
    this.registry = options.registry;
    this.authorizer = options.authorizer ?? new ActionEffectAuthorizer();
    this.resourceLinker = options.resourceLinker;
    this.invocationEffectResolvers = options.invocationEffectResolvers ?? buildBuiltinInvocationEffectResolvers();
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
      return await this.executeSingle(
        toolName,
        input,
        request.sandbox,
        toolName === request.name ? request.authority : undefined,
        request.executionContext,
      );
    };

    const fallbackExecutor = request.retry?.fallback ? executor : undefined;

    const execution = await executeWithRetry(
      request.name,
      request.input,
      executor,
      withToolInputTimeout(request.retry, primaryTool, request.input),
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

    const executedToolName = execution.fallbackUsed && request.retry?.fallback
      ? request.retry.fallback
      : request.name;
    const executedTool = this.registry.lookup(executedToolName);
    if (!executedTool) {
      throw new KilnError("INTERNAL_ERROR", `Executed tool "${executedToolName}" is not registered`, {
        context: { toolName: executedToolName },
        retryable: false,
      });
    }
    const authorityEvidence = this.getAuthorizationDecision(
      executedTool,
      request.input,
      execution.fallbackUsed ? undefined : request.authority,
    );

    return {
      ...execution,
      result: execution.result,
      toolName: executedToolName,
      resolvedEffect: authorityEvidence.resolvedEffect,
      authority: {
        level: authorityEvidence.level,
        allowed: authorityEvidence.allowed,
        requiresApproval: authorityEvidence.requiresApproval,
        reason: authorityEvidence.reason,
      },
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

    return this.getAuthorizationDecision(tool, {}, authority);
  }

  private async executeSingle(
    toolName: string,
    input: Record<string, unknown>,
    sandbox?: unknown,
    authority?: AuthorityDescriptor,
    executionContext?: DevToolExecutionContext,
  ): Promise<ToolResult> {
    const tool = this.registry.lookup(toolName);
    if (!tool) {
      throw new KilnError("INTERNAL_ERROR", `Tool "${toolName}" is not registered`, {
        context: { toolName },
        retryable: false,
      });
    }

    this.authorize(tool, input, authority);
    const result = await tool.execute({ name: toolName, input }, sandbox, executionContext);
    return this.resourceLinker?.link({ toolName, input, result }) ?? result;
  }

  private authorize(tool: DevTool, input: Record<string, unknown>, authority?: AuthorityDescriptor): void {
    const decision = this.getAuthorizationDecision(tool, input, authority);

    if (!decision.allowed) {
      throw new KilnError("TOOL_AUTHORIZATION_DENIED", decision.reason, {
        context: {
          toolName: tool.name,
          level: decision.level,
          resolvedEffect: decision.resolvedEffect,
          authority: {
            level: decision.level,
            allowed: decision.allowed,
            requiresApproval: decision.requiresApproval,
            reason: decision.reason,
          },
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
          resolvedEffect: decision.resolvedEffect,
          authority: {
            level: decision.level,
            allowed: decision.allowed,
            requiresApproval: decision.requiresApproval,
            reason: decision.reason,
          },
        },
        retryable: false,
      });
    }
  }

  private getAuthorizationDecision(
    tool: DevTool,
    input: Record<string, unknown>,
    authority?: AuthorityDescriptor,
  ): DevToolAuthorizationDecision & {
    readonly resolvedEffect: ResolvedInvocationEffect;
  } {
    const resolvedEffect = this.resolveInvocationEffect(tool, input);
    if (authority !== undefined) {
      if (!isAuthorityDescriptor(authority)) {
        return {
          toolName: tool.name,
          resolvedEffect,
          level: 4,
          allowed: false,
          requiresApproval: false,
          reason: "Invalid authority descriptor; execution denied",
        };
      }
      return {
        toolName: tool.name,
        resolvedEffect,
        level: authority.level,
        allowed: authority.allowed,
        requiresApproval: authority.requiresApproval,
        reason: authority.reason,
      };
    }

    const decision = this.authorizer.authorize(tool.name, resolvedEffect);

    return {
      toolName: tool.name,
      resolvedEffect,
      level: decision.level,
      allowed: decision.allowed,
      requiresApproval: decision.requiresApproval,
      reason: decision.reason,
    };
  }

  private resolveInvocationEffect(
    tool: DevTool,
    input: Record<string, unknown>,
  ): ResolvedInvocationEffect {
    const envelope: ActionEffectEnvelope = tool.effectEnvelope
      ?? getBuiltinEffectEnvelope(tool.name)
      ?? CONSERVATIVE_UNKNOWN_ENVELOPE;
    try {
      return resolveInvocationEffect(
        tool.name,
        input,
        envelope,
        this.invocationEffectResolvers,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new KilnError("TOOL_AUTHORIZATION_DENIED", message, {
        context: { toolName: tool.name },
        retryable: false,
      });
    }
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

function withToolInputTimeout(
  retry: RetryConfig | undefined,
  tool: DevTool,
  input: Record<string, unknown>,
): RetryConfig | undefined {
  if (retry?.timeout !== undefined) {
    return retry;
  }

  if (!hasMillisecondTimeoutInput(tool)) {
    return retry;
  }

  const timeoutMs = input["timeout"];
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return retry;
  }

  return {
    ...retry,
    timeout: Math.ceil(timeoutMs / 1000),
  };
}

function hasMillisecondTimeoutInput(tool: DevTool): boolean {
  const properties = tool.inputSchema["properties"];
  if (!properties || typeof properties !== "object") {
    return false;
  }

  const timeout = (properties as Record<string, unknown>)["timeout"];
  if (!timeout || typeof timeout !== "object") {
    return false;
  }

  const candidate = timeout as { type?: unknown; [KILN_TIMEOUT_UNIT_SCHEMA_KEY]?: unknown };
  return candidate.type === "number"
    && candidate[KILN_TIMEOUT_UNIT_SCHEMA_KEY] === "milliseconds";
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
