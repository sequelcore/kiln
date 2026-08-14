import { randomUUID } from "node:crypto";
import type {
  CommunicationResolution,
  EffectivePromptObservation,
  ExecutionSessionEvent,
} from "@kilnai/core";
import type { IKilnSession, SessionCapabilities, SessionRunOptions } from "./session.js";
import {
  CodexCliProcessSession,
  type CodexSessionConfig as CodexCliProcessSessionConfig,
} from "./codex-cli-process-session.js";
import {
  CodexSdkSession,
  requiresCodexCliProcessTransport,
  type CodexSdkPort,
} from "./codex-sdk-session.js";

export interface CodexSessionConfig extends CodexCliProcessSessionConfig {
  /** Test seam for the official SDK. Production constructs the official adapter. */
  readonly sdkPort?: CodexSdkPort;
}

/** Selects one exact Codex transport before the first external effect. */
export class CodexSession implements IKilnSession {
  readonly sessionId: string;
  private readonly session: IKilnSession;

  constructor(config: CodexSessionConfig) {
    this.sessionId = config.runtimeSessionId ?? randomUUID();
    this.session = requiresCodexCliProcessTransport(config)
      ? new CodexCliProcessSession({ ...config, runtimeSessionId: this.sessionId })
      : new CodexSdkSession({ ...config, runtimeSessionId: this.sessionId });
  }

  get capabilities(): SessionCapabilities { return this.session.capabilities; }
  get providerSessionId(): string | undefined { return this.session.providerSessionId; }
  get communicationResolution(): CommunicationResolution | undefined { return this.session.communicationResolution; }
  get effectivePromptObservation(): EffectivePromptObservation | undefined { return this.session.effectivePromptObservation; }
  run(options: SessionRunOptions): AsyncIterable<ExecutionSessionEvent> { return this.session.run(options); }
  dispose(): Promise<void> { return this.session.dispose(); }
}

export { requiresCodexCliProcessTransport } from "./codex-sdk-session.js";
