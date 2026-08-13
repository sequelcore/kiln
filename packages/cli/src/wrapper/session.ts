/**
 * Canonical session abstraction layer for Kiln's multi-CLI orchestration engine.
 *
 * Defines the contract that all session implementations (ClaudeSession, CodexSession,
 * OpenCodeSession) must satisfy. This is the interface that the orchestrator
 * uses to interact with sessions without coupling to any specific CLI.
 *
 * Design constraints:
 * - Single-turn only. No multi-turn history parameter.
 * - Session continuation is out of scope until OpenCode and Codex capabilities are confirmed.
 * - Pure type definitions.
 */

import type {
  AgentMessage,
  ExecutionSessionCostTrackingMode,
  ExecutionSessionEphemeralHarnessStateEvidence,
  ExecutionSessionEvent,
  MemoryLayerKind,
  MemoryScopeKind,
  DeliberationResolution,
  ResolvedCommunicationIntent,
} from "@kilnai/core";
import type { OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";

export type KilnPermissionAction = "allow" | "ask" | "deny";

export type KilnPermissionApproval =
  | "never"
  | "on-request"
  | "on-failure"
  | "untrusted";

export type KilnSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export interface KilnToolPermissionRule {
  readonly tool: string;
  readonly action: KilnPermissionAction;
  readonly reason?: string;
}

export interface KilnCommandPermissionRule {
  readonly pattern: string;
  readonly action: KilnPermissionAction;
  readonly shell?: "bash" | "sh" | "zsh" | "any";
  readonly reason?: string;
}

export interface KilnFileGovernancePolicy {
  readonly denyGlobs?: readonly string[];
  readonly askGlobs?: readonly string[];
  readonly allowGlobs?: readonly string[];
  readonly excludeFromContext?: boolean;
}

export const KILN_MEMORY_AUTHORITY_OPERATIONS = [
  "save",
  "read",
  "revise",
  "relate",
  "delete",
  "forget",
  "compact",
  "promote",
] as const;

export type KilnMemoryAuthorityOperation = typeof KILN_MEMORY_AUTHORITY_OPERATIONS[number];
export type KilnMemoryAuthorityAccessLevel = "read" | "write";

export interface KilnMemoryAuthorityRule {
  readonly operations: readonly KilnMemoryAuthorityOperation[];
  readonly scopeKinds?: readonly MemoryScopeKind[];
  readonly scopeIds?: readonly string[];
  readonly layers?: readonly MemoryLayerKind[];
  readonly allowAuditWrite?: boolean;
}

export interface KilnMemoryPermissionPolicy {
  readonly read?: readonly KilnMemoryAuthorityRule[];
  readonly write?: readonly KilnMemoryAuthorityRule[];
}

export interface KilnMemoryAuthorityCaller {
  readonly kind: string;
  readonly id: string;
}

export interface KilnMemoryAuthorityPolicyRule {
  readonly access: KilnMemoryAuthorityAccessLevel;
  readonly operations: readonly KilnMemoryAuthorityOperation[];
  readonly scopeKinds?: readonly MemoryScopeKind[];
  readonly scopeIds?: readonly string[];
  readonly layers?: readonly MemoryLayerKind[];
  readonly allowAuditWrite?: boolean;
}

export interface KilnMemoryAuthorityPolicy {
  readonly caller: KilnMemoryAuthorityCaller;
  readonly rules: readonly KilnMemoryAuthorityPolicyRule[];
}

export type KilnDataDestination =
  | "small-model"
  | "logs"
  | "ci"
  | "github-actions"
  | "external-mcp"
  | "webhook";

export interface KilnDataFirewallRule {
  readonly destination: KilnDataDestination | string;
  readonly action: "allow" | "redact" | "deny";
  readonly classifications?: readonly string[];
  readonly reason?: string;
}

export interface KilnAgentPermissionScope {
  readonly agent: string;
  readonly inherit?: boolean;
  readonly tools?: readonly KilnToolPermissionRule[];
  readonly commands?: readonly KilnCommandPermissionRule[];
  readonly fileGovernance?: KilnFileGovernancePolicy;
  readonly memory?: KilnMemoryPermissionPolicy;
  readonly mcpTools?: readonly string[];
}

export interface KilnPermissionPolicy {
  readonly approval?: KilnPermissionApproval;
  readonly sandbox?: KilnSandboxMode;
  readonly safeDefaults?: boolean;
  readonly auditLog?: boolean;
  readonly tools?: readonly KilnToolPermissionRule[];
  readonly commands?: readonly KilnCommandPermissionRule[];
  readonly fileGovernance?: KilnFileGovernancePolicy;
  readonly memory?: KilnMemoryPermissionPolicy;
  readonly dataFirewall?: readonly KilnDataFirewallRule[];
  readonly agentScopes?: readonly KilnAgentPermissionScope[];
}

export interface SessionCapabilities {
  readonly mcp: boolean;
  readonly streaming: boolean;
  readonly resumable: boolean;
  readonly resume: boolean;
  readonly costTrackingMode: ExecutionSessionCostTrackingMode;
  readonly supportedTools: readonly string[];
  readonly maxContextTokens: number | null;
  readonly priority: number;
  readonly fallbackTo: string | null;
  readonly permissionPolicy: KilnPermissionPolicy;
}

/**
 * Explicit provenance for `SessionRunOptions.prompt`. Trust must never be
 * inferred from prompt content (e.g. a `<kiln-preamble>` prefix) — a raw
 * user message can contain that exact text. Only a trusted Kiln-owned
 * caller that itself built the governed structured preamble (via
 * `buildPreamble`, under the real per-turn permission policy) may assert
 * `"kiln-preamble"`. Every other caller — including runtime/subscription
 * paths that serialize conversation history into a single prompt string —
 * must leave this unset, which fails closed to `"user"`.
 */
export type SessionPromptKind = "user" | "kiln-preamble";

export interface SessionRunOptions {
  readonly kilnSessionId?: string;
  readonly turnId?: string;
  readonly prompt: string;
  /**
   * Provenance of `prompt`. Absent or `"user"` means ordinary/untrusted
   * content: it must never be treated as system-authoritative regardless of
   * its shape. Only set to `"kiln-preamble"` by the trusted CLI caller that
   * built the governed preamble for this exact turn.
   */
  readonly promptKind?: SessionPromptKind;
  /**
   * Explicit per-call system-prompt override. Set only by callers that own a
   * correctly-governed per-turn value at call time (e.g. the runtime
   * orchestrator's EffectivePromptManifest). CLI-side callers must not set
   * this from a prepared/pre-rendered snapshot; the governed structured
   * `prompt` is the single canonical source for CLI turns.
   */
  readonly system?: string;
  readonly messages?: readonly AgentMessage[];
  readonly cwd?: string;
  /** Runtime tool sandbox context. Used only by Kiln-executable direct-provider sessions. */
  readonly toolSandbox?: unknown;
  readonly deliberationResolution?: DeliberationResolution;
  readonly communicationIntent?: ResolvedCommunicationIntent;
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  readonly env?: Record<string, string>;
  readonly abortSignal?: AbortSignal;
  readonly requestApproval?: (
    description: string,
  ) => Promise<{ readonly approved: boolean; readonly reason?: string }>;
}

export interface NativeToolEventIdentityInput {
  readonly providerId: string;
  readonly kilnSessionId: string;
  readonly turnId: string;
}

export interface NativeToolStartIdentity {
  readonly emit: boolean;
  readonly toolCallId: string;
  readonly toolCallScopeId: string;
}

export interface NativeToolCompletionIdentity extends NativeToolStartIdentity {
  readonly startRequired: boolean;
  readonly toolName: string;
}

/**
 * Normalizes native harness lifecycle notifications into Kiln's scoped tool
 * identity contract. Provider ids remain authoritative. Harnesses that omit an
 * id receive a deterministic ordinal within the host-owned session/turn scope.
 */
export class NativeToolEventIdentity {
  readonly toolCallScopeId: string;

  private nextOrdinal = 1;
  private readonly started = new Set<string>();
  private readonly completed = new Set<string>();
  private readonly toolNames = new Map<string, string>();
  private readonly openByToolName = new Map<string, string[]>();

  constructor(private readonly input: NativeToolEventIdentityInput) {
    this.toolCallScopeId = [input.kilnSessionId, input.turnId, input.providerId]
      .map(requireToolIdentityPart)
      .join(":");
  }

  start(toolName: string, providerCallId?: string): NativeToolStartIdentity {
    const toolCallId = normalizedProviderCallId(providerCallId) ?? this.allocateFallbackId();
    this.assertConsistentToolName(toolCallId, toolName);
    const emit = !this.started.has(toolCallId);
    if (emit) {
      this.started.add(toolCallId);
      this.toolNames.set(toolCallId, toolName);
      const open = this.openByToolName.get(toolName) ?? [];
      open.push(toolCallId);
      this.openByToolName.set(toolName, open);
    }
    return { emit, toolCallId, toolCallScopeId: this.toolCallScopeId };
  }

  complete(toolName: string | undefined, providerCallId?: string): NativeToolCompletionIdentity {
    const explicitId = normalizedProviderCallId(providerCallId);
    const resolvedToolName = toolName ?? (explicitId !== undefined
      ? this.toolNames.get(explicitId)
      : undefined);
    if (resolvedToolName === undefined) {
      throw new Error("Native tool completion without a provider id requires a tool name.");
    }
    const toolCallId = explicitId ?? this.takeOpenCall(resolvedToolName) ?? this.allocateFallbackId();
    this.assertConsistentToolName(toolCallId, resolvedToolName);
    const startRequired = !this.started.has(toolCallId);
    if (startRequired) this.started.add(toolCallId);
    this.removeOpenCall(resolvedToolName, toolCallId);
    const emit = !this.completed.has(toolCallId);
    if (emit) this.completed.add(toolCallId);
    return {
      emit,
      startRequired,
      toolCallId,
      toolCallScopeId: this.toolCallScopeId,
      toolName: this.toolNames.get(toolCallId) ?? resolvedToolName,
    };
  }

  private allocateFallbackId(): string {
    return `${this.input.providerId}:tool:${this.nextOrdinal++}`;
  }

  private takeOpenCall(toolName: string): string | undefined {
    return this.openByToolName.get(toolName)?.find((toolCallId) => !this.completed.has(toolCallId));
  }

  private removeOpenCall(toolName: string, toolCallId: string): void {
    const remaining = (this.openByToolName.get(toolName) ?? []).filter((candidate) => candidate !== toolCallId);
    if (remaining.length === 0) this.openByToolName.delete(toolName);
    else this.openByToolName.set(toolName, remaining);
  }

  private assertConsistentToolName(toolCallId: string, toolName: string): void {
    const existingToolName = this.toolNames.get(toolCallId);
    if (existingToolName !== undefined && existingToolName !== toolName) {
      throw new TypeError(
        `Native provider tool call id "${toolCallId}" was reused for a different tool (${existingToolName} -> ${toolName}).`,
      );
    }
  }
}

function normalizedProviderCallId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function requireToolIdentityPart(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError("Native tool event identity requires non-empty host scope parts.");
  return normalized;
}

export interface IKilnSession {
  run(options: SessionRunOptions): AsyncIterable<ExecutionSessionEvent>;
  dispose(): Promise<void>;
  /** Harness version observed during the current run, when the harness reports it. */
  readonly observedHarnessVersion?: string;
  /** Content-free resolved communication evidence for the current or last run. */
  readonly communicationResolution?: import("@kilnai/core").CommunicationResolution;
  /** Content-free evidence for the exact final prompt handed to a standalone harness. */
  readonly effectivePromptObservation?: import("@kilnai/core").EffectivePromptObservation;
  /** Optional drain for terminal evidence finalized during disposal. */
  drainEphemeralHarnessStateEvidence?(): readonly ExecutionSessionEphemeralHarnessStateEvidence[];
  readonly capabilities: SessionCapabilities;
  readonly sessionId: string;
  readonly providerSessionId: string | undefined;
}
