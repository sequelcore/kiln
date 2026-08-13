import type {
  ExecutionSessionEvent,
  ExecutionSessionRunOptions,
  ExecutionSessionEphemeralHarnessStateEvidence,
  DeliberationResolution,
  ResolvedCommunicationIntent,
  ProviderExecutionRequestedAuthority,
  ExecutionSessionBindingEvidence,
} from "@kilnai/core";
import type { OperatorSurfaceController } from "../operator/operator-surface-controller.js";

export interface CliSession {
  run(options: ExecutionSessionRunOptions): AsyncIterable<ExecutionSessionEvent>;
  dispose(): Promise<void>;
  /** Harness identity observed by the session during its current run. */
  readonly observedHarnessVersion?: string;
  /** Optional drain for terminal evidence finalized by dispose during cancel/timeout. */
  drainEphemeralHarnessStateEvidence?(): readonly ExecutionSessionEphemeralHarnessStateEvidence[];
}

export interface CliSessionFactoryContext {
  readonly kilnSessionId?: string;
  readonly requestedAuthority?: ProviderExecutionRequestedAuthority;
  readonly executionBinding?: Extract<ExecutionSessionBindingEvidence, { readonly status: "bound" }>;
  readonly executionCredential?: unknown;
  readonly operatorSurface?: OperatorSurfaceController;
  /** Route-admitted deliberation decision forwarded unchanged to the native wrapper. */
  readonly deliberationResolution?: DeliberationResolution;
  /** Child-owned communication decision; never inherited from parent ambience. */
  readonly communicationIntent?: ResolvedCommunicationIntent;
  readonly permissionPolicy?: {
    readonly approval: "never" | "on-request" | "on-failure" | "untrusted";
    readonly sandbox: "read-only" | "workspace-write" | "danger-full-access";
  };
  /**
   * A provider-neutral structured result contract for managed children.  The
   * harness may enforce it natively (rather than relying on prompt prose).
   */
  readonly structuredOutput?: {
    readonly schema: Readonly<Record<string, unknown>>;
  };
  /** Version-bound private plan artifact capability for Claude plan runs. */
  readonly privatePlanArtifactCapability?: {
    readonly capabilityId: "claude-code-private-plan-artifacts-v1";
    readonly harness: "claude-code";
    readonly version: "2.1.220" | "2.1.226";
    readonly relativeDirectory: "plans";
  };
}

/**
 * Factory injected by the CLI command. Creates a fresh one-shot CLI session per turn.
 * @param systemPrompt The assembled system prompt (memory + context already injected).
 * @param cwd Working directory for the subprocess.
 */
export type CliSessionFactory = (systemPrompt: string, cwd: string, context?: CliSessionFactoryContext) => CliSession;

/**
 * Event callback for streaming CLI subprocess events to the TUI.
 * The executor fires this for each event from the CLI session.
 */
export type ExecutionSessionEventCallback = (event: ExecutionSessionEvent) => void;
