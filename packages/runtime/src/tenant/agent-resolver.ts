// Agent resolver: single integration point for multi-agent routing in all channel handlers.
// Resolves which agent handles a message, builds the agent-specific system prompt and tool context.

import type { ContentPart, TenantConfig, TenantAgentConfig, EventBus, HandoffRequestedEvent, HandoffCompletedEvent } from "@kilnai/core";
import { buildTenantSystemPrompt } from "./system-prompt-builder.js";
import { buildTenantToolContext } from "../gateway/tenant-tool-factory.js";
import type { TenantToolContext } from "../gateway/tenant-tool-factory.js";
import { DefaultTenantRouter } from "./tenant-router.js";
import type { RoutingResult } from "./tenant-router.js";
import type { ModeBSession } from "../session/mode-b-session.js";
import { checkPingPong } from "./ping-pong-guard.js";
import type { AgentHandoffSummarizer } from "../session/agent-handoff-summarizer.js";

export interface ResolvedAgentContext {
  readonly systemPrompt: string;
  readonly tenantToolContext: TenantToolContext;
  readonly activeAgentId?: string;
  readonly activeAgentName?: string;
  readonly routingResult?: RoutingResult;
  readonly previousAgentId?: string;
  readonly isHandoff: boolean;
  readonly pingPongBlocked?: boolean;
  readonly pingPongReason?: string;
  readonly handoffBrief?: string;
}

export interface AsyncAgentResolverDeps {
  readonly handoffSummarizer?: AgentHandoffSummarizer;
  readonly eventBus?: EventBus;
}

export function buildAgentSystemPrompt(basePrompt: string, agent: TenantAgentConfig): string {
  const parts: string[] = [basePrompt];

  parts.push("");
  parts.push("## Your Agent Identity");
  parts.push(`You are "${agent.name}" — ${agent.role}.`);
  parts.push(`Your primary goal: ${agent.goal}`);

  if (agent.backstory) {
    parts.push(`Background: ${agent.backstory}`);
  }

  if (agent.instructions) {
    parts.push("");
    parts.push("## Operating Instructions");
    parts.push(agent.instructions);
  }

  return parts.join("\n");
}

export function resolveAgentContext(
  tenant: TenantConfig,
  userParts: readonly ContentPart[],
  channel?: "web" | "whatsapp" | "instagram" | "messenger" | "email",
  session?: ModeBSession,
  existingBuiltins?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>,
): ResolvedAgentContext {
  const basePrompt = buildTenantSystemPrompt(tenant, channel);

  // No agents or single agent without routing → single-agent mode
  if (!tenant.agents || tenant.agents.length === 0) {
    return {
      systemPrompt: basePrompt,
      tenantToolContext: buildTenantToolContext(tenant, existingBuiltins),
      isHandoff: false,
    };
  }

  if (tenant.agents.length === 1) {
    const agent = tenant.agents[0]!;
    const systemPrompt = buildAgentSystemPrompt(basePrompt, agent);
    const toolCtx = buildAgentToolContext(tenant, agent, existingBuiltins);
    return {
      systemPrompt,
      tenantToolContext: toolCtx,
      activeAgentId: agent.id,
      activeAgentName: agent.name,
      isHandoff: false,
    };
  }

  // Multi-agent: route to the correct agent
  if (!tenant.routing) {
    // No routing config → fall back to first agent
    const agent = tenant.agents[0]!;
    const systemPrompt = buildAgentSystemPrompt(basePrompt, agent);
    const toolCtx = buildAgentToolContext(tenant, agent, existingBuiltins);
    return {
      systemPrompt,
      tenantToolContext: toolCtx,
      activeAgentId: agent.id,
      activeAgentName: agent.name,
      isHandoff: false,
    };
  }

  const router = new DefaultTenantRouter(tenant.routing);
  const routingResult = router.route(userParts);

  // Ping-pong guard: prevent rapid agent switching loops
  if (session && tenant.routing) {
    const guardResult = checkPingPong(routingResult, session, tenant.routing);
    if (guardResult.blocked) {
      // Keep current agent
      const currentAgent = tenant.agents.find((a) => a.id === session.activeAgentId)
        ?? tenant.agents.find((a) => a.isDefault) ?? tenant.agents[0]!;
      const systemPrompt = buildAgentSystemPrompt(basePrompt, currentAgent);
      const toolCtx = buildAgentToolContext(tenant, currentAgent, existingBuiltins);
      return {
        systemPrompt,
        tenantToolContext: toolCtx,
        activeAgentId: currentAgent.id,
        activeAgentName: currentAgent.name,
        routingResult,
        previousAgentId: session.activeAgentId,
        isHandoff: false,
        pingPongBlocked: true,
        pingPongReason: guardResult.reason,
      };
    }
  }

  // Find the selected agent
  let selectedAgent = tenant.agents.find((a) => a.id === routingResult.agentId);
  if (!selectedAgent) {
    // Fail-open: use default agent or first agent
    selectedAgent = tenant.agents.find((a) => a.isDefault) ?? tenant.agents[0]!;
  }

  const previousAgentId = session?.activeAgentId;
  const isHandoff = previousAgentId !== undefined && previousAgentId !== selectedAgent.id;
  const systemPrompt = buildAgentSystemPrompt(basePrompt, selectedAgent);
  const toolCtx = buildAgentToolContext(tenant, selectedAgent, existingBuiltins);

  return {
    systemPrompt,
    tenantToolContext: toolCtx,
    activeAgentId: selectedAgent.id,
    activeAgentName: selectedAgent.name,
    routingResult,
    previousAgentId,
    isHandoff,
  };
}

export async function resolveAgentContextAsync(
  tenant: TenantConfig,
  userParts: readonly ContentPart[],
  session: ModeBSession,
  deps?: AsyncAgentResolverDeps,
  channel?: "web" | "whatsapp" | "instagram" | "messenger" | "email",
  existingBuiltins?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>,
): Promise<ResolvedAgentContext> {
  const result = resolveAgentContext(tenant, userParts, channel, session, existingBuiltins);

  // No handoff or blocked by guard or no summarizer → return as-is
  if (!result.isHandoff || result.pingPongBlocked || !deps?.handoffSummarizer) {
    return result;
  }

  // Resolve agent names for the brief
  const fromAgent = tenant.agents?.find((a) => a.id === result.previousAgentId);
  const toAgent = tenant.agents?.find((a) => a.id === result.activeAgentId);
  const fromName = fromAgent?.name ?? result.previousAgentId ?? "unknown";
  const toName = toAgent?.name ?? result.activeAgentId ?? "unknown";

  // Emit handoff_requested event
  if (deps.eventBus) {
    const reqEvent: HandoffRequestedEvent = {
      type: "handoff_requested",
      fromAgent: fromName,
      toAgent: toName,
      reason: "agent_routing",
      timestamp: new Date(),
      sessionId: session.id,
    };
    deps.eventBus.emit(reqEvent);
  }

  let brief: string | undefined;
  try {
    brief = await deps.handoffSummarizer.summarize(session, fromName, toName);
  } catch {
    // Fail-open: return original result without brief
    return result;
  }

  // Emit handoff_completed event
  if (deps.eventBus) {
    const compEvent: HandoffCompletedEvent = {
      type: "handoff_completed",
      fromAgent: fromName,
      toAgent: toName,
      accepted: true,
      timestamp: new Date(),
      sessionId: session.id,
    };
    deps.eventBus.emit(compEvent);
  }

  const enrichedPrompt = brief ? `${result.systemPrompt}\n\n${brief}` : result.systemPrompt;

  return {
    ...result,
    systemPrompt: enrichedPrompt,
    handoffBrief: brief || undefined,
  };
}

function buildAgentToolContext(
  tenant: TenantConfig,
  agent: TenantAgentConfig,
  existingBuiltins?: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>,
): TenantToolContext {
  // Build full tenant tool context first
  const fullCtx = buildTenantToolContext(tenant, existingBuiltins);

  // If agent has no tool restriction, inherit full tenant allowlist
  if (!agent.tools || agent.tools.length === 0) {
    return fullCtx;
  }

  // Intersect agent tools with tenant allowlist
  const agentToolSet = new Set(agent.tools);
  let intersectedAllowlist: Set<string>;

  if (fullCtx.toolAllowlist) {
    intersectedAllowlist = new Set<string>();
    for (const tool of agentToolSet) {
      if (fullCtx.toolAllowlist.has(tool)) {
        intersectedAllowlist.add(tool);
      }
    }
  } else {
    intersectedAllowlist = agentToolSet;
  }

  return {
    callBuiltinTools: fullCtx.callBuiltinTools,
    toolDefinitions: fullCtx.toolDefinitions,
    toolAllowlist: intersectedAllowlist,
    rateLimiter: fullCtx.rateLimiter,
    maxToolRounds: fullCtx.maxToolRounds,
  };
}
