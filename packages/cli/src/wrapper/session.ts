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
 * - Pure type definitions. No imports.
 */

export type CostTrackingMode =
  | "native"
  | "computed"
  | "none";

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
  readonly dataFirewall?: readonly KilnDataFirewallRule[];
  readonly agentScopes?: readonly KilnAgentPermissionScope[];
}

export type SessionEvent =
  | { type: "text_delta"; content: string; isThinking?: boolean }
  | { type: "tool_use"; toolName: string; input: unknown; source?: "native" | "mcp"; mcpSelector?: string }
  | { type: "tool_result"; toolName: string; output: string }
  | {
      type: "file_changed";
      path: string;
      changeType: "created" | "modified" | "deleted";
      linesAdded?: number;
      linesRemoved?: number;
    }
  | {
      type: "cost_update";
      usd: number;
      mode: CostTrackingMode;
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
    }
  | {
      type: "completed";
      totalUsd: number;
      durationMs: number;
      isError: boolean;
      isPreflightCrash: boolean;
    }
  | { type: "error"; code: string; message: string; isRetryable: boolean };

export interface SessionCapabilities {
  readonly mcp: boolean;
  readonly streaming: boolean;
  readonly resumable: boolean;
  readonly resume: boolean;
  readonly costTrackingMode: CostTrackingMode;
  readonly supportedTools: readonly string[];
  readonly maxContextTokens: number | null;
  readonly priority: number;
  readonly fallbackTo: string | null;
  readonly permissionPolicy: KilnPermissionPolicy;
}

export interface SessionRunOptions {
  readonly prompt: string;
  readonly system?: string;
  readonly messages?: readonly AgentMessage[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly abortSignal?: AbortSignal;
}

export interface IKilnSession {
  run(options: SessionRunOptions): AsyncIterable<SessionEvent>;
  dispose(): Promise<void>;
  readonly capabilities: SessionCapabilities;
  readonly sessionId: string;
  readonly providerSessionId: string | undefined;
}
import type { AgentMessage } from "@kilnai/core";
